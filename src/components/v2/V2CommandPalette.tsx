import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface V2CommandPaletteProps {
  onClose: () => void;
  setView: (view: string) => void;
}

export function V2CommandPalette({ onClose, setView }: V2CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = [
    { id: 'workspace', label: 'Go to Workspace', action: () => { setView('workspace'); onClose(); } },
    { id: 'library', label: 'Go to Library', action: () => { setView('library'); onClose(); } },
    { id: 'audit', label: 'Go to Activity Log', action: () => { setView('audit'); onClose(); } },
    { id: 'settings', label: 'Go to Settings', action: () => { setView('settings'); onClose(); } },
    { id: 'projects', label: 'Switch Project', action: () => { navigate('/projects'); onClose(); } },
    { id: 'export', label: 'Export to Word', action: () => { /* Triggered in Layout */ onClose(); } },
  ];

  const filtered = commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    inputRef.current?.focus();
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      setActiveIndex(i => (i + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      setActiveIndex(i => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      filtered[activeIndex]?.action();
    }
  };

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="cp-head">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search commands..."
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="cp-body">
          {filtered.map((c, i) => (
            <div
              key={c.id}
              className={"cp-item " + (i === activeIndex ? "active" : "")}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={c.action}
            >
              {c.label}
            </div>
          ))}
          {filtered.length === 0 && <div className="cp-empty">No commands found</div>}
        </div>
        <div className="cp-foot">
          <span className="kbd">↑↓</span> to navigate <span className="kbd">↵</span> to select <span className="kbd">esc</span> to close
        </div>
      </div>
    </div>
  );
}
