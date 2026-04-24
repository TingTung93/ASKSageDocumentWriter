import type { KeyboardEvent, RefObject } from 'react';
import type { ProviderId } from '../../lib/provider/types';

export interface V2ProviderCardProps {
  provider: ProviderId;
  mark: string;
  name: string;
  url: string;
  features: string[];
  selected: boolean;
  onSelect: (provider: ProviderId) => void;
  onArrowNav?: (direction: 'prev' | 'next') => void;
  inputRef?: RefObject<HTMLDivElement>;
}

export function V2ProviderCard({
  provider,
  mark,
  name,
  url,
  features,
  selected,
  onSelect,
  onArrowNav,
  inputRef,
}: V2ProviderCardProps) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(provider);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onArrowNav?.('next');
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onArrowNav?.('prev');
    }
  }

  return (
    <div
      ref={inputRef}
      className={'provider-card' + (selected ? ' on' : '')}
      onClick={() => onSelect(provider)}
      onKeyDown={onKeyDown}
      role="radio"
      aria-checked={selected}
      // Roving tabindex: only the selected card is in the tab sequence so
      // Tab lands on the current value, arrows move between options.
      tabIndex={selected ? 0 : -1}
    >
      <div className="pc-head">
        <span className="pc-mark">{mark}</span>
        <div>
          <div className="pc-name">{name}</div>
          <div className="pc-url">{url}</div>
        </div>
      </div>
      <div className="pc-feats">
        {features.map((f) => (
          <span key={f}>{f}</span>
        ))}
      </div>
    </div>
  );
}
