import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeRun } from '../../lib/agent/recipe';
import {
  getRecoveredRunStatus,
  useProjectRecipeRun,
} from './useProjectRecipeRun';

const loadNewestRun = vi.fn();

vi.mock('../../lib/agent/recipe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/agent/recipe')>();
  return {
    ...actual,
    loadNewestRegisteredRecipeRunForProject: (...args: unknown[]) =>
      loadNewestRun(...args),
  };
});

function makeRun(
  id: string,
  projectId: string,
  status: RecipeRun['status'] = 'paused',
): RecipeRun {
  return {
    id,
    project_id: projectId,
    recipe_id: 'test-recipe',
    recipe_name: 'Test recipe',
    started_at: '2026-07-27T00:00:00.000Z',
    status,
    stage_states: {},
    total_tokens_in: 0,
    total_tokens_out: 0,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useProjectRecipeRun', () => {
  beforeEach(() => {
    loadNewestRun.mockReset();
  });

  it('loads the newest relevant run without replaying it', async () => {
    const run = makeRun('run-a', 'project-a');
    loadNewestRun.mockResolvedValue(run);

    const { result } = renderHook(() => useProjectRecipeRun('project-a'));

    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({
      status: 'ready',
      run,
      recoveredStatus: 'paused',
    });
    expect(loadNewestRun).toHaveBeenCalledTimes(1);
  });

  it('presents a stale running row as interrupted without mutating it', async () => {
    const run = makeRun('run-a', 'project-a', 'running');
    loadNewestRun.mockResolvedValue(run);

    const { result } = renderHook(() => useProjectRecipeRun('project-a'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.recoveredStatus).toBe(
      'interrupted',
    );
    expect(run.status).toBe('running');
    expect(getRecoveredRunStatus(run, run.id)).toBe('running');
  });

  it.each(['failed', 'completed'] as const)(
    'preserves the %s terminal state without replaying it',
    async (status) => {
      const run = makeRun(`run-${status}`, 'project-a', status);
      loadNewestRun.mockResolvedValue(run);

      const { result } = renderHook(() => useProjectRecipeRun('project-a'));

      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current).toEqual({
        status: 'ready',
        run,
        recoveredStatus: status,
      });
      expect(loadNewestRun).toHaveBeenCalledTimes(1);
    },
  );

  it('never exposes project A after navigating to project B', async () => {
    const projectA = deferred<RecipeRun | undefined>();
    const runB = makeRun('run-b', 'project-b');
    loadNewestRun
      .mockReturnValueOnce(projectA.promise)
      .mockResolvedValueOnce(runB);

    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectRecipeRun(projectId),
      { initialProps: { projectId: 'project-a' } },
    );

    rerender({ projectId: 'project-b' });
    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.status === 'ready' && result.current.run.id).toBe('run-b');

    await act(async () => {
      projectA.resolve(makeRun('run-a', 'project-a'));
      await projectA.promise;
    });
    expect(result.current.status === 'ready' && result.current.run.id).toBe('run-b');
  });

  it('distinguishes no run from a storage error', async () => {
    loadNewestRun.mockResolvedValueOnce(undefined);
    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectRecipeRun(projectId),
      { initialProps: { projectId: 'project-a' } },
    );
    await waitFor(() => expect(result.current).toEqual({ status: 'none' }));

    loadNewestRun.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    rerender({ projectId: 'project-b' });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(
      result.current.status === 'error' && result.current.error.message,
    ).toBe('IndexedDB unavailable');
  });
});
