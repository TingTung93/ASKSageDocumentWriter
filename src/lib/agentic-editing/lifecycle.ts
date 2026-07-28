import type {
  EditingSessionStatus,
  EditingTurnStatus,
} from './types';

const SESSION_TRANSITIONS: Readonly<Record<EditingSessionStatus, readonly EditingSessionStatus[]>> = {
  preparing: ['running', 'failed', 'interrupted', 'cancelled'],
  running: ['validating', 'awaiting_approval', 'awaiting_connection', 'accepted', 'completed', 'failed', 'interrupted', 'cancelled'],
  validating: ['awaiting_approval', 'accepted', 'failed', 'interrupted', 'cancelled'],
  awaiting_approval: ['running', 'accepted', 'rejected', 'completed', 'superseded', 'cancelled'],
  awaiting_connection: ['running', 'failed', 'interrupted', 'cancelled'],
  interrupted: ['preparing', 'running', 'failed', 'cancelled'],
  accepted: [],
  rejected: [],
  completed: [],
  failed: [],
  superseded: [],
  cancelled: [],
};

const TURN_TRANSITIONS: Readonly<Record<EditingTurnStatus, readonly EditingTurnStatus[]>> = {
  preparing: ['running', 'failed', 'interrupted', 'cancelled'],
  running: [
    'validating',
    'awaiting_plan_approval',
    'awaiting_tool_approval',
    'awaiting_user_approval',
    'awaiting_approval',
    'accepted',
    'completed',
    'failed',
    'interrupted',
    'cancelled',
    'budget_exceeded',
  ],
  validating: ['awaiting_user_approval', 'awaiting_approval', 'accepted', 'failed', 'interrupted', 'cancelled'],
  awaiting_plan_approval: ['running', 'rejected', 'superseded', 'cancelled'],
  awaiting_tool_approval: ['running', 'rejected', 'cancelled'],
  awaiting_user_approval: ['running', 'accepted', 'rejected', 'completed', 'superseded', 'cancelled'],
  awaiting_approval: ['running', 'accepted', 'rejected', 'completed', 'superseded', 'cancelled'],
  interrupted: ['preparing', 'running', 'failed', 'cancelled'],
  accepted: [],
  rejected: [],
  completed: [],
  failed: [],
  superseded: [],
  cancelled: [],
  budget_exceeded: [],
};

export function isLegalSessionTransition(
  from: EditingSessionStatus,
  to: EditingSessionStatus,
): boolean {
  return from === to || SESSION_TRANSITIONS[from].includes(to);
}

export function isLegalTurnTransition(
  from: EditingTurnStatus,
  to: EditingTurnStatus,
): boolean {
  return from === to || TURN_TRANSITIONS[from].includes(to);
}

export function assertLegalSessionTransition(
  from: EditingSessionStatus,
  to: EditingSessionStatus,
): void {
  if (!isLegalSessionTransition(from, to)) {
    throw new Error(`Illegal editing session transition: ${from} -> ${to}`);
  }
}

export function assertLegalTurnTransition(
  from: EditingTurnStatus,
  to: EditingTurnStatus,
): void {
  if (!isLegalTurnTransition(from, to)) {
    throw new Error(`Illegal editing turn transition: ${from} -> ${to}`);
  }
}

export function statusTransitionMetadata(
  from: string,
  to: string,
  reason: string | undefined,
  now = new Date(),
): { status_changed_at: string; status_reason: string } {
  return {
    status_changed_at: now.toISOString(),
    status_reason: reason?.trim() || `Status changed from ${from} to ${to}.`,
  };
}
