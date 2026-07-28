import type { DocumentEditOp } from '../document/types';
import type { DraftEditOp, SchemaEditOp } from '../edit/types';
import type { OpenAIToolCall } from '../asksage/types';
import type { ProviderId } from '../provider/types';

export type EditingTargetKind = 'uploaded_document' | 'template_draft' | 'freeform_draft';

export interface EditingTargetRef {
  kind: EditingTargetKind;
  targetId: string;
  projectId?: string;
  templateId?: string;
  sectionId?: string;
  selectionId?: string;
}

export type EditingSessionStatus =
  | 'preparing'
  | 'running'
  | 'validating'
  | 'awaiting_approval'
  | 'awaiting_connection'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'superseded'
  | 'cancelled';

export type EditingTurnStatus =
  | 'preparing'
  | 'running'
  | 'validating'
  | 'awaiting_plan_approval'
  | 'awaiting_tool_approval'
  | 'awaiting_user_approval'
  | 'awaiting_approval'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'superseded'
  | 'cancelled'
  | 'budget_exceeded';

export interface CapabilityEvidence {
  source: 'provider' | 'model' | 'endpoint_probe' | 'local_runtime';
  capability: keyof Omit<AgentCapabilities, 'evidence'>;
  value: boolean;
  reason: string;
}

export interface AgentCapabilities {
  nativeTools: boolean;
  jsonSchemaOutput: boolean;
  promptJsonOutput: boolean;
  embeddings: boolean;
  providerDatasets: boolean;
  liveSearch: boolean;
  localReferenceSearch: boolean;
  localDocumentInspection: boolean;
  evidence: CapabilityEvidence[];
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  kind: 'content' | 'grounding' | 'style' | 'structure' | 'formatting' | 'consistency';
  required: boolean;
  source: 'user' | 'template' | 'learned_preference' | 'system';
}

export interface ContextManifestEntry {
  id: string;
  label: string;
  kind: 'target' | 'template' | 'reference' | 'history' | 'preference' | 'surrounding';
  characterCount: number;
  included: boolean;
  omissionReason?: string;
}

export interface ContextManifest {
  id: string;
  entries: ContextManifestEntry[];
  characterCount: number;
  maxCharacterCount: number;
}

export interface EditPlanStep {
  id: string;
  description: string;
  targetIds: string[];
}

export interface EditPlan {
  summary: string;
  scope: {
    sectionIds: string[];
    paragraphIds: string[];
    broadDocumentChange: boolean;
  };
  steps: EditPlanStep[];
  requiredContext: string[];
  risks: string[];
}

export type AgentEditOperation =
  | { target: 'uploaded_document'; operation: DocumentEditOp }
  | { target: 'template_schema'; operation: SchemaEditOp }
  | { target: 'draft_paragraphs'; operation: DraftEditOp };

export interface EvidenceReference {
  id: string;
  label: string;
  excerpt?: string;
}

export interface EditProposal {
  summary: string;
  operations: AgentEditOperation[];
  criterionCoverage: Array<{
    criterionId: string;
    operationIndexes: number[];
    explanation: string;
  }>;
  evidence: EvidenceReference[];
  assumptions: string[];
  unresolvedQuestions: string[];
}

export interface EditCritique {
  verdict: 'pass' | 'repair' | 'needs_user';
  score: number;
  criteria: Array<{
    criterionId: string;
    satisfied: boolean;
    explanation: string;
    repairInstruction?: string;
  }>;
  unsupportedClaims: string[];
  structuralRisks: string[];
  styleIssues: string[];
  repairInstructions: string[];
}

export interface EditValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  appliedOperationIndexes: number[];
}

export interface WorkflowError {
  code:
    | 'connection'
    | 'authentication'
    | 'rate_limit'
    | 'provider_unsupported'
    | 'tool_transport'
    | 'tool_execution'
    | 'invalid_model_output'
    | 'validation'
    | 'stale_base_version'
    | 'budget_exceeded'
    | 'cancelled'
    | 'checkpoint'
    | 'unknown';
  message: string;
  detail?: string;
}

