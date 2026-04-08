// Single-input search box with a clear button. Standardized so every
// list view has the same affordance.

interface SearchFilterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchFilter({ value, onChange, placeholder }: SearchFilterProps) {
  return (
    <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        style={{ width: '100%', paddingRight: '2rem' }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          style={{
            position: 'absolute',
            right: '0.4rem',
            top: '50%',
            transform: 'translateY(-50%)',
            margin: 0,
            padding: '0.15rem 0.5rem',
            fontSize: 11,
            background: '#888',
            borderColor: '#888',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function matchesSearch(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}
