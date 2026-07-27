import { db } from '../db/schema';
import { makeAgentId } from './ids';
import type { LearnedPreference } from './types';

export async function proposeLearnedPreference(input: Omit<LearnedPreference, 'id' | 'status' | 'created_at'>): Promise<LearnedPreference> {
  const preference: LearnedPreference = { ...input, id: makeAgentId('preference'), status: 'proposed', created_at: new Date().toISOString() };
  await db.learned_preferences.add(preference);
  return preference;
}

export async function acceptLearnedPreference(id: string): Promise<void> {
  await db.learned_preferences.update(id, { status: 'accepted', accepted_at: new Date().toISOString() });
}

export async function listApplicablePreferences(projectId?: string, documentId?: string): Promise<LearnedPreference[]> {
  const rows = await db.learned_preferences.where('status').equals('accepted').toArray();
  return rows.filter((row) => (!row.project_id || row.project_id === projectId) && (!row.document_id || row.document_id === documentId));
}
