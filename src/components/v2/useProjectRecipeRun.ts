import { useEffect, useState } from 'react';
import {
  loadNewestRegisteredRecipeRunForProject,
  type RecipeRun,
} from '../../lib/agent/recipe';

export type RecoveredRunStatus =
  | RecipeRun['status']
  | 'interrupted';

export type ProjectRunLoadState =
  | { status: 'loading' }
  | { status: 'none' }
  | {
      status: 'ready';
      run: RecipeRun;
      /**
       * A persisted `running` row has no live runner after a reload. Present it
       * as interrupted until the current process explicitly identifies that
       * run as active. This is derived UI state; the stored row is untouched.
       */
      recoveredStatus: RecoveredRunStatus;
    }
  | { status: 'error'; error: Error };

interface ProjectRunSnapshot {
  projectId: string | null;
  state: ProjectRunLoadState;
}

export function getRecoveredRunStatus(
  run: RecipeRun,
  activeRunId?: string | null,
): RecoveredRunStatus {
  return run.status === 'running' && run.id !== activeRunId
    ? 'interrupted'
    : run.status;
}

/**
 * Recover the newest registered recipe run for the active route project.
 *
 * Recovery is read-only: it never resumes a run or replays a stage. A request
 * generation guard prevents a slow project-A read from appearing after the
 * route has already moved to project B.
 */
export function useProjectRecipeRun(
  projectId: string | null | undefined,
  activeRunId?: string | null,
): ProjectRunLoadState {
  const normalizedProjectId = projectId?.trim() || null;
  const [snapshot, setSnapshot] = useState<ProjectRunSnapshot>({
    projectId: normalizedProjectId,
    state: normalizedProjectId ? { status: 'loading' } : { status: 'none' },
  });

  useEffect(() => {
    if (!normalizedProjectId) {
      setSnapshot({ projectId: null, state: { status: 'none' } });
      return;
    }

    let current = true;
    setSnapshot({
      projectId: normalizedProjectId,
      state: { status: 'loading' },
    });

    void loadNewestRegisteredRecipeRunForProject(normalizedProjectId)
      .then((run) => {
        if (!current) return;
        setSnapshot({
          projectId: normalizedProjectId,
          state: run
            ? {
                status: 'ready',
                run,
                recoveredStatus: getRecoveredRunStatus(run, activeRunId),
              }
            : { status: 'none' },
        });
      })
      .catch((cause: unknown) => {
        if (!current) return;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        setSnapshot({
          projectId: normalizedProjectId,
          state: { status: 'error', error },
        });
      });

    return () => {
      current = false;
    };
  }, [normalizedProjectId, activeRunId]);

  // Effects run after render. Mask a previous project's snapshot immediately
  // so recipe state can never bleed across route transitions.
  if (snapshot.projectId !== normalizedProjectId) {
    return normalizedProjectId ? { status: 'loading' } : { status: 'none' };
  }
  return snapshot.state;
}
