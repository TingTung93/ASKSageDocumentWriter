// Skeleton placeholder shown while docx-preview renders a document.
// CSS lives in index.css (.skeleton / .skeleton-line).

export function DocxSkeleton() {
  return (
    <div style={{ padding: '1rem' }} aria-hidden>
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="skeleton skeleton-line"
          style={{ width: i % 5 === 4 ? '60%' : i % 3 === 0 ? '90%' : '100%' }}
        />
      ))}
    </div>
  );
}
