import { useMemo, useState } from 'react';
import { db, type ProjectRecord, type TemplateRecord } from '../../lib/db/schema';
import {
  uniquePlaceholdersByDescription,
  applyPlaceholderResolutions,
  type PlaceholderResolution,
  type PlaceholderOccurrence,
} from '../../lib/draft/placeholders';
import { normalizePlaceholderResolutions } from '../../lib/draft/normalize_resolutions';
import { createLLMClient } from '../../lib/provider/factory';
import { useAuth } from '../../lib/state/auth';
import { toast } from '../../lib/state/toast';
import { addProjectNote } from '../../lib/project/context';

interface PlaceholderOccurrenceWithDraft extends PlaceholderOccurrence {
  draft_id: string;
  template_name: string;
  section_name: string;
}

interface PlaceholderStageOutput {
  occurrences: PlaceholderOccurrenceWithDraft[];
}

interface NormalizationRequest {
  input_key: string;
  section_name: string;
  description: string;
  raw_value: string;
}

interface V2InterventionCardProps {
  project: ProjectRecord;
  templates: TemplateRecord[];
  stageOutput: PlaceholderStageOutput;
  onApplied: () => void;
  isRunning: boolean;
}

export function V2InterventionCard({
  project,
  templates,
  stageOutput,
  onApplied,
  isRunning,
}: V2InterventionCardProps) {
  const apiKey = useAuth((s) => s.apiKey);
  const baseUrl = useAuth((s) => s.baseUrl);
  const provider = useAuth((s) => s.provider);

  const groups = useMemo(() => {
    const byDraft = new Map<string, PlaceholderOccurrenceWithDraft[]>();
    for (const occ of stageOutput.occurrences) {
      let bucket = byDraft.get(occ.draft_id);
      if (!bucket) {
        bucket = [];
        byDraft.set(occ.draft_id, bucket);
      }
      bucket.push(occ);
    }
    const out: Array<{
      draft_id: string;
      template_name: string;
      section_name: string;
      uniques: Array<{
        description: string;
        occurrences: PlaceholderOccurrenceWithDraft[];
        inputKey: string;
      }>;
    }> = [];
    for (const [draftId, bucket] of byDraft) {
      const first = bucket[0]!;
      const uniques = uniquePlaceholdersByDescription(bucket).map((u) => ({
        description: u.description,
        occurrences: u.occurrences as PlaceholderOccurrenceWithDraft[],
        inputKey: `${draftId}::${u.description.toLowerCase()}`,
      }));
      out.push({
        draft_id: draftId,
        template_name: first.template_name,
        section_name: first.section_name,
        uniques,
      });
    }
    return out;
  }, [stageOutput]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onApply() {
    setBusy(true);
    try {
      const normalizationRequests: NormalizationRequest[] = [];
      for (const group of groups) {
        for (const u of group.uniques) {
          const raw = (values[u.inputKey] ?? '').trim();
          if (!raw) continue;
          normalizationRequests.push({
            input_key: u.inputKey,
            section_name: group.section_name,
            description: u.description,
            raw_value: raw,
          });
        }
      }

      let resolved = new Map<string, string>(
        normalizationRequests.map((r) => [r.input_key, r.raw_value]),
      );
      let changedByNormalizer = 0;
      if (apiKey && normalizationRequests.length > 0) {
        try {
          const client = createLLMClient({ provider, baseUrl, apiKey });
          const documentKind = templates
              .filter((t) => project.template_ids.includes(t.id))
              .map((t) => t.name)
              .join(' / ') || 'document';
          const out = await normalizePlaceholderResolutions({
            client,
            document_kind: documentKind,
            project_subject: project.description ?? '',
            resolutions: normalizationRequests.map((r) => ({
              key: r.input_key,
              section_name: r.section_name,
              description: r.description,
              raw_value: r.raw_value,
            })),
          });
          resolved = out.normalized;
          changedByNormalizer = out.changed;
        } catch (err) {
          console.warn('[V2InterventionCard] normalize failed; using raw values:', err);
          toast.info('Normalization skipped — using raw values');
        }
      }

      // Save normalized values as a project note
      if (normalizationRequests.length > 0) {
        try {
            const bySection = new Map<string, NormalizationRequest[]>();
            for (const r of normalizationRequests) {
              let bucket = bySection.get(r.section_name);
              if (!bucket) {
                bucket = [];
                bySection.set(r.section_name, bucket);
              }
              bucket.push(r);
            }
            const lines: string[] = [];
            lines.push('User-supplied context for this draft (saved automatically from the fill-placeholders form):');
            for (const [sectionName, bucket] of bySection) {
              lines.push('');
              lines.push(`${sectionName}:`);
              for (const r of bucket) {
                const value = resolved.get(r.input_key) ?? r.raw_value;
                if (!value) continue;
                if (value.includes('\n')) {
                  lines.push(`  - ${r.description}:`);
                  for (const line of value.split('\n')) {
                    lines.push(`      ${line}`);
                  }
                } else {
                  lines.push(`  - ${r.description}: ${value}`);
                }
              }
            }
            await addProjectNote(project.id, lines.join('\n'), 'user');
        } catch (err) {
            console.warn('[V2InterventionCard] failed to save note:', err);
        }
      }

      let totalApplied = 0;
      let totalSkipped = 0;
      for (const group of groups) {
        const draft = await db.drafts.get(group.draft_id);
        if (!draft) continue;
        const resolutions: PlaceholderResolution[] = [];
        for (const u of group.uniques) {
          const value = resolved.get(u.inputKey) ?? '';
          if (!value) {
            totalSkipped += u.occurrences.length;
            continue;
          }
          for (const occ of u.occurrences) {
            resolutions.push({
              paragraph_index: occ.paragraph_index,
              cell_index: occ.cell_index,
              start: occ.start,
              end: occ.end,
              value,
            });
          }
        }
        if (resolutions.length === 0) continue;
        const applied = applyPlaceholderResolutions(draft.paragraphs, resolutions);
        await db.drafts.put({
          ...draft,
          paragraphs: applied.paragraphs,
        });
        totalApplied += applied.applied;
      }

      if (totalApplied > 0) {
        const normalizedNote = changedByNormalizer > 0 ? ` · ${changedByNormalizer} reformatted by LLM` : '';
        toast.success(`Applied ${totalApplied} placeholders${totalSkipped > 0 ? ` · ${totalSkipped} left blank` : ''}${normalizedNote}`);
      } else if (totalSkipped > 0) {
        toast.info(`Left ${totalSkipped} placeholders in place`);
      }
      onApplied();
    } catch (err) {
      toast.error(`Apply failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const totalUniques = groups.reduce((acc, g) => acc + g.uniques.length, 0);
  const filledUniques = groups.reduce(
    (acc, g) => acc + g.uniques.filter((u) => (values[u.inputKey] ?? '').trim().length > 0).length,
    0,
  );

  return (
    <div className="msg ai">
      <div className="who">A</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="msg-name">Co-Writer</div>
        <div className="msg-body">
          <div className="tool-card" style={{ borderLeft: '2px solid var(--accent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h4 style={{ margin: 0 }}>Fill in missing context</h4>
              <span className="kbd-hint">{filledUniques}/{totalUniques} filled</span>
            </div>
            <p style={{ fontSize: '0.9em', color: 'var(--ink-4)', marginBottom: 16 }}>
              The draft needs specific facts to continue. Provide them below, or leave blank to skip.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {groups.map((group) => (
                <div key={group.draft_id} style={{ background: 'var(--paper)', padding: 8, borderRadius: 4, border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, marginBottom: 6 }}>{group.section_name}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {group.uniques.map((u) => (
                      <label key={u.inputKey} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ flex: '0 0 100px', fontSize: 11, paddingTop: 6, color: 'var(--ink-4)' }}>{u.description}</span>
                        <input
                          type="text"
                          className="intervention-input"
                          style={{ flex: 1 }}
                          value={values[u.inputKey] ?? ''}
                          onChange={(e) => setValues((prev) => ({ ...prev, [u.inputKey]: e.target.value }))}
                          placeholder="Type fact..."
                          aria-label={u.description}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-accent btn-sm"
                style={{ flex: 1 }}
                disabled={busy || isRunning}
                onClick={onApply}
              >
                {busy ? 'Reformatting...' : 'Apply & continue'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy || isRunning}
                onClick={onApplied}
              >
                Skip all
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
