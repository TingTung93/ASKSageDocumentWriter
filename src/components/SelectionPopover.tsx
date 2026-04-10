// Inline popover for selection-driven targeted edits.
//
// The user highlights one or more paragraphs in the Documents preview,
// and this popover anchors near the selection with a small instruction
// input and a row of common-case suggestion chips ("Fix grammar",
// "Tighten language", etc.). Submitting fires a single scoped LLM
// call via runScopedEdit(); the result feeds the existing accept/
// reject queue.
//
// This component is purely UI — the caller owns the LLM call and the
// resulting ops. That keeps the popover trivially testable and lets
// the caller show its own toasts on error.

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Spinner } from './Spinner';

interface SelectionPopoverProps {
  /** Anchor element / position. Use position: absolute over the preview. */
  anchorTop: number;
  anchorLeft: number;
  /** Currently selected paragraph indices. Used for the badge in the popover. */
  selectedIndices: number[];
  /** Called when the user submits an instruction. Caller fires the LLM call. */
  onSubmit: (instruction: string) => void;
  /** Called when the user dismisses (Escape, click outside, or cancel button). */
  onCancel: () => void;
  /** Loading flag — disable input + show spinner during LLM call. */
  loading: boolean;
}

/** Common-case instructions — one click to populate and submit. */
const SUGGESTION_CHIPS: ReadonlyArray<string> = [
  'Fix grammar',
  'Tighten language',
  'Make more formal',
  'Convert to passive voice',
];

export function SelectionPopover(props: SelectionPopoverProps): JSX.Element {
  const { anchorTop, anchorLeft, selectedIndices, onSubmit, onCancel, loading } =
    props;

  const [value, setValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the input on mount so the user can start typing
  // immediately after releasing the selection drag.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Click-outside dismissal. Only active when not loading — we don't
  // want a stray click to abandon an in-flight LLM call's UI state.
  useEffect(() => {
    if (loading) return;
    function onDocMouseDown(e: MouseEvent) {
      const node = containerRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        onCancel();
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onCancel, loading]);

  // Focus trap — keep Tab cycling within the popover while it's open.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    function onKeyDownTrap(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const focusable = container!.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKeyDownTrap);
    return () => document.removeEventListener('keydown', onKeyDownTrap);
  }, [loading]);

  function tryCommit(instruction: string) {
    const trimmed = instruction.trim();
    if (trimmed.length === 0 || loading) return;
    onSubmit(trimmed);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      tryCommit(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (!loading) onCancel();
    }
  }

  function onChipClick(chip: string) {
    if (loading) return;
    setValue(chip);
    tryCommit(chip);
  }

  const count = selectedIndices.length;
  const badge = `${count} paragraph${count === 1 ? '' : 's'} selected`;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Targeted edit"
      style={{
        position: 'absolute',
        top: anchorTop,
        left: anchorLeft,
        zIndex: 50,
        minWidth: '22rem',
        maxWidth: '28rem',
        padding: '0.75rem 0.9rem',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: '0.5rem',
        boxShadow: '0 8px 24px rgba(15, 20, 40, 0.18)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        color: 'var(--color-text)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            padding: '0.15rem 0.5rem',
            borderRadius: '999px',
            background: 'var(--color-primary-soft)',
            color: 'var(--color-primary)',
          }}
        >
          {badge}
        </span>
        <span
          style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}
          aria-hidden
        >
          Enter to submit, Esc to cancel
        </span>
      </div>

      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={loading}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Describe the edit (e.g. tighten this)"
        aria-label="Edit instruction"
        style={{
          width: '100%',
          padding: '0.45rem 0.6rem',
          border: '1px solid var(--color-border)',
          borderRadius: '0.35rem',
          fontSize: '0.9rem',
          background: loading ? 'var(--color-surface-alt)' : 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
      />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.35rem',
        }}
        role="group"
        aria-label="Suggested instructions"
      >
        {SUGGESTION_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={loading}
            onClick={() => onChipClick(chip)}
            style={{
              padding: '0.25rem 0.6rem',
              fontSize: '0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: '999px',
              background: 'var(--color-surface-alt)',
              color: 'var(--color-text)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {chip}
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.4rem',
          marginTop: '0.1rem',
        }}
      >
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={loading || value.trim().length === 0}
          onClick={() => tryCommit(value)}
          style={{
            minWidth: '5.5rem',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.35rem',
          }}
        >
          {loading ? <Spinner light label="Editing" /> : 'Apply edit'}
        </button>
      </div>
    </div>
  );
}
