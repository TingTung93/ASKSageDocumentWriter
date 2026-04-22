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

export function V2ChatPane({ project }: V2ChatPaneProps) {
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
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

  const submit = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    await addProjectNote(project.id, text, 'user');
  };

  const onKey = (e: React.KeyboardEvent) => {
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

      <div className="composer">
        <div className="composer-inner">
          <textarea
            placeholder="Ask, refine, or add context — ⏎ to send, ⇧⏎ for newline"
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
