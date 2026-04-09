import { describe, it, expect } from 'vitest';
import { filterModelsForStage, validateModelForStage } from './capabilities';
import type { ModelInfo } from '../asksage/types';

function model(id: string, capabilities?: ModelInfo['capabilities']): ModelInfo {
  return {
    id,
    name: id,
    object: 'model',
    owned_by: 'test',
    created: 'na',
    ...(capabilities ? { capabilities } : {}),
  };
}

describe('validateModelForStage', () => {
  it('passes models with no capability data (Ask Sage shape)', () => {
    const m = model('google-claude-46-sonnet');
    const r = validateModelForStage(m, 'drafting');
    expect(r.compatible).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('passes a high-context multimodal text model for drafting', () => {
    const m = model('anthropic/claude-3.5-sonnet', {
      context_length: 200_000,
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
      supported_parameters: ['temperature', 'top_p'],
    });
    expect(validateModelForStage(m, 'drafting').compatible).toBe(true);
  });

  it('rejects drafting when context window is below the 32K floor', () => {
    const m = model('tiny/4k-model', {
      context_length: 4096,
      input_modalities: ['text'],
      output_modalities: ['text'],
      supported_parameters: ['temperature'],
    });
    const r = validateModelForStage(m, 'drafting');
    expect(r.compatible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/context window/i);
  });

  it('allows the same 4K model for cleanup (8K floor) — wait, still rejects', () => {
    const m = model('tiny/4k-model', {
      context_length: 4096,
      input_modalities: ['text'],
      output_modalities: ['text'],
    });
    const r = validateModelForStage(m, 'cleanup');
    expect(r.compatible).toBe(false);
  });

  it('passes an 8K text model for cleanup but rejects it for drafting', () => {
    const m = model('mid/8k-model', {
      context_length: 8192,
      input_modalities: ['text'],
      output_modalities: ['text'],
    });
    expect(validateModelForStage(m, 'cleanup').compatible).toBe(true);
    expect(validateModelForStage(m, 'drafting').compatible).toBe(false);
  });

  it('rejects models that cannot accept text input', () => {
    const m = model('vision/audio-only', {
      context_length: 200_000,
      input_modalities: ['image'],
      output_modalities: ['text'],
    });
    const r = validateModelForStage(m, 'cleanup');
    expect(r.compatible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/input modality/i);
  });

  it('rejects models that cannot produce text output', () => {
    const m = model('audio/tts-only', {
      context_length: 200_000,
      input_modalities: ['text'],
      output_modalities: ['audio'],
    });
    const r = validateModelForStage(m, 'cleanup');
    expect(r.compatible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/output modality/i);
  });

  it('rejects models whose supported_parameters list omits temperature', () => {
    const m = model('weird/no-temperature', {
      context_length: 200_000,
      input_modalities: ['text'],
      output_modalities: ['text'],
      supported_parameters: ['top_p', 'max_tokens'],
    });
    const r = validateModelForStage(m, 'drafting');
    expect(r.compatible).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/temperature/i);
  });

  it('passes when supported_parameters is missing entirely (unknown == pass)', () => {
    const m = model('opaque/model', {
      context_length: 200_000,
      input_modalities: ['text'],
      output_modalities: ['text'],
    });
    expect(validateModelForStage(m, 'drafting').compatible).toBe(true);
  });

  it('passes when modality fields are missing entirely (unknown == pass)', () => {
    const m = model('opaque/model', { context_length: 200_000 });
    expect(validateModelForStage(m, 'drafting').compatible).toBe(true);
  });
});

describe('filterModelsForStage', () => {
  it('keeps compatible + unknown models, drops incompatible ones', () => {
    const models: ModelInfo[] = [
      model('ask-sage/sonnet'), // unknown — keep
      model('big/200k', {
        context_length: 200_000,
        input_modalities: ['text'],
        output_modalities: ['text'],
      }), // keep
      model('tiny/4k', {
        context_length: 4096,
        input_modalities: ['text'],
        output_modalities: ['text'],
      }), // drop for drafting (32K floor)
    ];
    const filtered = filterModelsForStage(models, 'drafting');
    expect(filtered.map((m) => m.id)).toEqual(['ask-sage/sonnet', 'big/200k']);
  });
});
