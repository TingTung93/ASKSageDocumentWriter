import { DRAFT_ACTIONS, type DraftAction } from './actions';

export function DraftActionBar({
  disabled,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (action: DraftAction) => void;
}) {
  return (
    <div aria-label="Draft editing actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {DRAFT_ACTIONS.map((action) => (
        <button
          className="btn btn-sm"
          disabled={disabled}
          key={action.id}
          onClick={() => onSelect(action)}
          type="button"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
