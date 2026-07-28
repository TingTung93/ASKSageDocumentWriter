import { useState } from 'react';

export function InstructionComposer({
  busy,
  initialInstruction = '',
  onSubmit,
}: {
  busy?: boolean;
  initialInstruction?: string;
  onSubmit: (instruction: string) => void;
}) {
  const [instruction, setInstruction] = useState(initialInstruction);
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
