import { describe, it, expect } from 'vitest';
import {
  detectFillerRejection,
  findFillerOffenses,
  extractBulletOpeners,
} from './drafter';

describe('extractBulletOpeners', () => {
  it('pulls markdown dash and asterisk bullets', () => {
    const md = '- alpha bullet\n* beta bullet\n  - indented gamma';
    const out = extractBulletOpeners(md);
    expect(out.map((b) => b.opener)).toEqual([
      'alpha bullet',
      'beta bullet',
      'indented gamma',
    ]);
  });

  it('strips leading bold/italic from openers', () => {
    const md = '- **Led** a team\n- __Drove__ a rollout';
    const out = extractBulletOpeners(md);
    expect(out.map((b) => b.opener)).toEqual(['Led a team', 'Drove a rollout']);
  });

  it('ignores non-bullet lines', () => {
    const md = '# Heading\n\nBody paragraph.\n- real bullet';
    const out = extractBulletOpeners(md);
    expect(out.map((b) => b.opener)).toEqual(['real bullet']);
  });

  it('returns empty for prose-only text', () => {
    expect(extractBulletOpeners('Just some sentences.\nNo bullets.')).toEqual([]);
  });
});

describe('findFillerOffenses — point_paper', () => {
  it('flags throat-clearing openers', () => {
    const md = [
      '- This paper describes the FY26 budget.',
      '- The purpose of this brief is to outline risk.',
      '- FY26 DHA budget for sustainment: $412M, down 7%.',
      '- It is important to note the 30 Sep bridge expiry.',
    ].join('\n');
    const offenses = findFillerOffenses(md, 'point_paper');
    expect(offenses).toHaveLength(3);
    expect(offenses[0]).toMatchObject({ bulletIndex: 0 });
    expect(offenses[1]).toMatchObject({ bulletIndex: 1 });
    expect(offenses[2]).toMatchObject({ bulletIndex: 3 });
    // The concrete-opener bullet (#2) is not flagged.
    expect(offenses.find((o) => o.bulletIndex === 2)).toBeUndefined();
  });

  it('is case-insensitive on the opener match', () => {
    const md = '- IN ORDER TO hit the deadline, the team pulled forward Wave 6.';
    expect(findFillerOffenses(md, 'point_paper')).toHaveLength(1);
  });

  it('returns empty on clean bullets', () => {
    const md = [
      '- FY26 DHA budget for MHS GENESIS sustainment: $412M, down 7% from FY25.',
      '- Contract bridge expires 30 Sep 26; follow-on RFP released 14 Apr 26.',
    ].join('\n');
    expect(findFillerOffenses(md, 'point_paper')).toEqual([]);
  });

  it('does not scan non-targeted styles', () => {
    const md = '- This paper covers the FY26 budget.';
    expect(findFillerOffenses(md, 'exsum')).toEqual([]);
    expect(findFillerOffenses(md, 'memo')).toEqual([]);
  });
});

describe('findFillerOffenses — award_bullets', () => {
  it('flags filler verbs and first-person openers', () => {
    const md = [
      '- Was responsible for the FY25 J&A library, authored 47 packages.',
      '- Served as the primary POC for MHS GENESIS sustainment.',
      '- I led the $47M recompete saving $1.2M.',
      '- Helped the team with the sustainment contract.',
      '- Led $47M MHS GENESIS sustainment recompete, delivered 31 days early.',
    ].join('\n');
    const offenses = findFillerOffenses(md, 'award_bullets');
    expect(offenses.map((o) => o.bulletIndex)).toEqual([0, 1, 2, 3]);
  });

  it('accepts strong past-tense action verbs', () => {
    const md = [
      '- Led $47M recompete, delivered 31 days early, saved $1.2M.',
      '- Authored DHA\'s first template-driven J&A library; cut staffing 73%.',
      '- Mentored 4 GS-09 contract specialists to FAC-C Level II in 9 months.',
    ].join('\n');
    expect(findFillerOffenses(md, 'award_bullets')).toEqual([]);
  });
});

describe('detectFillerRejection', () => {
  it('returns null when no offenses', () => {
    const clean = '- FY26 DHA budget: $412M, down 7%.';
    expect(detectFillerRejection(clean, 'point_paper')).toBeNull();
    expect(detectFillerRejection(clean, 'award_bullets')).toBeNull();
  });

  it('fires on first-bullet offense alone (threshold: first two)', () => {
    const md = [
      '- This paper covers the FY26 budget.',
      '- Contract bridge expires 30 Sep 26.',
      '- FY26 budget: $412M.',
    ].join('\n');
    const instr = detectFillerRejection(md, 'point_paper');
    expect(instr).not.toBeNull();
    expect(instr).toContain('concrete noun');
  });

  it('fires on two offenses even when neither is first/second', () => {
    const md = [
      '- FY26 DHA budget: $412M.',
      '- Contract bridge expires 30 Sep 26.',
      '- In order to keep pace, the team accelerated Wave 6.',
      '- It is important to note the 18% cohort growth.',
    ].join('\n');
    expect(detectFillerRejection(md, 'point_paper')).not.toBeNull();
  });

  it('does not fire on a single mid-document offense', () => {
    const md = [
      '- FY26 DHA budget: $412M.',
      '- Contract bridge expires 30 Sep 26.',
      '- FY26 RFP released 14 Apr 26.',
      '- In order to keep pace, the team accelerated Wave 6.',
    ].join('\n');
    expect(detectFillerRejection(md, 'point_paper')).toBeNull();
  });

  it('returns a style-specific retry instruction', () => {
    const ppMd = '- This paper covers FY26.\n- The purpose of this brief is clarity.';
    const awardMd = '- Was responsible for the library.\n- Served as primary POC.';
    const pp = detectFillerRejection(ppMd, 'point_paper');
    const aw = detectFillerRejection(awardMd, 'award_bullets');
    expect(pp).toMatch(/point|bullet|principal|concrete/i);
    expect(aw).toMatch(/past-tense|action verb|metric/i);
    // The two retry instructions should not be identical.
    expect(pp).not.toEqual(aw);
  });

  it('ignores styles outside the target set', () => {
    const md = '- This paper covers FY26.\n- The purpose of this brief.';
    expect(detectFillerRejection(md, 'exsum')).toBeNull();
    expect(detectFillerRejection(md, 'memo')).toBeNull();
    expect(detectFillerRejection(md, 'sop')).toBeNull();
  });

  it('quotes up to three offending openers in the instruction', () => {
    const md = [
      '- This paper covers FY26.',
      '- The purpose of this brief is risk.',
      '- In order to keep pace, accelerate.',
      '- It is important to note the cohort.',
    ].join('\n');
    const instr = detectFillerRejection(md, 'point_paper')!;
    // All banned openers mentioned above should show up in the
    // instruction — first three make it in, not necessarily the 4th.
    expect(instr).toContain('This paper');
    expect(instr).toContain('The purpose of');
    expect(instr).toContain('In order to');
  });
});
