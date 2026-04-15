import { describe, expect, it } from 'vitest';
import { scanSchemaForSubjectLeakage } from './leakage';
import type { BodyFillRegion } from '../types';

function makeSection(id: string, intent: string): BodyFillRegion {
  return {
    id,
    name: `Section ${id}`,
    order: 0,
    required: true,
    fill_region: {
      kind: 'heading_bounded',
      heading_text: '',
      heading_style_id: null,
      body_style_id: null,
      anchor_paragraph_index: 0,
      end_anchor_paragraph_index: 5,
      permitted_roles: ['body'],
    },
    intent,
  };
}

describe('scanSchemaForSubjectLeakage', () => {
  it('returns no warnings for genuinely subject-agnostic intents', () => {
    const sections = [
      makeSection('purpose', 'Define the document scope and applicability.'),
      makeSection('responsibilities', 'List the responsibilities of each stakeholder named in the policy.'),
      makeSection('procedure', 'Describe the procedure step by step.'),
    ];
    expect(scanSchemaForSubjectLeakage(sections)).toEqual([]);
  });

  it('flags an intent that names SHARP', () => {
    const sections = [
      makeSection(
        'sharp_purpose',
        'Define the SHARP program scope and identify Sapphire responsibilities.',
      ),
    ];
    const warnings = scanSchemaForSubjectLeakage(sections);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.flagged_tokens).toContain('SHARP');
    expect(warnings[0]?.flagged_tokens).toContain('Sapphire');
  });

  it('flags transfusion-services baked-in subject matter', () => {
    const sections = [
      makeSection(
        'mission_essential',
        'Identify Diasorin Liaison personnel as Mission Essential and provide Justification for the Priority Designation.',
      ),
    ];
    const warnings = scanSchemaForSubjectLeakage(sections);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.flagged_tokens).toContain('Diasorin');
    expect(warnings[0]?.flagged_tokens).toContain('Liaison');
  });

  it('does not flag whitelisted structural acronyms (PWS, DHA, FAR)', () => {
    const sections = [
      makeSection(
        'scope',
        'State the scope of the PWS using FAR-defined contracting terms and DHA conventions.',
      ),
    ];
    expect(scanSchemaForSubjectLeakage(sections)).toEqual([]);
  });

  it('does not flag the first word even when TitleCase', () => {
    const sections = [
      makeSection('scope', 'Define the section scope clearly.'),
      makeSection('responsibilities', 'List responsibilities for each role.'),
    ];
    expect(scanSchemaForSubjectLeakage(sections)).toEqual([]);
  });

  it('flags style_notes containing proper nouns', () => {
    const section = makeSection('scope', 'Define the scope.');
    section.style_notes = 'Follow the SHARP style voice used by the unit.';
    const warnings = scanSchemaForSubjectLeakage([section]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.flagged_tokens).toContain('SHARP');
  });

  it('requires at least 2 flagged tokens before warning (single proper noun is tolerable)', () => {
    // One flagged token (Sapphire) shouldn't trip the warning — could be
    // a single genuine reference. Two or more strongly suggests baked-in
    // subject matter.
    const sections = [
      makeSection('memo', 'Address the memorandum to the Sapphire team.'),
    ];
    expect(scanSchemaForSubjectLeakage(sections)).toEqual([]);
  });
});
