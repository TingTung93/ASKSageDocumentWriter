import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface V2FirstRunProps {
  onDismiss: () => void;
}

export function V2FirstRun({ onDismiss }: V2FirstRunProps) {
  const navigate = useNavigate();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      triggerRef.current?.focus?.();
    };
  }, [onDismiss]);

  const openSettings = () => {
    onDismiss();
    navigate('/settings');
  };

  return (
    <div className="first-run">
      <div className="first-run-card">
        <div className="fr-eye">First run · local workstation</div>
        <h2>Let's get you drafting</h2>
        <p>
          The co-writer runs entirely in this browser with no backend. Add your provider key,
          bring DOCX templates or reference files, and export the finished draft back to Word.
        </p>
        <ol className="fr-steps">
          <li><span className="n">1</span><span>Use Ask Sage for CUI work or OpenRouter for non-CUI work</span></li>
          <li><span className="n">2</span><span>Upload a DOCX template or create a freeform project</span></li>
          <li><span className="n">3</span><span>Attach references, draft, review, and export a DOCX</span></li>
        </ol>
        <div className="fr-actions">
          <button className="btn" onClick={onDismiss}>Skip tour</button>
          <button ref={primaryRef} className="btn btn-accent" onClick={openSettings}>Open Settings →</button>
        </div>
      </div>
    </div>
  );
}
