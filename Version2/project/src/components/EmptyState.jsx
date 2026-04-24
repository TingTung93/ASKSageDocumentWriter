// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

function EmptyState() {
  return (
    <div className="empty-wrap">
      <div className="empty">
        <div className="mark-lg">A</div>
        <h1>Start a new draft</h1>
        <p>Describe what you need in plain language — a PWS, a J&amp;A, a staffing memo — and I'll pull from your attached sources and connected datasets to draft it section by section.</p>

        <div className="empty-starters">
          <div className="starter">
            <div className="starter-kind">PWS</div>
            <div className="starter-title">Performance Work Statement</div>
            <div className="starter-desc">Services contract · FAR Part 37 · outcome-based</div>
          </div>
          <div className="starter">
            <div className="starter-kind">J&amp;A</div>
            <div className="starter-title">Justification &amp; Approval</div>
            <div className="starter-desc">Sole-source or limited-source rationale</div>
          </div>
          <div className="starter">
            <div className="starter-kind">Market research</div>
            <div className="starter-title">Market research report</div>
            <div className="starter-desc">Capability search, vendor scan, NAICS fit</div>
          </div>
          <div className="starter">
            <div className="starter-kind">Memo</div>
            <div className="starter-title">Staff memo</div>
            <div className="starter-desc">For record / info / decision</div>
          </div>
        </div>
      </div>
    </div>
  );
}
