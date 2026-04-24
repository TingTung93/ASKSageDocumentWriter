import { useEffect, useRef, type ReactNode, type CSSProperties } from 'react';

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** Visible label or element id — one of these should be provided for SR context. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Class for the inner card. Defaults to "modal-card". */
  cardClassName?: string;
  /** Class for the backdrop. Defaults to "modal-scrim". */
  scrimClassName?: string;
  cardStyle?: CSSProperties;
  /** If false, clicking the backdrop does not close. Defaults to true. */
  closeOnScrimClick?: boolean;
}

const FOCUSABLE =
  'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function Modal({
  onClose,
  children,
  ariaLabel,
  ariaLabelledBy,
  cardClassName = 'modal-card',
  scrimClassName = 'modal-scrim',
  cardStyle,
  closeOnScrimClick = true,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    const card = cardRef.current;
    if (!card) return;

    const focusables = card.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusables[0] ?? card;
    first.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(
        card.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
      if (nodes.length === 0) {
        e.preventDefault();
        card.focus();
        return;
      }
      const firstEl = nodes[0];
      const lastEl = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      triggerRef.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className={scrimClassName}
      onClick={closeOnScrimClick ? onClose : undefined}
    >
      <div
        ref={cardRef}
        className={cardClassName}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
