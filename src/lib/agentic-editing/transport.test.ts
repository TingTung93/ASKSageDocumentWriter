import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import type { LLMClient } from '../provider/types';
import { listTurnTrace } from './journal';
import { withAuditedTransport } from './transport';

afterEach(async () => { await db.delete(); await db.open(); });

describe('withAuditedTransport', () => {
  it('records canonical provider-independent input and response without credentials', async () => {
    const client = { capabilities: { fileUpload: false, dataset: false, liveSearch: false }, getModels: async () => [], query: async () => ({ message: 'done', response: 'done', status: 200, uuid: 'x' }), queryJson: async () => ({ data: {}, raw: { message: 'done', response: 'done', status: 200, uuid: 'x' } }) } as LLMClient;
    await withAuditedTransport(client, { sessionId: 'session', turnId: 'turn' }).query({ message: 'Draft this', model: 'm' });
    expect((await listTurnTrace('turn')).map((item) => item.type)).toEqual(['model.request', 'model.response']);
    const content = (await db.agent_trace_artifacts.where('turnId').equals('turn').toArray()).map((item) => item.content).join(' ');
    expect(content).toContain('Draft this');
    expect(content).not.toContain('Authorization');
  });
});
