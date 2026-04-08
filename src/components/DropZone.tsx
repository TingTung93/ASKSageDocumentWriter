// Drag-and-drop file picker. Wraps a hidden <input type="file"> with
// a styled drop area that responds to dragenter/dragover/drop events.
// On drop or click, calls onFile with the picked File. Supports a
// single file selection (the multi-file case can be added later).

import { useRef, useState, type DragEvent, type ChangeEvent } from 'react';

export interface DropZoneProps {
  /** Comma-separated list of accepted file extensions or MIME types */
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  label?: string;
  hint?: string;
}

export function DropZone({
  accept,
  disabled,
  onFile,
  label = 'Drop a file here, or click to choose',
  hint,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setDragging(true);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }

  function handleClick() {
    if (disabled) return;
    inputRef.current?.click();
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = '';
  }

  const borderColor = disabled ? '#ccc' : dragging ? '#2050a0' : '#aaa';
  const bg = dragging ? '#eef' : '#fafafa';

  return (
    <div
      onClick={handleClick}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      style={{
        border: `2px dashed ${borderColor}`,
        background: bg,
        borderRadius: 6,
        padding: '1.25rem 1rem',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: '#333' }}>{label}</div>
      {hint && (
        <div className="note" style={{ marginTop: '0.25rem' }}>
          {hint}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileInput}
        disabled={disabled}
        style={{ display: 'none' }}
      />
    </div>
  );
}
