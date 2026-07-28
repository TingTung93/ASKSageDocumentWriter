# V2 Cutover Policies

Status: approved implementation contract

## Interface ownership

V2 owns project creation, drafting, library, activity, settings, and project
export. These views are URL-backed under `/v2` and `/v2/:id`; browser
Back/Forward restores the selected view. Documents remains the separate
workflow for editing an existing DOCX. `/legacy/projects/:id` is a temporary
compatibility and data-recovery surface during the observation period.

## Recipe recovery

- Recovery loads only the newest durable run for the active project and never
  starts work automatically.
- A stale `running` row is presented as interrupted. Paused and interrupted
  runs may resume at the first incomplete stage.
- Completed stages are not replayed. Every stage must be idempotent with
  respect to durable records, and export always reassembles from durable data
  rather than replaying a stored download.
- Resume continues an interrupted or paused run. Retry starts at the first
  failed stage and resets only that stage and later stages. Completed runs
  cannot resume or retry.
- Starting, resuming, or retrying is single-flight. A second request while an
  operation is active is ignored.
- Provider-call counts after resume equal only the calls required by incomplete
  stages. Completed stages contribute zero new calls.

## Sensitive content

- Provider credentials, authorization headers, and credential-like nested
  values must never enter IndexedDB, logs, diagnostics, or exports. Recursive
  redaction is required at every diagnostic/export boundary.
- Project text, draft text, references, prompt excerpts, and response excerpts
  may be stored locally when required for drafting, recovery, audit, or user
  review. Tests and fixtures use synthetic content only.
- Audit exports may contain the visible audit excerpts. Diagnostic and document
  exports may contain project, reference, model, and draft content.
- Before a content-bearing export, the UI must disclose that document or model
  content is included and require an explicit user action to continue.
- Production diagnostics remain opt-in and closed by default.

## Export eligibility

- Only `ready` drafts are assembled. Templates with no ready drafts are
  reported as skipped.
- Assembly errors are reported per template and do not discard successful
  outputs from other templates.
- Mixed results are partial success, never complete success. The user may
  download successful outputs and retry failed or skipped templates after
  correcting their drafts.
- Filenames are derived from sanitized project/template names and a date.
  Downloads use fresh object URLs that are revoked after activation.
