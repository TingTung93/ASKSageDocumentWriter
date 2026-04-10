// Inline help tooltip — a small "?" icon that reveals an explanation
// on click or hover. Designed for non-technical users who need extra
// context without cluttering the primary UI.

import { useState, useRef, useEffect, type ReactNode } from 'react';

interface HelpTipProps {
  /** The help text shown inside the tooltip */
  children: ReactNode;
  /** Optional label shown next to the "?" icon (e.g. "What's this?") */
  label?: string;
}

export function HelpTip({ children, label }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <span className="help-tip-wrapper" ref={ref}>
      <button
        type="button"
        className="help-tip-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label ?? 'Help'}
        title={label ?? 'Click for help'}
      >
        ?
      </button>
      {label && (
        <span
          className="help-tip-label"
          onClick={() => setOpen((v) => !v)}
          style={{ cursor: 'pointer' }}
        >
          {label}
        </span>
      )}
      {open && (
        <span className="help-tip-bubble" role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
}