export type AgentTraceEventType =
  | 'turn.started'
  | 'node.queued'
  | 'node.started'
  | 'node.completed'
  | 'node.failed'
  | 'node.cancelled'
  | 'node.skipped'
  | 'route.selected'
  | 'model.request'
  | 'model.response'
  | 'tool.requested'
  | 'tool.approval_requested'
  | 'tool.approved'
  | 'tool.rejected'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'validation.completed'
  | 'checkpoint.saved'
  | 'user.decision'
  | 'turn.completed';

export interface AgentTraceEvent {
  id: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  timestamp: string;
  spanId: string;
  parentSpanId?: string;
  node: string;
  attempt: number;
  type: AgentTraceEventType;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
  summary: string;
  reason?: string;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  checkpointId?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  error?: WorkflowError;
}

export type AgentTraceArtifactKind =
  | 'rendered_prompt'
  | 'canonical_query_input'
  | 'provider_request'
  | 'provider_response'
  | 'tool_arguments'
  | 'tool_result'
  | 'context_manifest'
  | 'context_excerpt'
  | 'edit_plan'
  | 'edit_proposal'
  | 'critique'
  | 'validation_report'
  | 'diff_summary'
  | 'error_detail';

export interface AgentTraceArtifact {
  id: string;
  sessionId: string;
  turnId: string;
  kind: AgentTraceArtifactKind;
  mediaType: 'application/json' | 'text/plain';
  content: string;
  sha256: string;
  createdAt: string;
  containsDocumentContent: boolean;
  truncated: boolean;
  originalCharacterCount?: number;
}

export interface EditingSessionRecord {
  id: string;
  target_kind: EditingTargetKind;
  target_id: string;
  project_id?: string;
  status: EditingSessionStatus;
  active_turn_id?: string;
  status_changed_at?: string;
  status_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface EditingTurnRecord {
  id: string;
  session_id: string;
  parent_turn_id?: string;
  target: EditingTargetRef;
  base_version_id: string;
  result_version_id?: string;
  instruction: string;
  acceptance_criteria: AcceptanceCriterion[];
  plan?: EditPlan;
  proposal?: EditProposal;
  critique?: EditCritique;
  validation?: EditValidationReport;
  provider_id: ProviderId;
  models_used: string[];
  execution_path?: 'tool_assisted' | 'prompt_only' | 'tool_fallback';
  user_decision?: 'accepted' | 'rejected' | 'refined' | 'cancelled';
  status: EditingTurnStatus;
  status_changed_at?: string;
  status_reason?: string;
  created_at: string;
  completed_at?: string;
}

export interface DocumentVersionRecord {
  id: string;
  target_kind: EditingTargetKind;
  target_id: string;
  parent_version_id?: string;
  source_turn_id?: string;
  label: string;
  status: 'preview' | 'accepted' | 'superseded';
  snapshot_json: string;
  created_at: string;
}

export interface StoredAgentCheckpoint {
  id: string;
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id?: string;
  payload_json: string;
  metadata_json?: string;
  pending_writes_json?: string;
  updated_at: string;
}

export interface LearnedPreference {
  id: string;
  project_id?: string;
  document_id?: string;
  instruction: string;
  scope: 'global' | 'project' | 'document' | 'section';
  source_turn_id: string;
  status: 'proposed' | 'accepted' | 'retired';
  created_at: string;
  accepted_at?: string;
}

export interface EditingWorkflowLimits {
  maxModelCalls: number;
  maxToolCycles: number;
  maxToolCalls: number;
  maxRepairPasses: number;
  maxElapsedMs: number;
  maxContextCharacters: number;
}

export interface EditingGraphState {
  sessionId: string;
  turnId: string;
  target: EditingTargetRef;
  baseVersionId: string;
  instruction: string;
  providerId: ProviderId;
  model: string;
  acceptanceCriteria: AcceptanceCriterion[];
  contextManifest?: ContextManifest;
  plan?: EditPlan;
  capabilities?: AgentCapabilities;
  proposal?: EditProposal;
  critique?: EditCritique;
  validation?: EditValidationReport;
  previewVersionId?: string;
  pendingToolCalls: OpenAIToolCall[];
  repairPass: number;
  modelCallCount: number;
  toolCallCount: number;
  tokensIn: number;
  tokensOut: number;
  startedAt: string;
  deadlineAt: string;
  warnings: string[];
  error?: WorkflowError;
}
