import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { appendTraceEvent, listTurnTrace } from './journal';

describe('execution journal', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('appends ordered events and requires route reasons', async () => {
    await appendTraceEvent({ sessionId: 's', turnId: 't', spanId: 'a', node: 'plan', type: 'node.started', status: 'running', summary: 'Planning' });
    await appendTraceEvent({ sessionId: 's', turnId: 't', spanId: 'a', node: 'plan', type: 'route.selected', status: 'succeeded', summary: 'Route', reason: 'Tools unavailable' });
    expect((await listTurnTrace('t')).map((event) => event.sequence)).toEqual([1, 2]);
    await expect(appendTraceEvent({ sessionId: 's', turnId: 't', spanId: 'a', node: 'plan', type: 'route.selected', status: 'succeeded', summary: 'Route' })).rejects.toThrow(/require a reason/);
  });
});
