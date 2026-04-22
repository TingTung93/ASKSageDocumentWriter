// Extracted from Co-Writer.html — loaded via <script type="text/babel" src>.
// Components are attached to window for cross-file sharing.

// ── Settings view ───────────────────────────────────────────────
const { useState: useStateSet } = React;

function SettingsView({ onClose }) {
  const [section, setSection] = useStateSet("connection");
  const [provider, setProvider] = useStateSet("asksage");
  const [apiKey, setApiKey] = useStateSet("asks_live_••••••••••••••••••••3F2a");
  const [baseUrl, setBaseUrl] = useStateSet("https://api.asksage.ai/server");
  const [showKey, setShowKey] = useStateSet(false);
  const [temp, setTemp] = useStateSet(30);
  const [maxTok, setMaxTok] = useStateSet(4096);
  const [critic, setCritic] = useStateSet(true);
  const [webSearch, setWebSearch] = useStateSet(true);
  const [telemetry, setTelemetry] = useStateSet(false);
  const [autosave, setAutosave] = useStateSet(true);
  const [budget, setBudget] = useStateSet(50);
  const [auditPII, setAuditPII] = useStateSet(true);

  return (
    <div className="settings-wrap" data-screen-label="02 Settings">
      <div className="settings-inner">
        <div className="settings-eyebrow">Workspace settings</div>
        <h1 className="settings-title">Configuration</h1>
        <p className="settings-lead">How the co-writer talks to your AI provider, which models it uses, and the guardrails it applies. Your API key never leaves this browser.</p>

        <div className="settings-grid">
          <nav className="settings-nav">
            <button className={section==='connection'?'on':''} onClick={()=>setSection('connection')}><span className="bullet"/><span>Connection</span></button>
            <button className={section==='models'?'on':''} onClick={()=>setSection('models')}><span className="bullet"/><span>Models & routing</span></button>
            <button className={section==='drafting'?'on':''} onClick={()=>setSection('drafting')}><span className="bullet"/><span>Drafting behavior</span></button>
            <button className={section==='rag'?'on':''} onClick={()=>setSection('rag')}><span className="bullet"/><span>RAG & datasets</span></button>
            <button className={section==='privacy'?'on':''} onClick={()=>setSection('privacy')}><span className="bullet"/><span>Privacy & audit</span></button>
            <button className={section==='usage'?'on':''} onClick={()=>setSection('usage')}><span className="bullet"/><span>Usage & billing</span></button>
            <button className={section==='danger'?'on':''} onClick={()=>setSection('danger')}><span className="bullet"/><span>Reset & data</span></button>
          </nav>

          <div>
            {section === 'connection' && (
              <>
                <div className="s-card">
                  <div className="s-head">
                    <div>
                      <h3>Provider</h3>
                      <div className="s-desc">Pick which service fulfills completions and embeddings.</div>
                    </div>
                    <span className="s-status"><span className="d"/>connected</span>
                  </div>
                  <div className="provider-cards">
                    <div className={"provider-card" + (provider==='asksage'?' on':'')} onClick={()=>setProvider('asksage')}>
                      <div className="pc-head"><span className="pc-mark">A</span>
                        <div><div className="pc-name">Ask Sage</div><div className="pc-url">api.asksage.ai</div></div>
                      </div>
                      <div className="pc-feats"><span>completions</span><span>datasets</span><span>file extraction</span><span>web search</span></div>
                    </div>
                    <div className={"provider-card" + (provider==='openrouter'?' on':'')} onClick={()=>setProvider('openrouter')}>
                      <div className="pc-head"><span className="pc-mark" style={{background:provider==='openrouter'?'var(--accent)':'var(--ink)',color:'var(--paper)'}}>R</span>
                        <div><div className="pc-name">OpenRouter</div><div className="pc-url">openrouter.ai/api/v1</div></div>
                      </div>
                      <div className="pc-feats"><span>completions</span><span>embeddings</span><span>web plugins</span></div>
                    </div>
                  </div>

                  <div className="s-row two">
                    <div className="s-field">
                      <label>API key</label>
                      <div className="input-row">
                        <input type={showKey?"text":"password"} className="mono" value={apiKey} onChange={e=>setApiKey(e.target.value)} />
                        <button onClick={()=>setShowKey(s=>!s)}>{showKey?"Hide":"Show"}</button>
                      </div>
                      <div className="hint">Stored in browser session storage only · never sent anywhere except your chosen provider.</div>
                    </div>
                    <div className="s-field">
                      <label>Base URL</label>
                      <div className="input-row">
                        <input type="text" className="mono" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} />
                        <button>Test</button>
                      </div>
                      <div className="hint">Last handshake: <span style={{color:'var(--sage)',fontFamily:'var(--font-mono)'}}>200 OK · 142ms</span></div>
                    </div>
                  </div>

                  <div className="s-actions">
                    <button className="btn">Disconnect</button>
                    <button className="btn btn-primary">Save connection</button>
                  </div>
                </div>

                <div className="s-card">
                  <div className="s-head">
                    <div><h3>Network</h3><div className="s-desc">How outbound requests are made.</div></div>
                  </div>
                  <div className="s-toggle">
                    <div className="s-toggle-text">
                      <div className="s-toggle-label">Retry on transient failures</div>
                      <div className="s-toggle-desc">Automatically retry 429 and 5xx responses with exponential backoff, up to 3 attempts.</div>
                    </div>
                    <div className="switch on"/>
                  </div>
                  <div className="s-toggle">
                    <div className="s-toggle-text">
                      <div className="s-toggle-label">Route all traffic through proxy</div>
                      <div className="s-toggle-desc">For environments that require outbound traffic through an approved enterprise proxy.</div>
                    </div>
                    <div className="switch"/>
                  </div>
                </div>
              </>
            )}

            {section === 'models' && (
              <>
                <div className="s-card">
                  <div className="s-head">
                    <div><h3>Model routing</h3><div className="s-desc">Different stages use different models. Cheaper models for the first-pass draft; stronger ones for review and synthesis.</div></div>
                  </div>
                  <div className="model-row">
                    <div><div className="mr-name">gpt-4o</div><div className="hint">Section drafting · template synthesis</div></div>
                    <span className="mr-role primary">primary</span>
                    <div className="mr-cost">$5.00 / $15.00 <button className="mr-swap">swap ›</button></div>
                  </div>
                  <div className="model-row">
                    <div><div className="mr-name">claude-3-5-haiku</div><div className="hint">Critic loop · cross-section review</div></div>
                    <span className="mr-role critic">critic</span>
                    <div className="mr-cost">$1.00 / $5.00 <button className="mr-swap">swap ›</button></div>
                  </div>
                  <div className="model-row">
                    <div><div className="mr-name">text-embedding-3-large</div><div className="hint">Reference chunk selection · semantic search</div></div>
                    <span className="mr-role embed">embeddings</span>
                    <div className="mr-cost">$0.13 / 1M <button className="mr-swap">swap ›</button></div>
                  </div>
                  <div className="s-toggle" style={{marginTop:14,borderTop:'1px solid var(--line)'}}>
                    <div className="s-toggle-text">
                      <div className="s-toggle-label">Fall back to Jaccard when embeddings are unavailable</div>
                      <div className="s-toggle-desc">Degrades gracefully if the embedding endpoint returns errors — draft quality drops but the pipeline keeps going.</div>
                    </div>
                    <div className="switch on"/>
                  </div>
                </div>

                <div className="s-card">
                  <div className="s-head"><div><h3>Generation parameters</h3><div className="s-desc">Applied per completion unless a recipe overrides.</div></div></div>
                  <div className="s-row two">
                    <div className="s-field">
                      <label>Temperature</label>
                      <div className="s-slider">
                        <input type="range" min="0" max="100" value={temp} onChange={e=>setTemp(+e.target.value)} />
                        <div className="val">{(temp/100).toFixed(2)}</div>
                      </div>
                      <div className="hint">Lower = more deterministic. DHA guidance drafts default to 0.30.</div>
                    </div>
                    <div className="s-field">
                      <label>Max output tokens</label>
                      <div className="s-slider">
                        <input type="range" min="512" max="16384" step="256" value={maxTok} onChange={e=>setMaxTok(+e.target.value)} />
                        <div className="val">{maxTok.toLocaleString()}</div>
                      </div>
                      <div className="hint">Per section. Full document is assembled from multiple calls.</div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {section === 'drafting' && (
              <div className="s-card">
                <div className="s-head"><div><h3>Drafting behavior</h3><div className="s-desc">How the co-writer composes a long document.</div></div></div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Critic re-draft loop</div>
                    <div className="s-toggle-desc">After each section drafts, a second model scores it against the section instructions and requests a re-draft if quality is below threshold. Slower and more expensive but produces noticeably better PWS-style prose.</div>
                  </div>
                  <div className={"switch" + (critic?' on':'')} onClick={()=>setCritic(v=>!v)}/>
                </div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Cross-section review</div>
                    <div className="s-toggle-desc">Scan the assembled draft for contradictions, terminology drift, and missing cross-references before export.</div>
                  </div>
                  <div className="switch on"/>
                </div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Ask clarifying questions</div>
                    <div className="s-toggle-desc">When key template inputs (POP, clearance level, staffing ratios) are missing, pause and ask the user before drafting.</div>
                  </div>
                  <div className="switch on"/>
                </div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Stream section-by-section</div>
                    <div className="s-toggle-desc">Render prose in the draft pane as tokens arrive, instead of waiting for whole sections.</div>
                  </div>
                  <div className="switch on"/>
                </div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Keep template example text as ghost prompts</div>
                    <div className="s-toggle-desc">Pass the template's example prose to the drafter as style reference without emitting it verbatim.</div>
                  </div>
                  <div className={"switch" + (autosave?' on':'')} onClick={()=>setAutosave(v=>!v)}/>
                </div>
              </div>
            )}

            {section === 'rag' && (
              <div className="s-card">
                <div className="s-head">
                  <div><h3>RAG & datasets</h3><div className="s-desc">Which corpora the co-writer may retrieve from when drafting.</div></div>
                  <span className="s-status"><span className="d"/>3 datasets connected</span>
                </div>
                <div className="model-row">
                  <div><div className="mr-name">DHA Contracting Library</div><div className="hint">2,140 docs · last synced 04/18</div></div>
                  <span className="mr-role primary">default</span>
                  <div className="mr-cost"><button className="mr-swap">Resync</button></div>
                </div>
                <div className="model-row">
                  <div><div className="mr-name">Behavioral Health Clinical Guidance</div><div className="hint">384 docs · last synced 04/09</div></div>
                  <span className="mr-role embed">auto-attach</span>
                  <div className="mr-cost"><button className="mr-swap">Resync</button></div>
                </div>
                <div className="model-row">
                  <div><div className="mr-name">FAR / DFARS reference</div><div className="hint">pinned · auto-updated</div></div>
                  <span className="mr-role critic">web</span>
                  <div className="mr-cost"><button className="mr-swap">Unpin</button></div>
                </div>
                <div className="s-toggle" style={{marginTop:14, borderTop:'1px solid var(--line)'}}>
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Web search during drafting</div>
                    <div className="s-toggle-desc">Allow the co-writer to fetch FAR/DFARS and public policy pages mid-draft when template instructions request a citation.</div>
                  </div>
                  <div className={"switch" + (webSearch?' on':'')} onClick={()=>setWebSearch(v=>!v)}/>
                </div>
              </div>
            )}

            {section === 'privacy' && (
              <div className="s-card">
                <div className="s-head"><div><h3>Privacy & audit</h3><div className="s-desc">What leaves the browser and what gets logged.</div></div></div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Keep all drafts in browser IndexedDB</div>
                    <div className="s-toggle-desc">Default. No draft content is ever sent outside your chosen provider. Clearing site data wipes drafts permanently.</div>
                  </div>
                  <div className="switch on"/>
                </div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Redact PII before upload</div>
                    <div className="s-toggle-desc">Detect and mask names, SSNs, DoD IDs, and phone numbers in attached reference files before sending them to the model.</div>
                  </div>
                  <div className={"switch" + (auditPII?' on':'')} onClick={()=>setAuditPII(v=>!v)}/>
                </div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Anonymous usage telemetry</div>
                    <div className="s-toggle-desc">Send aggregate counters (feature used, error rates) to Ask Sage. No document content, no prompts.</div>
                  </div>
                  <div className={"switch" + (telemetry?' on':'')} onClick={()=>setTelemetry(v=>!v)}/>
                </div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Full audit log</div>
                    <div className="s-toggle-desc">Record every model request — prompt, context, response, tokens, cost. Exportable as JSON for FOIA / records-retention.</div>
                  </div>
                  <div className="switch on"/>
                </div>
              </div>
            )}

            {section === 'usage' && (
              <>
                <div className="s-card">
                  <div className="s-head"><div><h3>This month</h3><div className="s-desc">April 1 — April 21</div></div></div>
                  <div className="usage-grid">
                    <div className="usage-stat"><div className="k">Tokens in</div><div className="v">612,480</div></div>
                    <div className="usage-stat"><div className="k">Tokens out</div><div className="v">148,922</div></div>
                    <div className="usage-stat"><div className="k">Cost</div><div className="v" style={{color:'var(--accent)'}}>$8.14</div></div>
                  </div>
                  <div className="s-field">
                    <label>Monthly spending cap</label>
                    <div className="s-slider">
                      <input type="range" min="0" max="500" step="5" value={budget} onChange={e=>setBudget(+e.target.value)} />
                      <div className="val">${budget}</div>
                    </div>
                    <div className="usage-bar"><div className="usage-bar-fill" style={{width:`${Math.min(100, (8.14/budget)*100)}%`}}/></div>
                    <div className="hint">You'll get a warning at 80% and drafting pauses at 100%. Admin approval required to raise.</div>
                  </div>
                </div>
                <div className="s-card">
                  <div className="s-head"><div><h3>Per-project breakdown</h3></div></div>
                  <div className="model-row"><div><div className="mr-name">Embedded Behavioral Health — PWS</div><div className="hint">14,281 tokens · 8 sections</div></div><div/><div className="mr-cost">$4.22</div></div>
                  <div className="model-row"><div><div className="mr-name">Telehealth Expansion J&A</div><div className="hint">9,044 tokens · 6 sections</div></div><div/><div className="mr-cost">$2.81</div></div>
                  <div className="model-row"><div><div className="mr-name">MEDDAC Fort Cavazos — Market Research</div><div className="hint">3,102 tokens · 4 sections</div></div><div/><div className="mr-cost">$1.11</div></div>
                </div>
              </>
            )}

            {section === 'danger' && (
              <div className="s-card danger-card">
                <div className="s-head"><div><h3>Reset & data</h3><div className="s-desc">Irreversible. Export first if you might want it back.</div></div></div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Export all projects as .asdbundle.json</div>
                    <div className="s-toggle-desc">Includes templates, drafts, references, and settings. Can be re-imported on another machine.</div>
                  </div>
                  <button className="btn">Export</button>
                </div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label">Clear API key from this browser</div>
                    <div className="s-toggle-desc">You'll need to paste it back in to draft again. Drafts stay.</div>
                  </div>
                  <button className="btn">Clear key</button>
                </div>
                <div className="s-toggle">
                  <div className="s-toggle-text">
                    <div className="s-toggle-label" style={{color:'var(--rose)'}}>Delete all local data</div>
                    <div className="s-toggle-desc">Wipes drafts, templates, datasets index, and settings from this browser's IndexedDB. Cannot be undone.</div>
                  </div>
                  <button className="btn" style={{borderColor:'var(--rose)',color:'var(--rose)'}}>Delete everything</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

window.SettingsView = SettingsView;
