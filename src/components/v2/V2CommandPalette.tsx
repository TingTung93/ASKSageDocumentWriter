import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface V2CommandPaletteProps {
  onClose: () => void;
  setView: (view: string) => void;
}

type Cmd = {
  group: string;
  ic: string;
  label: string;
  desc?: string;
  trail?: string;
  run: () => void;
};

export function V2CommandPalette({ onClose, setView }: V2CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 20);
  }, []);

  const baseItems = useMemo<Cmd[]>(() => [
    { group: 'Navigate', ic: '▸', label: 'Draft workspace', desc: 'Three-pane co-writer view', trail: 'G D', run: () => setView('workspace') },
    { group: 'Navigate', ic: '▸', label: 'Library', desc: 'Templates & datasets', trail: 'G L', run: () => setView('library') },
    { group: 'Navigate', ic: '▸', label: 'Activity log', desc: 'Audit trail of model calls', trail: 'G A', run: () => setView('audit') },
    { group: 'Navigate', ic: '▸', label: 'Settings', desc: 'Connection, models, privacy', trail: 'G ,', run: () => setView('settings') },
    { group: 'Navigate', ic: '▸', label: 'Switch project', desc: 'Back to project list', trail: '', run: () => navigate('/projects') },
    { group: 'Actions', ic: '⇣', label: 'Export document…', desc: 'Word, PDF, or Markdown', trail: '⌘E', run: () => window.dispatchEvent(new CustomEvent('v2:open-export')) },
    { group: 'Actions', ic: '＋', label: 'Upload DOCX template', desc: 'Parse structure and placeholders', trail: '', run: () => { setView('library'); setTimeout(() => window.dispatchEvent(new CustomEvent('v2:open-ingest')), 100); } },
    { group: 'Actions', ic: '↻', label: 'Regenerate active section', desc: 'Re-draft with current context', trail: '⌘R', run: () => window.dispatchEvent(new CustomEvent('v2:regen-active')) },
    { group: 'Actions', ic: '✓', label: 'Accept all findings', desc: 'Apply cross-section review fixes', trail: '', run: () => window.dispatchEvent(new CustomEvent('v2:accept-findings')) },
  ], [navigate, setView]);

  const q = query.toLowerCase().trim();
  const items = q
    ? baseItems.filter(i => (i.label + ' ' + (i.desc || '') + ' ' + i.group).toLowerCase().includes(q))
    : baseItems;

  const groups: Record<string, Cmd[]> = {};
  items.forEach(i => { (groups[i.group] = groups[i.group] || []).push(i); });
  const flat = Object.values(groups).flat();

  const runIdx = (i: number) => { flat[i]?.run?.(); onClose(); };

  useEffect(() => { setIdx(0); }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); runIdx(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  let cursor = 0;

  return (
    <div className="cmdk-scrim" onClick={onClose}>
      <div className="cmdk-card" onClick={e => e.stopPropagation()}>
        <div className="cmdk-input-wrap">
          <span style={{ fontSize: 18, color: 'var(--ink-3)' }}>⌕</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Jump to section, run a command, or search…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <span className="cmdk-kbd">esc</span>
        </div>
        <div className="cmdk-list">
          {Object.entries(groups).map(([g, rows]) => (
            <div key={g}>
              <div className="cmdk-group-label">{g}</div>
              {rows.map((r) => {
                const myIdx = cursor++;
                return (
                  <div
                    key={myIdx}
                    className={"cmdk-item" + (myIdx === idx ? ' on' : '')}
                    onMouseEnter={() => setIdx(myIdx)}
                    onClick={() => runIdx(myIdx)}
                  >
                    <span className="ic">{r.ic}</span>
                    <span>{r.label}{r.desc && <span className="desc">{r.desc}</span>}</span>
                    <span className="trail">{r.trail}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              No matches for "{query}"
            </div>
          )}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
