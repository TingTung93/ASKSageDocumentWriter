import React, { useState, useRef, useEffect } from 'react';
import type { ProjectRecord, ProjectContextNote } from '../../lib/db/schema';
import { addProjectNote } from '../../lib/project/context';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db/schema';
import { useRecipe } from './RecipeContext';
import { V2InterventionCard } from './V2InterventionCard';
import { FILL_PLACEHOLDERS_STAGE_ID } from '../../lib/agent/recipes/pws';

interface V2ChatPaneProps {
  project: ProjectRecord;
}

interface SlashCommand {
  key: string;
  ic: string;
  label: string;
  desc: string;
  event: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { key: '/regen', ic: '↻', label: 'regen', desc: 'Re-draft the active section from scratch', event: 'v2:slash-regen' },
  { key: '/expand', ic: '⇱', label: 'expand', desc: 'Add depth and supporting detail to the active section', event: 'v2:slash-expand' },
  { key: '/tighten', ic: '⇲', label: 'tighten', desc: 'Cut filler; keep one idea per sentence', event: 'v2:slash-tighten' },
  { key: '/cite', ic: '⁂', label: 'cite', desc: 'Add or strengthen inline citations from attached sources', event: 'v2:slash-cite' },
  { key: '/rewrite', ic: '✎', label: 'rewrite', desc: 'Rewrite with a new tone or audience (prompts for target)', event: 'v2:slash-rewrite' },
];

export function V2ChatPane({ project }: V2ChatPaneProps) {
  const [input, setInput] = useState("");
  const [slashIdx, setSlashIdx] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { currentRun, isRunning, resumeRecipe } = useRecipe();
  const allTemplates = useLiveQuery(() => db.templates.toArray(), []);
  
  const notes = (project.context_items ?? []).filter((item): item is ProjectContextNote => item.kind === 'note');

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [notes, currentRun, isRunning]);

  const handleResume = async () => {
    if (!project || !allTemplates) return;
    const projectTemplates = allTemplates.filter((t) => project.template_ids.includes(t.id));
    await resumeRecipe(project, projectTemplates);
  };

  const isAtPlaceholderStage = currentRun?.status === 'paused' && 
    Object.entries(currentRun.stage_states).some(([id, st]) => id === FILL_PLACEHOLDERS_STAGE_ID && st.status === 'needs_intervention');

  const placeholderOutput = isAtPlaceholderStage 
    ? (currentRun?.stage_states[FILL_PLACEHOLDERS_STAGE_ID]?.output as any)
    : null;

  const slashQuery = input.startsWith('/') ? input.slice(1).split(/\s/)[0].toLowerCase() : null;
  const filteredSlash = slashQuery !== null
    ? SLASH_COMMANDS.filter((c) => c.label.startsWith(slashQuery))
    : [];
  const showSlash = slashQuery !== null && filteredSlash.length > 0;

  useEffect(() => { setSlashIdx(0); }, [slashQuery]);

  const runSlash = (cmd: SlashCommand) => {
    window.dispatchEvent(new CustomEvent(cmd.event));
    setInput('');
    textareaRef.current?.focus();
  };

  const submit = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    await addProjectNote(project.id, text, 'user');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (showSlash) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, filteredSlash.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = filteredSlash[slashIdx];
        if (cmd) runSlash(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className="pane">
      <div className="pane-head">
        <div className="pane-title">
          <h2>Chat</h2>
          <span className="count">{notes.length} turns</span>
        </div>
        <div className="pane-actions">
          <button className="icon-btn" title="Branch">⎇</button>
          <button className="icon-btn" title="Clear">⌫</button>
          <button className="icon-btn" title="More">⋯</button>
        </div>
      </div>

      <div className="pane-body" ref={bodyRef}>
        <div className="chat-body">
          <div className="msg system">
            <div className="who">⚐</div>
            <div style={{minWidth:0, flex:1}}>
              <div className="msg-body">
                <b>Workspace ready</b> · {project.name}
                <br/>
                Add notes or files to provide context, then use the Auto-draft button to begin.
              </div>
            </div>
          </div>
          
          {notes.map(note => (
            <div key={note.id} className={"msg " + (note.role === 'user' ? 'user' : 'ai')}>
              <div className="who">{note.role === 'user' ? 'U' : 'A'}</div>
              <div style={{minWidth:0, flex: 1}}>
                <div className="msg-name">
                  {note.role === 'user' ? 'You' : 'Assistant'}
                  <span className="time">{new Date(note.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <div className="msg-body">
                  <p style={{whiteSpace: 'pre-wrap'}}>{note.text}</p>
                </div>
              </div>
            </div>
          ))}

          {isAtPlaceholderStage && placeholderOutput && allTemplates && (
            <V2InterventionCard
              project={project}
              templates={allTemplates}
              stageOutput={placeholderOutput}
              onApplied={handleResume}
              isRunning={isRunning}
            />
          )}

          {isRunning && (
            <div className="msg ai">
              <div className="who">A</div>
              <div style={{minWidth:0}}>
                <div className="msg-name">
                  Co-Writer
                  <span className="thinking" style={{marginLeft:4}}>
                    <span className="thinking-pulse"><span/><span/><span/></span>
                    {currentRun?.recipe_name || 'Running...'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="composer" style={{ position: 'relative' }}>
        {showSlash && (
          <div className="slash-menu">
            <div className="slash-menu-header">Slash commands</div>
            {filteredSlash.map((cmd, i) => (
              <div
                key={cmd.key}
                className={"slash-item" + (i === slashIdx ? ' on' : '')}
                onMouseEnter={() => setSlashIdx(i)}
                onClick={() => runSlash(cmd)}
              >
                <span className="ic">{cmd.ic}</span>
                <span>
                  <span style={{ fontWeight: 500 }}>{cmd.label}</span>
                  <span style={{ color: 'var(--ink-3)', marginLeft: 8, fontSize: 11.5 }}>{cmd.desc}</span>
                </span>
                <span className="slash-key">↵</span>
              </div>
            ))}
          </div>
        )}
        <div className="composer-inner">
          <textarea
            ref={textareaRef}
            placeholder="Ask, refine, or add context — ⏎ to send, ⇧⏎ for newline, / for commands"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={2}
          />
          <div className="composer-row">
            <div className="composer-chips">
               {/* Placeholders for context chips */}
               <span className="chip on">Project Context <span className="x">×</span></span>
            </div>
            <div className="send-row">
              <button className={"send-btn " + (input.trim() ? "" : "disabled")} title="Send (⏎)" onClick={submit}>↑</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
