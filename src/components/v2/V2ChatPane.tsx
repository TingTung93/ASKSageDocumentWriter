import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { ProjectRecord, ProjectContextNote } from '../../lib/db/schema';
import { addProjectNote } from '../../lib/project/context';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db/schema';
import { useRecipe } from './RecipeContext';
import { isPlaceholderStageOutput, V2InterventionCard } from './V2InterventionCard';
import { FILL_PLACEHOLDERS_STAGE_ID } from '../../lib/agent/recipes/pws';
import { useDraftActionController } from './drafting';
import type { DraftCommandId } from './drafting/DraftActionController';

interface V2ChatPaneProps {
  project: ProjectRecord;
}

export function V2ChatPane({ project }: V2ChatPaneProps) {
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const { currentRun, isRunning, resumeRecipe } = useRecipe();
  const allTemplates = useLiveQuery(() => db.templates.toArray(), []);
  const draftActions = useDraftActionController();
  
  const notes = useMemo(
    () => (project.context_items ?? []).filter((item): item is ProjectContextNote => item.kind === 'note'),
    [project.context_items],
  );

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

  const rawPlaceholderOutput = isAtPlaceholderStage
    ? currentRun?.stage_states[FILL_PLACEHOLDERS_STAGE_ID]?.output
    : null;
  const placeholderOutput = isPlaceholderStageOutput(rawPlaceholderOutput)
    ? rawPlaceholderOutput
    : null;

  const submit = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    const slash = parseSlashCommand(text);
    if (slash) {
      const handled = slash.kind === 'preset'
        ? draftActions.run(slash.command)
        : draftActions.runInstruction(slash.instruction);
      if (!handled) setInput(text);
      return;
    }
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
            <div className="msg ai" aria-live="polite" role="status">
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
        <div className="composer-inner">
          <textarea
            aria-label="Project note or edit command"
            placeholder={draftActions.active
              ? 'Add a note, or use /tighten, /expand, /clarify, /tone, /edit…'
              : 'Add project context — ⏎ to send, ⇧⏎ for newline'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={2}
          />
          <div className="composer-row">
            <div className="composer-chips" />
            <div className="send-row">
              <button
                aria-label="Send project note or edit command"
                className={"send-btn " + (input.trim() ? "" : "disabled")}
                disabled={!input.trim()}
                title="Send (⏎)"
                onClick={submit}
              >↑</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type ParsedSlash =
  | { kind: 'preset'; command: DraftCommandId }
  | { kind: 'custom'; instruction: string };

export function parseSlashCommand(value: string): ParsedSlash | null {
  const trimmed = value.trim();
  const presets: Record<string, DraftCommandId> = {
    '/tighten': 'tighten',
    '/expand': 'expand',
    '/clarify': 'clarify',
    '/tone': 'tone',
  };
  if (presets[trimmed.toLowerCase()]) {
    return { kind: 'preset', command: presets[trimmed.toLowerCase()]! };
  }
  if (trimmed.toLowerCase().startsWith('/edit ')) {
    const instruction = trimmed.slice(6).trim();
    return instruction ? { kind: 'custom', instruction } : null;
  }
  return null;
}
