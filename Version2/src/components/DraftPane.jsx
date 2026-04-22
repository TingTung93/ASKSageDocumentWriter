// Right pane — the draft itself (the document being synthesized)
const { useState: useStateDraft } = React;

function Cite({ n, active, setActive }) {
  const [hover, setHover] = React.useState(false);
  const data = window.CITE_EXCERPTS && window.CITE_EXCERPTS[n];
  return (
    <span
      className={"cite" + (active === n ? " active" : "")}
      onMouseEnter={() => { setActive(n); setHover(true); }}
      onMouseLeave={() => { setActive(null); setHover(false); }}
    >
      {n}
      {hover && data && (
        <span className="cite-hover">
          <span className="cite-hover-head">
            <span className="cite-hover-kind">{data.kind}</span>
            <span className="cite-hover-title">{data.title}</span>
          </span>
          <p className="cite-hover-excerpt">{data.excerpt}</p>
          <div className="cite-hover-meta">{data.meta} · cited once</div>
        </span>
      )}
    </span>
  );
}

function SectionToolbar() {
  return (
    <div className="sec-toolbar">
      <button title="Regenerate">↻ regen</button>
      <button title="Ask about">✎ refine</button>
      <button title="Accept">✓</button>
      <button title="More">⋯</button>
    </div>
  );
}

const VERSIONS = [
  { id:'v04', label:'v0.4 — current', time:'just now', desc:'Section 1.3 re-drafted with SLA targets' },
  { id:'v03', label:'v0.3', time:'12 min ago', desc:'First full pass complete · 8/8 sections' },
  { id:'v02', label:'v0.2', time:'2 hr ago', desc:'Clarifying questions answered, template re-applied' },
  { id:'v01', label:'v0.1', time:'Apr 21, 9:14a', desc:'Initial skeleton from PWS template' },
];

