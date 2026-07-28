import { describe, expect, it } from 'vitest';
import {
  assertLegalSessionTransition,
  assertLegalTurnTransition,
  isLegalSessionTransition,
  isLegalTurnTransition,
  statusTransitionMetadata,
} from './lifecycle';

describe('editing lifecycle', () => {
  it('allows the proposal and approval lifecycle', () => {
    expect(isLegalSessionTransition('preparing', 'running')).toBe(true);
    expect(isLegalSessionTransition('running', 'validating')).toBe(true);
    expect(isLegalSessionTransition('validating', 'awaiting_approval')).toBe(true);
    expect(isLegalSessionTransition('awaiting_approval', 'accepted')).toBe(true);

    expect(isLegalTurnTransition('running', 'awaiting_user_approval')).toBe(true);
    expect(isLegalTurnTransition('awaiting_user_approval', 'accepted')).toBe(true);
    expect(isLegalTurnTransition('awaiting_user_approval', 'rejected')).toBe(true);
  });

  it('allows interrupted work to restart but rejects terminal rewrites', () => {
    expect(isLegalSessionTransition('running', 'interrupted')).toBe(true);
    expect(isLegalSessionTransition('interrupted', 'running')).toBe(true);
    expect(isLegalTurnTransition('validating', 'interrupted')).toBe(true);
    expect(isLegalTurnTransition('interrupted', 'preparing')).toBe(true);

    expect(() => assertLegalSessionTransition('accepted', 'running')).toThrow(/accepted -> running/);
    expect(() => assertLegalTurnTransition('rejected', 'accepted')).toThrow(/rejected -> accepted/);
    expect(() => assertLegalTurnTransition('failed', 'running')).toThrow(/failed -> running/);
  });

  it('treats idempotent status writes as legal', () => {
    expect(() => assertLegalSessionTransition('running', 'running')).not.toThrow();
    expect(() => assertLegalTurnTransition('validating', 'validating')).not.toThrow();
  });

  it('records a timestamp and transition reason', () => {
    expect(statusTransitionMetadata(
      'running',
      'interrupted',
      'Browser reloaded.',
      new Date('2026-07-27T01:02:03.000Z'),
    )).toEqual({
      status_changed_at: '2026-07-27T01:02:03.000Z',
      status_reason: 'Browser reloaded.',
    });
  });
});
