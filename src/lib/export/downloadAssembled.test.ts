import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftRecord, ProjectRecord, TemplateRecord } from '../db/schema';

const toArray = vi.fn();
const assembleProjectDocx = vi.fn();

vi.mock('../db/schema', () => ({
  db: {
    drafts: {
      where: () => ({
        equals: () => ({ toArray }),
      }),
    },
  },
}));

vi.mock('./assemble', () => ({
  assembleProjectDocx: (...args: unknown[]) => assembleProjectDocx(...args),
}));

import { assembleProjectFromDrafts, downloadBlob } from './downloadAssembled';

const project = {
  id: 'project-1',
  name: 'Quarterly / Review',
} as ProjectRecord;

function template(id: string, name = id): TemplateRecord {
  return { id, name } as TemplateRecord;
}

function draft(templateId: string, status: DraftRecord['status'] = 'ready'): DraftRecord {
  return {
    id: `project-1::${templateId}::section-1`,
    project_id: 'project-1',
    template_id: templateId,
    section_id: 'section-1',
    paragraphs: [{ role: 'body', text: 'Synthetic draft' }],
    references: '',
    status,
    generated_at: '2026-07-28T00:00:00.000Z',
    model: 'synthetic',
    tokens_in: 0,
    tokens_out: 0,
  };
}

describe('assembleProjectFromDrafts', () => {
  beforeEach(() => {
    toArray.mockReset();
    assembleProjectDocx.mockReset();
  });

  it('reports success, failure, and skipped templates independently', async () => {
    toArray.mockResolvedValue([
      draft('ready-template'),
      draft('failed-template'),
      draft('skipped-template', 'error'),
    ]);
    assembleProjectDocx
      .mockResolvedValueOnce({
        blob: new Blob(['docx']),
        total_assembled: 1,
        total_failed: 0,
        sections: [],
      })
      .mockRejectedValueOnce(new Error('Synthetic assembly failure'));

    const report = await assembleProjectFromDrafts(project, [
      template('ready-template', 'Ready Template'),
      template('failed-template', 'Failed Template'),
      template('skipped-template', 'Skipped Template'),
    ]);

    expect(report.successes).toHaveLength(1);
    expect(report.successes[0]?.filename).toMatch(
      /^quarterly_review_ready_template_\d{4}-\d{2}-\d{2}\.docx$/,
    );
    expect(report.failures).toEqual([{
      template_id: 'failed-template',
      template_name: 'Failed Template',
      reason: 'Synthetic assembly failure',
    }]);
    expect(report.skipped).toEqual([{
      template_id: 'skipped-template',
      template_name: 'Skipped Template',
      reason: 'No ready drafts',
    }]);
  });
});

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the requested filename and revokes the object URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:assembled');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    downloadBlob(new Blob(['docx']), 'approved.docx');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download="approved.docx"]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:assembled');
  });
});
