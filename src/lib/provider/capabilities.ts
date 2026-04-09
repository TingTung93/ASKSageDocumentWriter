// Per-stage model capability requirements + a validator that decides
// whether a given ModelInfo is fit for a given pipeline stage. Used by
// the Settings model picker to filter OpenRouter's huge catalog (~300+
// entries on a typical day) down to models that will actually work
// without surprising the user mid-run.
//
// Design notes:
//
//   - Ask Sage's `/server/get-models` endpoint does not return any
//     capability metadata. So when `capabilities` is undefined we
//     treat the model as "unknown" and PASS validation. The filter is
//     a guard rail for OpenRouter, not a blocklist for Ask Sage.
//
//   - We never assert capability fields the model row didn't include.
//     OpenRouter populates `context_length` and `architecture` for
//     virtually every model, but `supported_parameters` is sometimes
//     missing or empty. Missing == unknown == pass.
//
//   - Stage requirements come from reading the actual call sites:
//
//       synthesis  → src/lib/template/synthesis/synthesize.ts
//       drafting   → src/lib/draft/drafter.ts (largest context — pulls
//                    references + template example + prior sections)
//       critic     → src/lib/draft/critique.ts (draft + prompt)
//       cleanup    → src/lib/document/edit.ts
//       schema_edit→ src/lib/edit/schema-edit.ts
//
//     Every stage uses `queryJson` (temperature 0, JSON parsed from the
//     completion). We don't pass `response_format`, so models without
//     a JSON-mode parameter still work — we strip code fences and
//     parse. The only request knob the pipeline depends on today is
//     `temperature`.

import type { ModelCapabilities, ModelInfo } from '../asksage/types';
import type { ModelStage } from '../settings/types';

export interface StageRequirement {
  /** Minimum context window (tokens) the stage needs to operate safely. */
  min_context_length: number;
  /**
   * Modalities the stage MUST be able to send. Currently every stage
   * is text-only, but listing it explicitly future-proofs the check
   * and lets us reject vision/audio-only models that slip into the
   * OpenRouter catalog.
   */
  required_input_modalities: readonly string[];
  /** Modalities the stage MUST be able to receive. */
  required_output_modalities: readonly string[];
  /**
   * Request parameters the stage relies on. Today: `temperature` (we
   * always pass 0). If a model's `supported_parameters` array is
   * present and missing one of these, we reject. If the array is
   * absent entirely, we pass — see "missing == unknown == pass" above.
   */
  required_parameters: readonly string[];
}

export const STAGE_REQUIREMENTS: Record<ModelStage, StageRequirement> = {
  // Whole-template one-shot. Skeleton + system prompt run ~5–8K
  // tokens; 16K gives headroom for larger templates.
  synthesis: {
    min_context_length: 16_000,
    required_input_modalities: ['text'],
    required_output_modalities: ['text'],
    required_parameters: ['temperature'],
  },
  // Highest-context stage. Drafting inlines references, the template
  // example block, and previously-drafted sections. 32K is the floor
  // we've measured against real DHA PWS templates without truncation.
  drafting: {
    min_context_length: 32_000,
    required_input_modalities: ['text'],
    required_output_modalities: ['text'],
    required_parameters: ['temperature'],
  },
  // Critic sees the section + draft + revision history; 16K is plenty.
  critic: {
    min_context_length: 16_000,
    required_input_modalities: ['text'],
    required_output_modalities: ['text'],
    required_parameters: ['temperature'],
  },
  // Cleanup pages a single DOCX through paragraph-batched calls — each
  // call is small but the system prompt + op catalog adds ~1K of
  // overhead. 8K is comfortable.
  cleanup: {
    min_context_length: 8_000,
    required_input_modalities: ['text'],
    required_output_modalities: ['text'],
    required_parameters: ['temperature'],
  },
  // Schema edit is small, surgical patches against an in-memory schema.
  schema_edit: {
    min_context_length: 8_000,
    required_input_modalities: ['text'],
    required_output_modalities: ['text'],
    required_parameters: ['temperature'],
  },
};

export interface CompatibilityResult {
  compatible: boolean;
  /**
   * Human-readable failure reasons. Empty when `compatible` is true.
   * Populated even when only some capability fields were knowable —
   * we surface what we DID check so the UI can explain the verdict.
   */
  reasons: string[];
}

/**
 * Decide whether a model can be used for a given pipeline stage.
 *
 * Returns `compatible: true` for any model with no capability data
 * (i.e. Ask Sage models, or OpenRouter rows that didn't return the
 * relevant fields). The filter is intentionally permissive: we'd
 * rather let an unknown model through than hide a working model from
 * the user.
 */
export function validateModelForStage(
  model: ModelInfo,
  stage: ModelStage,
): CompatibilityResult {
  const req = STAGE_REQUIREMENTS[stage];
  const caps = model.capabilities;
  if (!caps) return { compatible: true, reasons: [] };

  const reasons: string[] = [];

  if (
    typeof caps.context_length === 'number' &&
    caps.context_length < req.min_context_length
  ) {
    reasons.push(
      `context window ${formatTokens(caps.context_length)} < required ${formatTokens(req.min_context_length)}`,
    );
  }

  const inMissing = missingModalities(caps.input_modalities, req.required_input_modalities);
  if (inMissing.length > 0) {
    reasons.push(`does not accept input modality: ${inMissing.join(', ')}`);
  }
  const outMissing = missingModalities(caps.output_modalities, req.required_output_modalities);
  if (outMissing.length > 0) {
    reasons.push(`does not produce output modality: ${outMissing.join(', ')}`);
  }

  const paramsMissing = missingParameters(caps.supported_parameters, req.required_parameters);
  if (paramsMissing.length > 0) {
    reasons.push(`missing required request parameter: ${paramsMissing.join(', ')}`);
  }

  return { compatible: reasons.length === 0, reasons };
}

/**
 * Convenience filter: keep only models compatible with the given stage.
 * Models with no capability data are kept (see validator semantics).
 */
export function filterModelsForStage(
  models: ModelInfo[],
  stage: ModelStage,
): ModelInfo[] {
  return models.filter((m) => validateModelForStage(m, stage).compatible);
}

// ─── Helpers ──────────────────────────────────────────────────────

function missingModalities(
  reported: ModelCapabilities['input_modalities'] | undefined,
  required: readonly string[],
): string[] {
  // Field absent → unknown → pass.
  if (!reported || reported.length === 0) return [];
  const set = new Set(reported.map((m) => m.toLowerCase()));
  return required.filter((m) => !set.has(m.toLowerCase()));
}

function missingParameters(
  reported: ModelCapabilities['supported_parameters'] | undefined,
  required: readonly string[],
): string[] {
  // Field absent → unknown → pass. OpenRouter omits this on a
  // non-trivial number of rows; treating absence as a failure would
  // hide ~30% of the catalog for no good reason.
  if (!reported || reported.length === 0) return [];
  const set = new Set(reported.map((p) => p.toLowerCase()));
  return required.filter((p) => !set.has(p.toLowerCase()));
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
