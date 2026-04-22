// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

// ── First-run onboarding ──────────────────────────────────────
function FirstRun({ onDone }) {
  return (
    <div className="first-run">
      <div className="first-run-card">
        <div className="fr-eye">First run · local workstation</div>
        <h2>Let's get you drafting</h2>
        <p>The co-writer runs entirely in this browser — no account, no backend. You just need an API key so it can talk to your AI provider.</p>
        <ol className="fr-steps">
          <li><span className="n">1</span><span>Paste your Ask Sage or OpenRouter key in Settings</span></li>
          <li><span className="n">2</span><span>Drop a DOCX template to define the structure</span></li>
          <li><span className="n">3</span><span>Start a project, attach reference docs, and draft</span></li>
        </ol>
        <div className="fr-actions">
          <button className="btn" onClick={onDone}>Skip tour</button>
          <button className="btn btn-accent" onClick={onDone}>Open Settings →</button>
        </div>
      </div>
    </div>
  );
}
window.FirstRun = FirstRun;
