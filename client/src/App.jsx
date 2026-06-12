import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api.js';
import { applyPrefs } from './prefs.js';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import Composer from './components/Composer.jsx';
import Message from './components/Message.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import DocModal from './components/DocModal.jsx';
import ArtifactsPanel from './components/ArtifactsPanel.jsx';
import { Down, ChevDown, Paper, Compact } from './components/icons.jsx';

const DEFAULT_CFG = { appName: 'open-quill', disclaimer: 'Assistants can make mistakes, double-check responses.', greetings: ['How can I help you?'], appIcon: '', quickPrompts: [], version: '' };

function parseStreamedPaths(text) {
  const set = new Set();
  const re = /```tool\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = m[1];
    const tool = (body.match(/"tool"\s*:\s*"([^"]+)"/) || [])[1];
    const p = (body.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1];
    if (tool === 'create_file' || tool === 'str_replace') { if (p) set.add(p); }
    else if (tool === 'delete_file') { if (p) set.delete(p); }
    else if (tool === 'rename_file') {
      if (p) set.delete(p);
      const np = (body.match(/"(?:new_path|to)"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1];
      if (np) set.add(np);
    }
  }
  return [...set];
}

// peek at the file being written from a not-yet-closed tool block
function parseLiveFile(text) {
  const at = text.lastIndexOf('```tool');
  if (at === -1) return null;
  const after = text.slice(at + 7);
  if (after.includes('```')) return null; // block already closed; the real file will load
  const tool = (after.match(/"tool"\s*:\s*"([^"]+)"/) || [])[1];
  if (tool !== 'create_file' && tool !== 'str_replace') return null;
  const path = (after.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/) || [])[1];
  if (!path) return null;
  const field = tool === 'create_file' ? 'content' : 'new_str';
  const key = '"' + field + '"';
  const ki = after.indexOf(key);
  if (ki === -1) return { path, content: '', tool };
  let rest = after.slice(ki + key.length).replace(/^\s*:\s*"/, '');
  // stop at the closing quote if the value already finished inside the open block
  let outChars = [], esc = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (esc) { outChars.push(ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '' : ch); esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') break;
    outChars.push(ch);
  }
  return { path, content: outChars.join(''), tool };
}

