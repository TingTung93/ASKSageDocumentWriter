import { describe, it, expect } from 'vitest';
import { runValidation } from './index';
import type { BodyFillRegion } from '../template/types';
import type { DraftParagraph } from '../draft/types';

function makeSection(validation: Record<string, unknown> = {}, target?: [number, number]): BodyFillRegion {
  return {
    id: 'test',
    name: 'Test',
    order: 0,
    required: true,
    fill_region: {
      kind: 'heading_bounded',
      heading_text: 'Test',
      heading_style_id: null,
      body_style_id: null,
      anchor_paragraph_index: 0,
      end_anchor_paragraph_index: 1,
      permitted_roles: ['body'],
    },
    target_words: target,
    validation,
  };
}

const para = (text: string): DraftParagraph => ({ role: 'body', text });

describe('runValidation', () => {
  it('passes when no rules are defined', () => {
    expect(runValidation(makeSection(), [para('hello world')])).toEqual([]);
  });

  it('reports must_not_exceed_words violations as errors', () => {
    const issues = runValidation(
      makeSection({ must_not_exceed_words: 5 }),
      [para('one two three four five six seven')],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('must_not_exceed_words');
    expect(issues[0]!.severity).toBe('error');
  });

  it('reports must_be_at_least_words violations as warnings', () => {
    const issues = runValidation(
      makeSection({ must_be_at_least_words: 10 }),
      [para('only three words')],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('must_be_at_least_words');
    expect(issues[0]!.severity).toBe('warning');
  });

  it('reports missing must_mention phrases as errors', () => {
    const issues = runValidation(
      makeSection({ must_mention: ['Defense Health Agency', 'CUI'] }),
      [para('the contract is for general services')],
    );
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.rule === 'must_mention')).toBe(true);
  });

  it('passes must_mention when phrase appears (case-insensitive)', () => {
    const issues = runValidation(
      makeSection({ must_mention: ['DEFENSE HEALTH AGENCY'] }),
      [para('the defense health agency oversees this contract')],
    );
    expect(issues).toEqual([]);
  });

  it('reports must_not_mention violations as warnings', () => {
    const issues = runValidation(
      makeSection({ must_not_mention: ['leverage', 'synergize'] }),
      [para('we should leverage every available resource')],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('must_not_mention');
    expect(issues[0]!.severity).toBe('warning');
  });

  it('warns when target_words is way under (<50% of min)', () => {
    const issues = runValidation(
      makeSection({}, [100, 200]),
      [para('three short words')],
    );
    expect(issues.some((i) => i.rule === 'target_words')).toBe(true);
  });

  it('warns when target_words is way over (>150% of max)', () => {
    const longText = Array(400).fill('word').join(' ');
    const issues = runValidation(
      makeSection({}, [100, 200]),
      [para(longText)],
    );
    expect(issues.some((i) => i.rule === 'target_words')).toBe(true);
  });

  it('does not warn for target_words when length is within band', () => {
    const text = Array(150).fill('word').join(' ');
    const issues = runValidation(
      makeSection({}, [100, 200]),
      [para(text)],
    );
    expect(issues.filter((i) => i.rule === 'target_words')).toHaveLength(0);
  });
});
