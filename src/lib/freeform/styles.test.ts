import { describe, it, expect } from 'vitest';
import {
  FREEFORM_STYLES,
  FREEFORM_STYLE_MAP,
  FREEFORM_CATEGORIES,
  getFreeformStyle,
} from './styles';

describe('FREEFORM_STYLES registry', () => {
  it('has unique style ids', () => {
    const ids = FREEFORM_STYLES.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every style has a non-empty name, description, outline, and tone', () => {
    for (const s of FREEFORM_STYLES) {
      expect(s.id, `${s.id} id`).toMatch(/^[a-z0-9_]+$/);
      expect(s.name, `${s.id} name`).toBeTruthy();
      expect(s.description, `${s.id} description`).toBeTruthy();
      expect(s.outline.length, `${s.id} outline`).toBeGreaterThan(0);
      expect(s.tone_guidance, `${s.id} tone`).toBeTruthy();
    }
  });

  it('every style has every {{placeholder}} wired in its system_prompt', () => {
    const required = ['{{STYLE_NAME}}', '{{OUTLINE}}', '{{TONE}}', '{{PROJECT_DESCRIPTION}}', '{{CONTEXT}}'];
    for (const s of FREEFORM_STYLES) {
      for (const token of required) {
        expect(s.system_prompt, `${s.id} missing ${token}`).toContain(token);
      }
    }
  });

  it('exposes the new award_bullets style', () => {
    const award = getFreeformStyle('award_bullets');
    expect(award).toBeDefined();
    expect(award!.category).toBe('administrative');
    expect(award!.outline).toContain('Achievement Bullets');
    // Tone guidance must include the bang-bang-bang formatting
    // expectation so the system prompt actually instructs the model.
    expect(award!.tone_guidance).toMatch(/past-tense|action verb/i);
    expect(award!.tone_guidance).toMatch(/metric/i);
  });

  it('point_paper tone bans throat-clearing openers', () => {
    const pp = getFreeformStyle('point_paper');
    expect(pp).toBeDefined();
    expect(pp!.tone_guidance).toMatch(/This paper/i);
    expect(pp!.tone_guidance).toMatch(/The purpose of/i);
    expect(pp!.tone_guidance).toMatch(/throat-clearing/i);
  });

  it('FREEFORM_STYLE_MAP stays in sync with FREEFORM_STYLES', () => {
    expect(FREEFORM_STYLE_MAP.size).toBe(FREEFORM_STYLES.length);
    for (const s of FREEFORM_STYLES) {
      expect(FREEFORM_STYLE_MAP.get(s.id)).toBe(s);
    }
  });

  it('every style belongs to a declared category', () => {
    const categoryIds = new Set(FREEFORM_CATEGORIES.map((c) => c.id));
    for (const s of FREEFORM_STYLES) {
      expect(categoryIds.has(s.category), `${s.id} category ${s.category} not in FREEFORM_CATEGORIES`).toBe(true);
    }
  });

  it('returns undefined for unknown style id', () => {
    expect(getFreeformStyle('does_not_exist')).toBeUndefined();
  });
});