function DraftPane({ state, activeCite, setActiveCite }) {
  const [spy, setSpy] = React.useState('sec-13');
  const [versionOpen, setVersionOpen] = React.useState(false);
  const bodyRef = React.useRef(null);
  const pushToast = useToast();

  React.useEffect(() => {
    const body = bodyRef.current; if (!body) return;
    const onScroll = () => {
      const ids = ['sec-11','sec-12','sec-13','sec-21','sec-22'];
      for (const id of ids) {
        const el = document.getElementById(id); if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top > 80) { setSpy(id); return; }
        if (r.bottom > 80) { setSpy(id); return; }
      }
    };
    body.addEventListener('scroll', onScroll, {passive:true});
    return () => body.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    const onDoc = (e) => { if (versionOpen && !e.target.closest('.version-pop') && !e.target.closest('[data-vbtn]')) setVersionOpen(false); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [versionOpen]);

  const statusChip =
    state === "drafting" ? <span className="draft-status drafting"><span className="dot"/>drafting 3/8</span>
    : state === "review" ? <span className="draft-status review"><span className="dot"/>cross-section review</span>
    : state === "done" ?   <span className="draft-status done"><span className="dot"/>draft complete</span>
    :                      <span className="draft-status"><span className="dot"/>draft</span>;

  const findingsMode = state === "review" || state === "done";

  return (
    <section className="pane">
      <div className="draft-head">
        <div className="draft-title">
          <span className="draft-name">EBH Services — PWS · Walter Reed.docx</span>
          {statusChip}
        </div>
        <div className="pane-actions">
          <div style={{position:'relative'}}>
            <button data-vbtn className="btn btn-ghost" title="Version history" onClick={e => { e.stopPropagation(); setVersionOpen(v=>!v); }}>⟲ v0.4</button>
            {versionOpen && (
              <div className="version-pop">
                <div className="version-head">Version history</div>
                {VERSIONS.map((v,i) => (
                  <div key={v.id} className={"version-row" + (i===0?' current':'')} onClick={() => { setVersionOpen(false); pushToast({text:'Restored '+v.label, icon:'⟲', tone:'accent', undo: ()=>pushToast({text:'Restore undone', icon:'↶'})}); }}>
                    <div className="v-label">{v.label}</div>
                    <div className="v-time">{v.time}</div>
                    <div className="v-desc">{v.desc}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn">Preview</button>
          <button className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent("open-export"))}>Export ▾</button>
        </div>
      </div>

      <div className="draft-toc">
        {window.SECTIONS.map(s => (
          <button key={s.id}
            className={"toc-chip " + s.status + (spy==='sec-'+s.num.replace('.','') ? ' spy-active' : '')}
            onClick={() => { const el = document.getElementById('sec-'+s.num.replace('.','')); if(el) el.scrollIntoView({behavior:'smooth', block:'start'}); }}>
            <span className="dot" />
            §{s.num} {s.title}
          </button>
        ))}
      </div>

      <div className="pane-body" ref={bodyRef} style={{background: 'var(--surface)'}}>
        <div className="draft-doc">
          <header className="doc-header">
            <div className="doc-eyebrow">Performance Work Statement</div>
            <h1 className="doc-title">Embedded Behavioral Health Services</h1>
            <div className="doc-sub">Walter Reed National Military Medical Center · PWS-25-EBH-104 · Draft</div>
          </header>

          {/* 1.1 */}
          <article className="doc-section" id="sec-11">
            <SectionToolbar />
            <div className="sec-num">§ 1.1  Background</div>
            <h3>Background</h3>
            <p>
              The Defense Health Agency (DHA) requires Embedded Behavioral Health (EBH) services at
              Walter Reed National Military Medical Center to support active-duty service members,
              beneficiaries, and retirees assigned to supported commands. EBH integrates licensed
              clinicians directly into operational units to deliver timely, mission-aligned
              behavioral health care while preserving warfighter readiness<Cite n={1} active={activeCite} setActive={setActiveCite}/>.
            </p>
            <p>
              This contract establishes a full-service EBH team under the clinical oversight
              framework defined in DHA-PI 6490.01<Cite n={2} active={activeCite} setActive={setActiveCite}/>,
              with patient records, orders, and continuity of care documented in MHS GENESIS.
            </p>
          </article>

          {/* 1.2 */}
          <article className="doc-section" id="sec-12">
            <SectionToolbar />
            <div className="sec-num">§ 1.2  Scope of Services</div>
            <h3>Scope of Services</h3>
            <p>
              The Contractor shall provide licensed and credentialed behavioral health
              professionals to deliver individual psychotherapy, group therapy, medication
              management, and command-directed evaluations for a covered beneficiary
              population of approximately 13,400 service members<Cite n={1} active={activeCite} setActive={setActiveCite}/>.
              Staffing shall maintain a ratio of one (1) full-time clinician per 750 covered
              beneficiaries, rounded up, yielding a baseline team of eighteen (18) FTEs.
            </p>
            <ul>
              <li>Licensed Clinical Social Workers (LCSW) — 10 FTE</li>
              <li>Licensed Clinical Psychologists (Ph.D. / Psy.D.) — 6 FTE</li>
              <li>Psychiatric Mental Health Nurse Practitioners (PMHNP) — 2 FTE</li>
            </ul>
            <p>
              All personnel shall hold and maintain a Tier 3 (Secret) personnel security
              clearance and complete MHS GENESIS clinical workflow training prior to
              seeing patients<Cite n={4} active={activeCite} setActive={setActiveCite}/><Cite n={5} active={activeCite} setActive={setActiveCite}/>.
            </p>
          </article>

          {/* 1.3 — active */}
          <article className={"doc-section " + (state === "drafting" ? "streaming" : "")} id="sec-13">
            <SectionToolbar />
            <div className="sec-num">
              § 1.3  Performance Objectives
              {state === "drafting" && <span style={{marginLeft:10,fontSize:10,color:'var(--gold)',fontFamily:'var(--font-mono)'}}>● drafting · 62%</span>}
            </div>
            <h3>Performance Objectives</h3>
            <p>
              Services shall be measured against the following performance objectives.
              Metrics are reported monthly through the Quality Assurance Surveillance Plan
              (QASP) and reviewed at the monthly Program Management Review<Cite n={6} active={activeCite} setActive={setActiveCite}/>.
            </p>
            <ul>
              <li><b>Access to care.</b> 90% of routine intake appointments scheduled within 7 calendar days of request.</li>
              <li><b>No-show mitigation.</b> Documented outreach for 100% of no-shows within 24 hours.</li>
              <li><b>Clinical documentation.</b> 98% of encounter notes signed in MHS GENESIS within 72 hours of visit<Cite n={5} active={activeCite} setActive={setActiveCite}/>.</li>
              <li><b>Readiness coordination.</b> Contractor shall coordinate with unit leadership on profile recommendations in alignment with FAR Part 37 service-contract boundaries<Cite n={7} active={activeCite} setActive={setActiveCite}/>.</li>
            </ul>
            {state === "drafting" && (
              <p style={{color:'var(--ink-3)'}}>
                Additional objectives for crisis response and command consultation<span className="streaming-caret"/>
              </p>
            )}

            {findingsMode && (
              <div className="sec-finding">
                <span className="ico">◆</span>
                <div>
                  <b>Cross-section check:</b> §3.1 references a 95% documentation target; this section says 98%. Align the two.
                </div>
                <button className="fix" onClick={() => pushToast({text:'Aligned §1.3 and §3.1 to 98% · critic approved', icon:'✓', tone:'sage', undo: ()=>{}})}>Fix both →</button>
              </div>
            )}
          </article>

          {/* Only show more if not drafting */}
          {state !== "drafting" && (
            <>
              <article className="doc-section" id="sec-21">
                <SectionToolbar />
                <div className="sec-num">§ 2.1  Staffing & Qualifications</div>
                <h3>Staffing & Qualifications</h3>
                <p>
                  The Contractor shall ensure every clinician holds a current, unrestricted
                  state license in the state of practice and meets the credentialing
                  standards published by the Joint Commission and DHA<Cite n={2} active={activeCite} setActive={setActiveCite}/>.
                  Substitutions shall be submitted to the Contracting Officer's Representative
                  (COR) with equivalent or superior qualifications no later than five (5)
                  business days prior to a change of personnel.
                </p>
              </article>

              <article className="doc-section" id="sec-22">
                <SectionToolbar />
                <div className="sec-num">§ 2.2  Credentialing & Privileging</div>
                <h3>Credentialing &amp; Privileging</h3>
                <p>
                  Credentialing packages shall be submitted via the Centralized Credentials
                  Quality Assurance System (CCQAS) within 30 days of contract award. The
                  Contractor shall maintain primary source verification for licensure, board
                  certifications, and malpractice history throughout the period of performance.
                </p>
              </article>
            </>
          )}
        </div>

        {/* Cross-section review card at bottom */}
        {findingsMode && (
          <div className="review-summary">
            <div className="review-card">
              <div className="review-head">
                <h4>Cross-section review</h4>
                <span className="done-chip">✓ review complete</span>
              </div>
              <div className="review-stats">
                <div className="review-stat"><div className="k">Sections</div><div className="v">8 / 8</div></div>
                <div className="review-stat"><div className="k">Tokens</div><div className="v">14,281</div></div>
                <div className="review-stat"><div className="k">Findings</div><div className="v accent">3</div></div>
                <div className="review-stat"><div className="k">Cost</div><div className="v">$0.42</div></div>
              </div>
              <div className="review-findings">
                <div className="finding-row">
                  <span className="sev warn">◆ align</span>
                  <div>Documentation-timeliness target differs between §1.3 (98%) and §3.1 (95%). Pick one.</div>
                  <button className="jump" onClick={()=>document.getElementById('sec-13')?.scrollIntoView({behavior:'smooth'})}>→ jump</button>
                </div>
                <div className="finding-row">
                  <span className="sev info">◆ note</span>
                  <div>§5.1 Period of Performance is missing an option-year pricing reference — PWS template calls for one.</div>
                  <button className="jump">→ jump</button>
                </div>
                <div className="finding-row">
                  <span className="sev rose">◆ check</span>
                  <div>Terminology drift: "service member", "warfighter", and "beneficiary" all used interchangeably. Recommend "service member" as primary.</div>
                  <button className="jump">→ jump</button>
                </div>
              </div>
            </div>
            <div style={{height:40}}/>
          </div>
        )}
      </div>
    </section>
  );
}

window.DraftPane = DraftPane;
