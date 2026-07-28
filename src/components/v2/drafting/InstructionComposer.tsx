import { useEffect, useRef, useState } from 'react';

export function InstructionComposer({
  busy,
  initialInstruction = '',
  onSubmit,
  focusRequest = 0,
}: {
  busy?: boolean;
  initialInstruction?: string;
  onSubmit: (instruction: string) => void;
  focusRequest?: number;
}) {
  const [instruction, setInstruction] = useState(initialInstruction);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);
  const trimmed = instruction.trim();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && !busy) onSubmit(trimmed);
      }}
      style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}
    >
      <label style={{ flex: 1 }}>
        <span className="sr-only">Custom editing instruction</span>
        <textarea
          ref={inputRef}
          aria-label="Custom editing instruction"
          disabled={busy}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Describe the change you want…"
          rows={2}
          style={{ width: '100%', resize: 'vertical' }}
          value={instruction}
        />
      </label>
      <button className="btn btn-accent btn-sm" disabled={busy || !trimmed} type="submit">
        {busy ? 'Generating…' : 'Preview change'}
      </button>
    </form>
  );
}
