// Center pane — chat
const { useState: useStateChat, useRef: useRefChat, useEffect: useEffectChat } = React;

function Msg({ m, setActiveCite }) {
  const initials = m.role === "user" ? "TN" : (m.role === "system" ? "⚐" : "A");
  return (
    <div className={"msg " + m.role}>
      <div className="who">{initials}</div>
      <div style={{minWidth:0}}>
        <div className="msg-name">
          {m.name}
          <span className="time">{m.time}</span>
          {m.status === "drafting" && (
            <span className="thinking" style={{marginLeft:4}}>
              <span className="thinking-pulse"><span/><span/><span/></span>
              drafting
            </span>
          )}
        </div>
        <div className="msg-body">
          {m.body.map((p, i) => <p key={i}>{p}</p>)}

          {m.tool && (
            <div className="tool-card">
              <div className="tool-title"><span className="icon">⎘</span>{m.tool.title}</div>
              <ul className="tool-list">
                {m.tool.rows.map((r, i) => (
                  <li key={i}>
                    <span className="check">✓</span>
                    <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.text}</span>
                    <span className="n">{r.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {m.followup && <p style={{marginTop:10}}>{m.followup}</p>}
          {m.questions && (
            <ol style={{margin:'6px 0 0', paddingLeft:20, color:'var(--ink-2)'}}>
              {m.questions.map((q, i) => <li key={i} style={{marginBottom:4}}>{q}</li>)}
            </ol>
          )}

          {m.progress && (
            <div className="tool-card" style={{marginTop:10}}>
              <div className="tool-title"><span className="icon" style={{background:'var(--accent-soft)', color: 'var(--accent-ink)', borderColor:'oklch(0.85 0.05 255)'}}>✎</span>drafting plan</div>
              <ul className="tool-list">
                {m.progress.done.map((d, i) => (
                  <li key={i}><span className="check">✓</span><span>{d}</span><span className="n">done</span></li>
                ))}
                <li><span style={{color:'var(--gold)'}}>●</span><span style={{color:'var(--ink)', fontWeight:500}}>{m.progress.active}</span><span className="n" style={{color:'var(--gold)'}}>streaming</span></li>
                <li><span style={{color:'var(--ink-4)'}}>○</span><span style={{color:'var(--ink-3)'}}>+ {m.progress.queued} more sections queued</span></li>
              </ul>
            </div>
          )}

          {m.applyable && (
            <div className="apply-strip">
              <button className="primary">Draft anyway →</button>
              <button>Answer questions</button>
              <button>Edit plan</button>
            </div>
          )}
        </div>
        <div className="msg-actions">
          <button className="msg-action">↺ retry</button>
          <button className="msg-action">⧉ copy</button>
          <button className="msg-action">⇱ insert in draft</button>
        </div>
      </div>
    </div>
  );
}

const SLASH_CMDS = [
  { key:'regen', ic:'↻', label:'Regenerate this section', desc:'/regen'},
  { key:'expand', ic:'⇲', label:'Expand with more detail', desc:'/expand'},
  { key:'tighten', ic:'⇱', label:'Tighten — cut 25% of words', desc:'/tighten'},
  { key:'cite', ic:'¶', label:'Add a citation from sources', desc:'/cite'},
  { key:'rewrite', ic:'✎', label:'Rewrite in plain-language tone', desc:'/rewrite'},
  { key:'slashes', ic:'⌘', label:'Show all slash commands', desc:'/?'},
];

function ChatPane({ setActiveCite }) {
  const [input, setInput] = useStateChat("");
  const [chips, setChips] = useStateChat([
    { id: "ctx", label: "§1.3 Performance Objectives", on: true },
    { id: "src", label: "4 sources + 2 datasets", on: true },
  ]);
  const [focused, setFocused] = useStateChat(false);
  const [slashIdx, setSlashIdx] = useStateChat(0);
  const pushToast = useToast();
  const bodyRef = useRefChat(null);
  const showSlash = input.startsWith('/');
  const filteredSlash = showSlash ? SLASH_CMDS.filter(c => c.key.includes(input.slice(1).toLowerCase()) || input === '/') : [];

  const submit = () => {
    if (!input.trim()) return;
    pushToast({ text:'Request sent to drafter', icon:'↑', ttl:2500 });
    setInput('');
  };
  const onKey = (e) => {
    if (showSlash && filteredSlash.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => Math.min(i+1, filteredSlash.length-1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => Math.max(i-1, 0)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const cmd = filteredSlash[slashIdx];
        if (cmd) { setInput('/' + cmd.key + ' '); setTimeout(()=>setSlashIdx(0), 0); }
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  useEffectChat(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, []);

  return (
    <section className="pane">
      <div className="pane-head">
        <div className="pane-title">
          <h2>Chat</h2>
          <span className="count">4 turns</span>
        </div>
        <div className="pane-actions">
          <button className="icon-btn" title="Branch">⎇</button>
          <button className="icon-btn" title="Clear">⌫</button>
          <button className="icon-btn" title="More">⋯</button>
        </div>
      </div>

      <div className="pane-body" ref={bodyRef}>
        <div className="chat-body">
          <div className="msg system">
            <div className="who">⚐</div>
            <div style={{minWidth:0, flex:1}}>
              <div className="msg-body">
                <b>New draft started from PWS template</b> · Walter Reed · EBH services.
                Chat, sources, and the draft stay in sync — citations from sources will show up numbered in the draft on the right.
              </div>
            </div>
          </div>
          {window.CHAT.map(m => <Msg key={m.id} m={m} setActiveCite={setActiveCite} />)}
        </div>
      </div>

      <div className={"composer" + (focused?' focused':'')}>
        <div className="composer-inner">
          {showSlash && filteredSlash.length > 0 && (
            <div className="slash-menu">
              <div className="slash-menu-header">Slash commands</div>
              {filteredSlash.map((c, i) => (
                <div key={c.key} className={"slash-item"+(i===slashIdx?' on':'')} onMouseEnter={()=>setSlashIdx(i)} onClick={()=>{ setInput('/' + c.key + ' '); }}>
                  <span className="ic">{c.ic}</span>
                  <span>{c.label}</span>
                  <span className="slash-key">{c.desc}</span>
                </div>
              ))}
            </div>
          )}
          <textarea
            placeholder="Ask, refine, or push a section — type / for commands, ⏎ to send, ⇧⏎ for newline"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            onFocus={()=>setFocused(true)}
            onBlur={()=>setFocused(false)}
            rows={2}
          />
          <div className="composer-row">
            <div className="composer-chips">
              {chips.map(c => (
                <span key={c.id} className={"chip " + (c.on ? "on" : "")} onClick={() => setChips(cs => cs.map(x => x.id===c.id?{...x,on:!x.on}:x))}>
                  {c.label} <span className="x">×</span>
                </span>
              ))}
              <span className="chip" style={{cursor:'pointer',color:'var(--ink-3)'}}>+ add context</span>
            </div>
            <div className="send-row">
              {input.length > 0 && <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:'var(--ink-3)'}}>{Math.ceil(input.length/4)} tok</span>}
              <span className="model-pick">gpt-4o ▾</span>
              <button className={"send-btn " + (input.trim() ? "" : "disabled")} title="Send (⏎)" onClick={submit}>↑</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

window.ChatPane = ChatPane;