function CompactingBar() {
  const [pct, setPct] = useState(6);
  useEffect(() => {
    const t = setInterval(() => setPct(p => (p < 92 ? p + Math.max(0.6, (92 - p) * 0.05) : p)), 220);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="compacting">
      <span className="compacting-spin" />
      <div className="compacting-body">
        <div className="compacting-text">Compacting our conversation so we can keep chatting…</div>
        <div className="compacting-row">
          <div className="compacting-bar"><div className="compacting-fill" style={{ width: pct + '%' }} /></div>
          <span className="compacting-pct">{Math.round(pct)}%</span>
        </div>
      </div>
    </div>
  );
}

function SummaryModal({ chatId, onClose, onChanged }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let on = true;
    api.get('/api/chats/' + chatId + '/summary').then(r => { if (on) { setText(r.summary || ''); setLoading(false); } }).catch(() => setLoading(false));
    return () => { on = false; };
  }, [chatId]);
  async function save() { await api.patch('/api/chats/' + chatId + '/summary', { summary: text }); onChanged?.(!!text.trim()); setSaved(true); setTimeout(() => setSaved(false), 1400); }
  async function clear() { await api.patch('/api/chats/' + chatId + '/summary', { clear: true }); setText(''); onChanged?.(false); onClose(); }
  return (
    <div className="overlay" onMouseDown={e => e.target.classList.contains('overlay') && onClose()}>
      <div className="summary-modal">
        <div className="sm-head"><h3>Conversation memory</h3><button className="modal-close" style={{ position: 'static' }} onClick={onClose}>✕</button></div>
        <p className="muted-note" style={{ margin: '0 0 10px' }}>Older messages were compacted into this summary, which is fed to the model as context on every turn. You can edit or clear it.</p>
        {loading ? <div className="art-empty">Loading…</div> : (
          <textarea className="summary-text" value={text} onChange={e => setText(e.target.value)} placeholder="No summary yet." />
        )}
        <div className="edit-actions" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={clear}>Clear</button>
          <button className="btn primary" onClick={save}>{saved ? 'Saved' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [models, setModels] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [extended, setExtended] = useState(false);
  const [chats, setChats] = useState([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [greeting, setGreeting] = useState(DEFAULT_CFG.greetings[0]);
  const [sandbox, setSandbox] = useState(false);
  const [files, setFiles] = useState([]);
  const [liveFile, setLiveFile] = useState(null);
  const [pendingPaths, setPendingPaths] = useState([]);
  const [compacting, setCompacting] = useState(false);
  const [hasSummary, setHasSummary] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);

  const [streaming, setStreaming] = useState(false);
  const [queued, setQueued] = useState(false);
  const [dispContent, setDispContent] = useState('');
  const [dispReason, setDispReason] = useState('');
  const [phase, setPhase] = useState('static');

  const ws = useRef(null);
  const targetContent = useRef('');
  const targetReason = useRef('');
  const pendingDone = useRef(false);
  const assistantIdRef = useRef(null);
  const revealTimer = useRef(null);
  const followRaf = useRef(0);
  const dispLen = useRef(0);
  const scrollRef = useRef(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const animate = user?.prefs?.animations !== false;

  const activeIdRef = useRef(null);
  const currentIdRef = useRef(null);
  const animateRef = useRef(animate);
  const refreshSeq = useRef(0);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);
  useEffect(() => { animateRef.current = animate; }, [animate]);

  useEffect(() => { dispLen.current = dispContent.length; }, [dispContent]);

  useEffect(() => {
    api.get('/api/me').then(({ user }) => setUser(user)).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    applyPrefs(user?.prefs);
    const t = user?.prefs?.theme || 'dark';
    if (t === 'system' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const h = () => applyPrefs(user?.prefs);
      mq.addEventListener?.('change', h);
      return () => mq.removeEventListener?.('change', h);
    }
  }, [user]);
  useEffect(() => { if (user) { loadModels(); loadChats(); loadAppConfig(); connect(); openFromUrl(); } }, [!!user]);

  useEffect(() => {
    const onPop = () => openFromUrl();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    const m = models.find(x => x.id === currentId);
    if (m && m.sandboxAllowed === false) { setSandbox(false); return; }
    if (!activeId && messages.length === 0) setSandbox(!!m?.sandboxAuto);
  }, [currentId, activeId]);
  function openFromUrl() {
    const m = location.pathname.match(/^\/chat\/(.+)$/);
    if (m) openChat(decodeURIComponent(m[1]), false);
    else { setActiveId(null); setMessages([]); }
  }

  async function loadModels() {
    const m = await api.get('/api/models');
    setModels(m);
    // keep the user's current pick; on first load (login) fall back to the default model, else the first
    setCurrentId(id => id && m.find(x => x.id === id) ? id : (m.find(x => x.isDefault)?.id || m[0]?.id || null));
  }
  async function loadChats() { try { setChats(await api.get('/api/chats')); } finally { setChatsLoaded(true); } }
  async function loadAppConfig() { try { applyCfg(await api.get('/api/app-config')); } catch {} }
  function applyCfg(c) {
    setCfg(c);
    const list = c.greetings && c.greetings.length ? c.greetings : DEFAULT_CFG.greetings;
    setGreeting(list[Math.floor(Math.random() * list.length)]);
    document.title = c.appName || 'open-quill';
    let link = document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = c.appIcon || '/starburst.svg';
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws`);
    ws.current = sock;
    sock.onmessage = (ev) => handleWs(JSON.parse(ev.data));
    sock.onclose = () => { setTimeout(() => { if (user) connect(); }, 1500); };
  }

  function handleWs(m) {
    if (m.type === 'config') { loadModels(); loadAppConfig(); return; }
    if (m.type === 'files') { setFiles(m.files || []); setLiveFile(null); return; }
    if (m.type === 'tool') { return; }
    if (m.type === 'compacting') { setCompacting(true); return; }
    if (m.type === 'compacted') { setCompacting(false); setHasSummary(true); return; }
    if (m.type === 'title') { setChats(cs => cs.map(c => c.id === m.chatId ? { ...c, title: m.title } : c)); return; }
    if (m.type === 'queued') { setQueued(true); return; }
    if (m.type === 'start') {
      setQueued(false);
      setCompacting(false); setLiveFile(null); setPendingPaths([]); refreshSeq.current++;
      targetContent.current = ''; targetReason.current = ''; pendingDone.current = false;
      assistantIdRef.current = m.messageId; dispLen.current = 0;
      setDispContent(''); setDispReason(''); setPhase('generating'); setStreaming(true);
      startStream();
      return;
    }
    if (m.type === 'reasoning') {
      targetReason.current += m.text;
      setDispReason(targetReason.current);
      if (!targetContent.current) setPhase('thinking');
      return;
    }
    if (m.type === 'content') {
      targetContent.current += m.text;
      setPhase('generating');
      const lf = parseLiveFile(targetContent.current);
      if (lf) setLiveFile(lf);
      setPendingPaths(parseStreamedPaths(targetContent.current));
      if (!animateRef.current) { setDispContent(targetContent.current); dispLen.current = targetContent.current.length; }
      return;
    }
    if (m.type === 'error') {
      if (!streaming && !targetContent.current) { setQueued(false); setMessages(ms => [...ms, { id: 'e' + Date.now(), role: 'assistant', content: `_Error: ${m.error}_` }]); return; }
      targetContent.current += `\n\n_Error: ${m.error}_`;
      if (!animateRef.current) { setDispContent(targetContent.current); dispLen.current = targetContent.current.length; }
      pendingDone.current = true;
      return;
    }
    if (m.type === 'done') { pendingDone.current = true; if (!animateRef.current) finalize(); return; }
  }

  function startStream() {
    clearInterval(revealTimer.current);
    cancelAnimationFrame(followRaf.current);
    follow();
    revealTimer.current = setInterval(() => {
      const target = targetContent.current;
      if (dispLen.current >= target.length) { if (pendingDone.current) finalize(); return; }
      setDispContent(prev => {
        const remaining = target.length - prev.length;
        const n = animateRef.current ? Math.max(4, Math.ceil(remaining / 5)) : remaining;
        const next = target.slice(0, prev.length + n);
        dispLen.current = next.length;
        return next;
      });
    }, 40);
  }

  function follow() {
    const el = scrollRef.current;
    if (el && stick.current) {
      const target = el.scrollHeight - el.clientHeight;
      const diff = target - el.scrollTop;
      if (diff > 0) el.scrollTop = el.scrollTop + Math.max(1, diff * 0.2);
    }
    followRaf.current = requestAnimationFrame(follow);
  }

  function finalize() {
    clearInterval(revealTimer.current);
    cancelAnimationFrame(followRaf.current);
    const content = targetContent.current;
    const reasoning = targetReason.current;
    const id = assistantIdRef.current || ('a' + Date.now());
    setStreaming(false); setPhase('static'); setQueued(false);
    setMessages(ms => [...ms, { id, role: 'assistant', content, reasoning, model_id: currentIdRef.current }]);
    setDispContent(''); setDispReason('');
    setLiveFile(null); setPendingPaths([]);
    setTimeout(() => scrollBottom(false), 0);
    loadChats();
    const aid = activeIdRef.current;
    if (aid) refreshMessages(aid);
  }
  async function refreshMessages(id) {
    const seq = ++refreshSeq.current;
    try {
      const { messages: server } = await api.get('/api/chats/' + id);
      if (seq !== refreshSeq.current) return; // a newer turn/refresh superseded this one
      setMessages(prev => server.map((sm, i) => {
        const pm = prev[i];
        return { ...sm, _k: (pm && pm.role === sm.role) ? (pm._k || pm.id) : sm.id };
      }));
    } catch {}
  }
  async function selectBranch(siblingId) {
    if (streaming || !activeId || !siblingId) return;
    try { await api.post('/api/chats/' + activeId + '/branch', { messageId: siblingId }); await refreshMessages(activeId); setTimeout(() => scrollBottom(false), 20); } catch {}
  }

  function scrollBottom(smooth) {
    const el = scrollRef.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }
  function onScroll() {
    const el = scrollRef.current; if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < 80) stick.current = true;
    setShowJump(dist > 200);
  }
  function onWheel(e) { if (e.deltaY < 0) stick.current = false; }
  function onTouchMove() { const el = scrollRef.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 80) stick.current = false; }
  function jumpDown() { stick.current = true; setShowJump(false); scrollBottom(true); }

  async function openChat(id, push = true) {
    setActiveId(id);
    try {
      const { chat, messages } = await api.get('/api/chats/' + id);
      setMessages(messages);
      setSandbox(!!chat.sandbox);
      setHasSummary(!!chat.hasSummary);
      try { const f = await api.get('/api/chats/' + id + '/files'); setFiles(f.files || []); setArtifactsOpen((f.files || []).length > 0 && artifactsOpen); }
      catch { setFiles([]); }
      if (push) history.pushState({}, '', '/chat/' + id);
      else history.replaceState({}, '', '/chat/' + id);
      stick.current = true; setTimeout(() => scrollBottom(false), 30);
    } catch { setActiveId(null); setMessages([]); history.replaceState({}, '', '/'); }
  }
  function newChat(fromPop) {
    setActiveId(null); setMessages([]); setInput('');
    setFiles([]); setArtifactsOpen(false); setHasSummary(false); setLiveFile(null); setPendingPaths([]);
    const m = models.find(m => m.id === currentId);
    setSandbox(m?.sandboxAllowed !== false && !!m?.sandboxAuto);
    setFocusTick(t => t + 1);
    if (fromPop !== true) history.pushState({}, '', '/');
  }
  async function deleteChat(id) {
    await api.del('/api/chats/' + id);
    setChats(cs => cs.filter(c => c.id !== id));
    if (id === activeId) newChat();
  }
  function toggleStar(id) {
    const cur = chats.find(c => c.id === id);
    const next = !cur?.starred;
    setChats(cs => cs.map(c => c.id === id ? { ...c, starred: next } : c));
    api.patch('/api/chats/' + id, { starred: next }).catch(() => {});
  }

  async function send(attachments = [], overrideText) {
    if (streaming || queued) return;
    const text = (overrideText != null ? overrideText : input).trim();
    if ((!text && attachments.length === 0) || !currentId) return;
    let chatId = activeId;
    if (!chatId) {
      const c = await api.post('/api/chats');
      chatId = c.id; setActiveId(chatId);
      setChats(cs => [{ id: c.id, title: 'New chat', updated_at: c.updated_at, starred: false }, ...cs]);
      history.pushState({}, '', '/chat/' + chatId);
    }
    setMessages(ms => [...ms, { id: 'u' + Date.now(), role: 'user', content: text, attachments, _enter: true }]);
    setInput('');
    stick.current = true; setTimeout(() => scrollBottom(true), 20);
    ws.current?.send(JSON.stringify({ type: 'chat', chatId, modelId: currentId, extended, content: text, attachments, sandbox }));
  }

  const regenerate = useCallback((messageId) => {
    if (streaming || !activeId || !currentId) return;
    setMessages(ms => { const idx = ms.findIndex(m => m.id === messageId); return idx === -1 ? ms : ms.slice(0, idx); });
    stick.current = true; setTimeout(() => scrollBottom(true), 20);
    ws.current?.send(JSON.stringify({ type: 'regenerate', chatId: activeId, modelId: currentId, extended, messageId, sandbox }));
  }, [streaming, activeId, currentId, extended, sandbox]);

  const editMessage = useCallback((messageId, newContent) => {
    if (streaming || !activeId || !currentId) return;
    setMessages(ms => { const idx = ms.findIndex(m => m.id === messageId); if (idx === -1) return ms; const copy = ms.slice(0, idx + 1); copy[idx] = { ...copy[idx], content: newContent }; return copy; });
    stick.current = true; setTimeout(() => scrollBottom(true), 20);
    ws.current?.send(JSON.stringify({ type: 'edit', chatId: activeId, modelId: currentId, extended, messageId, content: newContent, sandbox }));
  }, [streaming, activeId, currentId, extended, sandbox]);

  function stop() { ws.current?.send(JSON.stringify({ type: 'stop' })); pendingDone.current = true; setQueued(false); }
  async function logout() { await api.post('/api/auth/logout'); location.href = '/'; }

  if (user === undefined) return <div style={{ height: '100%', background: 'var(--bg)' }} />;
  if (!user) return <Login onLogin={(u) => setUser(u)} />;

  const model = models.find(m => m.id === currentId);
  const sandboxAllowed = model ? model.sandboxAllowed !== false : true;
  const empty = !activeId && messages.length === 0;
  const composerProps = {
    value: input, onChange: setInput, onSend: send, onStop: stop, streaming: streaming || queued,
    models, currentId, onSelect: setCurrentId, extended, onToggleExtended: () => setExtended(e => !e),
    visionSupported: !!model?.hasVision,
    sandbox, sandboxAllowed, onToggleSandbox: () => { if (sandboxAllowed) setSandbox(s => !s); },
    onWantSandbox: () => { if (sandboxAllowed) setSandbox(true); }
  };
  const showArtifactsBtn = sandbox || files.length > 0;

  return (
    <div className="app">
      <Sidebar user={user} chats={chats} chatsLoaded={chatsLoaded} activeId={activeId} appName={cfg.appName}
        onNew={newChat} onOpen={openChat} onDelete={deleteChat} onToggleStar={toggleStar}
        collapsed={collapsed} onToggle={() => setCollapsed(c => !c)}
        onSettings={() => setShowSettings(true)} onAdmin={() => setShowAdmin(true)}
        onCredits={() => setShowCredits(true)} onChangelog={() => setShowChangelog(true)} onLogout={logout} version={cfg.version} />

      <div className="main">
        {empty ? (
          <div className="center-wrap">
            <div className="greeting"><img src={model?.staticIcon || cfg.appIcon || '/starburst.svg'} alt="" /> {greeting}</div>
            <div className="composer-wrap">
              <Composer {...composerProps} autoFocus modelUp focusKey={focusTick} />
            </div>
            {cfg.quickPrompts && cfg.quickPrompts.length > 0 && (
              <div className="quick-prompts">
                {cfg.quickPrompts.map((q, i) => (
                  <button key={i} className="quick-prompt" onClick={() => send([], q.prompt)} disabled={streaming}>
                    {q.icon && <span className="qp-icon">{q.icon}</span>}{q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="topbar">
              <div className="chat-name">{chats.find(c => c.id === activeId)?.title || 'New chat'} <ChevDown style={{ width: 15 }} /></div>
              <div className="topbar-actions">
                {hasSummary && (
                  <button className="paper-btn" onClick={() => setSummaryOpen(true)} title="Conversation memory">
                    <Compact style={{ width: 18 }} />
                  </button>
                )}
                {showArtifactsBtn && (
                  <button className={'paper-btn' + (artifactsOpen ? ' active' : '') + (liveFile ? ' writing' : '')} onClick={() => setArtifactsOpen(o => !o)} title="Artifacts">
                    <Paper style={{ width: 18 }} />{files.length > 0 && <span className="paper-count">{files.length}</span>}
                  </button>
                )}
                {/* Share button — disabled for now, kept for later use
                <button className="share-btn">Share</button>
                */}
              </div>
            </div>
            <div className="scroll-area" ref={scrollRef} onScroll={onScroll} onWheel={onWheel} onTouchMove={onTouchMove}>
              <div className="thread">
                {(() => { const lastA = !streaming ? [...messages].reverse().find(m => m.role === 'assistant') : null; return messages.map(msg => (
                  <Message key={msg._k || msg.id} msg={msg} model={models.find(x => x.id === msg.model_id) || model} onRegenerate={regenerate} onEdit={editMessage} onSelectBranch={selectBranch} showIcon={msg.role === 'assistant' && lastA && msg.id === lastA.id} />
                )); })()}
                {streaming && (
                  <Message msg={{ role: 'assistant', content: dispContent, reasoning: dispReason }}
                    model={model} streaming phase={phase} />
                )}
                {queued && !streaming && (
                  <div className="msg assistant"><div className="queue-wait"><img src="/starburst.svg" className="pulse think-dot" alt="" /> Waiting for queue…</div></div>
                )}
                {compacting && <CompactingBar />}
                <div className="thread-pad" />
              </div>
            </div>
            {showJump && <button className="to-bottom" onClick={jumpDown}><Down style={{ width: 17 }} /></button>}
            <div className="composer-wrap active-composer" style={{ maxWidth: 760, margin: '0 auto', width: '100%', padding: '0 20px' }}>
              <Composer {...composerProps} focusKey={focusTick} />
              <div className="disclaimer">{cfg.disclaimer}</div>
            </div>
          </>
        )}
      </div>

      {artifactsOpen && activeId && (
        <ArtifactsPanel chatId={activeId} files={files} live={liveFile} pending={pendingPaths} onClose={() => setArtifactsOpen(false)} />
      )}

      {summaryOpen && activeId && (
        <SummaryModal chatId={activeId} onClose={() => setSummaryOpen(false)}
          onChanged={(has) => { setHasSummary(has); }} />
      )}

      {showSettings && <SettingsModal user={user} onClose={() => setShowSettings(false)} onUpdated={setUser} onDeleted={() => { location.href = '/'; }} />}
      {showAdmin && <AdminPanel user={user} onClose={() => setShowAdmin(false)} />}
      {showCredits && <DocModal title="Credits" name="credits" serif onClose={() => setShowCredits(false)} />}
      {showChangelog && <DocModal title="Changelog" name="changelog" onClose={() => setShowChangelog(false)} />}
    </div>
  );
}
