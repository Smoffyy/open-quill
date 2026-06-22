import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api.js';
import { applyPrefs } from './prefs.js';
import { QpIcon } from './qpIcons.jsx';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import AppBackground from './components/AppBackground.jsx';
import Composer from './components/Composer.jsx';

function computeActiveBg(models, currentId, activeId, messagesLen, incognito, prefs) {
  const m = models.find(x => x.id === currentId);
  const isEmpty = !activeId && messagesLen === 0;
  const inChat = prefs?.modelBgInChat !== false;
  const has = !incognito && !!(m?.bgEnabled && m?.bgImage);
  return has && (isEmpty || inChat) ? m.bgImage : null;
}
import Message from './components/Message.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import DocModal from './components/DocModal.jsx';
import ArtifactsPanel from './components/ArtifactsPanel.jsx';
import ChatsOverview from './components/ChatsOverview.jsx';
import SpacesPanel from './components/SpacesPanel.jsx';
import ProjectsPanel from './components/ProjectsPanel.jsx';
import { Down, ChevDown, Paper, Compact, Ghost } from './components/icons.jsx';
import { scanTools } from './toolproto.js';

const DEFAULT_CFG = { appName: 'open-quill', disclaimer: 'Assistants can make mistakes, double-check responses.', greetings: ['How can I help you?'], appIcon: '', quickPrompts: [], version: '' };

function QuickPrompts({ prompts, visible, disabled, onPick }) {
  const [render, setRender] = useState(visible);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (visible) { setRender(true); setLeaving(false); return; }
    if (!render) return;
    setLeaving(true);
    const off = document.documentElement.getAttribute('data-entrance') === 'off';
    const dur = off ? 0 : 260 + prompts.length * 45 + 60;
    const t = setTimeout(() => setRender(false), dur);
    return () => clearTimeout(t);
  }, [visible]);
  if (!render) return null;
  return (
    <div className={'quick-prompts' + (leaving ? ' leaving' : '')}>
      {prompts.map((q, i) => (
        <button key={i} className="quick-prompt" style={{ animationDelay: i * 45 + 'ms' }} onClick={() => onPick(q.prompt)} disabled={disabled}>
          {q.icon && q.icon !== 'none' && <span className="qp-icon"><QpIcon name={q.icon} style={{ width: 15, height: 15 }} /></span>}{q.label}
        </button>
      ))}
    </div>
  );
}

function filesFromCalls(calls) {
  const files = {};
  for (const { call } of calls) {
    const tool = call.tool, p = call.path;
    if (tool === 'create_file') { if (p) files[p] = typeof call.content === 'string' ? call.content : null; }
    else if (tool === 'str_replace') { if (p && !(p in files)) files[p] = null; }
    else if (tool === 'delete_file') { if (p) delete files[p]; }
    else if (tool === 'rename_file' || tool === 'move_file') {
      const np = call.new_path;
      if (p) { if (np) files[np] = files[p] ?? null; delete files[p]; }
    }
    else if (tool === 'copy_file') {
      const np = call.new_path;
      if (np) files[np] = files[p] ?? null;
    }
  }
  return files;
}
function parseStreamedFiles(text) { return filesFromCalls(scanTools(text).calls); }

function parseLiveFile(text) {
  const re = /(^|\n)([<\[(|]\s*[|]?\s*tool\b)/gi;
  let lastOpen = -1, m;
  while ((m = re.exec(text))) lastOpen = m.index + (m[1] ? m[1].length : 0);
  if (lastOpen === -1) return null;
  const seg = text.slice(lastOpen);
  if (seg.indexOf('[[OQR:') !== -1) return null;
  const { live } = scanTools(seg);
  if (!live || !live.path) return null;
  if (live.tool !== 'create_file' && live.tool !== 'str_replace') return null;
  return { path: live.path, content: live.content || '', tool: live.tool, oldStr: live.oldStr ?? null };
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

function CommandPalette({ commands, onClose }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const filtered = commands.filter(c => {
    const s = (c.label + ' ' + (c.keywords || '')).toLowerCase();
    return q.trim().toLowerCase().split(/\s+/).every(t => s.includes(t));
  });
  useEffect(() => { setIdx(0); }, [q]);
  function run(c) { onClose(); c.action(); }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = filtered[idx]; if (c) run(c); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
  useEffect(() => {
    const el = listRef.current?.children[idx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [idx]);
  return (
    <div className="overlay cmdk-overlay" onMouseDown={(e) => e.target.classList.contains('cmdk-overlay') && onClose()}>
      <div className="cmdk">
        <input ref={inputRef} className="cmdk-input" placeholder="Type a command…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 && <div className="cmdk-empty">No matching commands</div>}
          {filtered.map((c, i) => (
            <button key={c.id} className={'cmdk-item' + (i === idx ? ' active' : '')} onMouseMove={() => setIdx(i)} onClick={() => run(c)}>
              <span className="cmdk-label">{c.label}</span>
              {c.shortcut && <span className="cmdk-shortcut">{c.shortcut}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [intro, setIntro] = useState(false);
  const [models, setModels] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [extended, setExtended] = useState(false);
  const [bgVisible, setBgVisible] = useState(false);
  const [chats, setChats] = useState([]);
  const [folders, setFolders] = useState([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showLicense, setShowLicense] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [budget, setBudget] = useState(null);
  const [greeting, setGreeting] = useState(DEFAULT_CFG.greetings[0]);
  const [sandbox, setSandbox] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [files, setFiles] = useState([]);
  const [liveFile, setLiveFile] = useState(null);
  const [pendingFiles, setPendingFiles] = useState({});
  const [compacting, setCompacting] = useState(false);
  const [hasSummary, setHasSummary] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [artifactFocus, setArtifactFocus] = useState(null);
  const [incognito, setIncognito] = useState(false);
  const [incognitoGreeting, setIncognitoGreeting] = useState('Greetings, whoever you are');
  const [chatsOverview, setChatsOverview] = useState(false);
  const [showSpaces, setShowSpaces] = useState(false);
  const [spacesPending, setSpacesPending] = useState(0);
  const [projects, setProjects] = useState([]);
  const [showProjects, setShowProjects] = useState(false);
  const [projectOpenId, setProjectOpenId] = useState(null);
  const [currentProject, setCurrentProject] = useState(null);
  const [cmdkOpen, setCmdkOpen] = useState(false);

  const [streaming, setStreaming] = useState(false);
  const [queued, setQueued] = useState(false);
  const [dispContent, setDispContent] = useState('');
  const [dispReason, setDispReason] = useState('');
  const [phase, setPhase] = useState('static');

  const ws = useRef(null);
  const gen = useRef(new Map());
  const targetContent = useRef('');
  const targetReason = useRef('');
  const pendingDone = useRef(false);
  const doneBlocksRef = useRef(0);
  const liveRef = useRef(null);
  const assistantIdRef = useRef(null);
  const revealTimer = useRef(null);
  const followRaf = useRef(0);
  const dispLen = useRef(0);
  const scrollRef = useRef(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  const programmatic = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const animate = user?.prefs?.animations !== false;
  const revealMs = (() => { const v = user?.prefs?.revealMs; return v == null || isNaN(parseInt(v)) ? 40 : Math.max(0, Math.min(100, parseInt(v))); })();
  const [threadStagger, setThreadStagger] = useState(false);
  const staggerTimer = useRef(null);

  const activeIdRef = useRef(null);
  const currentIdRef = useRef(null);
  const animateRef = useRef(animate);
  const incognitoRef = useRef(false);
  useEffect(() => { incognitoRef.current = incognito; }, [incognito]);
  const refreshSeq = useRef(0);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { liveRef.current = liveFile; }, [liveFile]);
  useEffect(() => {
    const active = computeActiveBg(models, currentId, activeId, messages.length, incognito, user?.prefs);
    if (active) { setBgVisible(true); return; }
    const t = setTimeout(() => setBgVisible(false), 650);
    return () => clearTimeout(t);
  }, [models, currentId, activeId, messages.length, incognito, user]);
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);
  useEffect(() => { animateRef.current = animate; }, [animate]);
  const revealRef = useRef(revealMs);
  useEffect(() => { revealRef.current = revealMs; }, [revealMs]);

  useEffect(() => { dispLen.current = dispContent.length; }, [dispContent]);

  useEffect(() => {
    if (!intro) return;
    const t = setTimeout(() => setIntro(false), 3400);
    return () => clearTimeout(t);
  }, [intro]);

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
  useEffect(() => { if (user) { loadModels(); loadChats(); loadFolders(); loadAppConfig(); loadBudget(); connect(); openFromUrl(); refreshSpacesPending(); loadProjects(); } }, [!!user]);
  async function loadBudget() { try { setBudget(await api.get('/api/me/budget')); } catch {} }
  async function loadProjects() { try { setProjects(await api.get('/api/projects')); } catch {} }

  useEffect(() => {
    const root = document.documentElement;
    if (intro) root.setAttribute('data-entrance', 'off');
    else root.setAttribute('data-entrance', user?.prefs?.messageEntrance === false ? 'off' : 'on');
  }, [intro, user]);

  useEffect(() => {
    const onPop = () => openFromUrl();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => { syncView(); }, [activeId, incognito]);
  useEffect(() => {
    const h = (e) => {
      const p = e.detail?.path;
      if (!p || !activeIdRef.current) return;
      setArtifactsOpen(true);
      setArtifactFocus(f => ({ path: p, n: (f?.n || 0) + 1 }));
    };
    window.addEventListener('oq-open-file', h);
    return () => window.removeEventListener('oq-open-file', h);
  }, []);
  useEffect(() => {
    if (!user) return;
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); setCollapsed(c => !c); return; }
      if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setCmdkOpen(o => !o); return; }
      if (mod && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); newChat(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user]);
  useEffect(() => {
    const m = models.find(x => x.id === currentId);
    if (m && m.sandboxAllowed === false) setSandbox(false);
  }, [currentId, activeId]);
  function openFromUrl() {
    if (/^\/admin(\/|$)/.test(location.pathname)) { if (user?.isAdmin) { setShowAdmin(true); return; } history.replaceState({}, '', '/'); }
    else setShowAdmin(false);
    if (/^\/spaces(\/|$)/.test(location.pathname)) { setShowSpaces(true); return; }
    else setShowSpaces(false);
    const pm = location.pathname.match(/^\/project\/(.+)$/);
    if (pm) { setProjectOpenId(decodeURIComponent(pm[1])); setShowProjects(true); return; }
    if (/^\/projects(\/|$)/.test(location.pathname)) { setProjectOpenId(null); setShowProjects(true); return; }
    setShowProjects(false);
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
  async function loadChats() { try { setChats(await api.get('/api/chats')); } catch {} finally { setChatsLoaded(true); } }
  async function loadFolders() { try { setFolders(await api.get('/api/folders')); } catch {} }
  async function loadAppConfig() { try { applyCfg(await api.get('/api/app-config')); } catch {} }
  async function refreshSpacesPending() { try { const l = await api.get('/api/spaces'); setSpacesPending(l.filter(s => s.myStatus === 'invited').length); } catch {} }
  async function exportAllChats() { window.open('/api/chats/export-all', '_blank'); }
  async function importChatsFile(file) {
    try {
      const json = JSON.parse(await file.text());
      const r = await api.post('/api/chats/import', json);
      await loadChats(); await loadFolders();
      alert(`Imported ${r.imported} chat(s).`);
    } catch (e) { alert(e.message || 'Could not import that file.'); }
  }
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
    const existing = ws.current;
    if (existing && (existing.readyState === 0 || existing.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws`);
    ws.current = sock;
    sock.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } handleWs(m); };
    sock.onerror = () => { try { sock.close(); } catch {} };
    sock.onclose = () => { if (ws.current === sock) ws.current = null; setTimeout(() => { if (user) connect(); }, 1500); };
  }

  function wsSend(obj) {
    const sock = ws.current;
    if (!sock || sock.readyState !== 1) {
      if (!sock || sock.readyState >= 2) connect();
      setMessages(ms => [...ms, { id: 'e' + Date.now(), role: 'assistant', content: '_Connection lost — reconnecting. Try again in a moment._' }]);
      return false;
    }
    try { sock.send(JSON.stringify(obj)); return true; }
    catch { return false; }
  }

  function activeKey() { return incognitoRef.current ? 'incognito' : activeIdRef.current; }
  function recFor(key) {
    let r = gen.current.get(key);
    if (!r) { r = { content: '', reasoning: '', phase: 'generating', done: false, assistantId: null, model_id: currentIdRef.current, blocks: 0 }; gen.current.set(key, r); }
    return r;
  }

  function handleWs(m) {
    if (m.type === 'session_revoked') { location.href = '/'; return; }
    if (m.type === 'config') { loadModels(); loadAppConfig(); try { window.dispatchEvent(new CustomEvent('oq-config')); } catch {} return; }
    if (typeof m.type === 'string' && m.type.startsWith('space_')) {
      try { window.dispatchEvent(new CustomEvent('oq-space', { detail: m })); } catch {}
      if (m.type === 'space_invite' || m.type === 'space_updated' || m.type === 'space_removed' || m.type === 'space_deleted') refreshSpacesPending();
      return;
    }
    if (m.type === 'files') {
      if (m.chatId && m.chatId !== activeIdRef.current) return;
      setFiles(m.files || []);
      const r = gen.current.get(m.chatId);
      setLiveFile(r && !r.done ? parseLiveFile(r.content) : null);
      return;
    }
    if (m.type === 'tool') { return; }
    if (m.type === 'compacting') { if (m.chatId === activeKey()) setCompacting(true); return; }
    if (m.type === 'compacted') { if (m.chatId === activeKey()) { setCompacting(false); setHasSummary(true); } return; }
    if (m.type === 'title') { setChats(cs => cs.map(c => c.id === m.chatId ? { ...c, title: m.title } : c)); return; }
    if (m.type === 'queued') {
      const r = recFor(m.chatId); r.phase = 'queued';
      if (m.chatId === activeKey()) setQueued(true);
      return;
    }
    if (m.type === 'start') {
      const r = recFor(m.chatId);
      r.content = ''; r.reasoning = ''; r.phase = 'generating'; r.done = false; r.error = false; r.assistantId = m.messageId; r.blocks = 0;
      if (m.chatId === activeKey()) {
        refreshSeq.current++;
        setCompacting(false); setLiveFile(null); setPendingFiles({}); doneBlocksRef.current = 0;
        targetContent.current = ''; targetReason.current = ''; pendingDone.current = false;
        assistantIdRef.current = m.messageId; dispLen.current = 0;
        setDispContent(''); setDispReason(''); setPhase('generating'); setStreaming(true); setQueued(false);
        startStream();
      }
      return;
    }
    if (m.type === 'reasoning') {
      const r = recFor(m.chatId); r.reasoning += m.text;
      if (!r.content) r.phase = 'thinking';
      if (m.chatId === activeKey()) {
        targetReason.current = r.reasoning;
        setDispReason(r.reasoning);
        if (!targetContent.current) setPhase('thinking');
      }
      return;
    }
    if (m.type === 'content') {
      const r = recFor(m.chatId); r.content += m.text; r.phase = 'generating';
      if (m.chatId === activeKey()) {
        targetContent.current = r.content;
        setPhase('generating');
        if (/[|<]/.test(m.text) || liveRef.current) {
          const lf = parseLiveFile(r.content);
          liveRef.current = lf;
          setLiveFile(lf);
        }
        if (/[|<]/.test(m.text)) {
          const { calls } = scanTools(r.content);
          if (calls.length !== doneBlocksRef.current) { doneBlocksRef.current = calls.length; setPendingFiles(filesFromCalls(calls)); }
        }
        if (m.text.indexOf('[[OQR:') !== -1) { dispLen.current = r.content.length; setDispContent(r.content); }
        else if (!animateRef.current) { setDispContent(r.content); dispLen.current = r.content.length; }
      }
      return;
    }
    if (m.type === 'error') {
      const r = gen.current.get(m.chatId);
      if (!r || !r.content) {
        gen.current.delete(m.chatId);
        if (m.chatId === activeKey()) {
          setQueued(false); setStreaming(false); setPhase('static');
          setMessages(ms => [...ms, { id: 'e' + Date.now(), role: 'assistant', content: `_Error: ${m.error}_` }]);
        }
        return;
      }
      r.content += `\n\n_Error: ${m.error}_`;
      if (m.chatId === activeKey()) {
        targetContent.current = r.content;
        if (!animateRef.current) { setDispContent(r.content); dispLen.current = r.content.length; }
        pendingDone.current = true;
      }
      return;
    }
    if (m.type === 'done') {
      const r = recFor(m.chatId); r.done = true;
      if (m.chatId === activeKey()) { pendingDone.current = true; if (!animateRef.current) finalize(); }
      else finalizeBackground(m.chatId);
      loadBudget();
      return;
    }
  }

  function startStream() {
    clearInterval(revealTimer.current);
    cancelAnimationFrame(followRaf.current);
    follow();
    const period = Math.max(8, Math.min(100, revealRef.current || 0)) ;
    revealTimer.current = setInterval(() => {
      const target = targetContent.current;
      if (dispLen.current >= target.length) { if (pendingDone.current) finalize(); return; }
      setDispContent(prev => {
        const remaining = target.length - prev.length;
        const instant = !animateRef.current || revealRef.current <= 0;
        const n = instant ? remaining
          : remaining > 1200 ? Math.ceil(remaining / 3)
          : remaining > 240 ? Math.ceil(remaining / 6)
          : Math.max(2, Math.ceil(remaining / 9));
        const next = target.slice(0, prev.length + n);
        dispLen.current = next.length;
        return next;
      });
    }, period);
  }

  function follow() {
    const el = scrollRef.current;
    if (el && stick.current) {
      const target = el.scrollHeight - el.clientHeight;
      const diff = target - el.scrollTop;
      if (diff > 0.5) { programmatic.current = true; el.scrollTop = el.scrollTop + Math.max(1, diff * 0.2); }
    }
    followRaf.current = requestAnimationFrame(follow);
  }

  function finalize() {
    const key = activeKey();
    const r = gen.current.get(key);
    if (!r && !streaming) return;
    clearInterval(revealTimer.current);
    cancelAnimationFrame(followRaf.current);
    const content = r ? r.content : targetContent.current;
    const reasoning = r ? r.reasoning : targetReason.current;
    const id = (r && r.assistantId) || assistantIdRef.current || ('a' + Date.now());
    const mid = r ? r.model_id : currentIdRef.current;
    gen.current.delete(key);
    setStreaming(false); setPhase('static'); setQueued(false);
    setMessages(ms => [...ms, { id, role: 'assistant', content, reasoning, model_id: mid }]);
    setDispContent(''); setDispReason('');
    setLiveFile(null); setPendingFiles({}); doneBlocksRef.current = 0;
    targetContent.current = ''; targetReason.current = ''; pendingDone.current = false; dispLen.current = 0;
    if (stick.current) setTimeout(() => scrollBottom(false), 0);
    if (key === 'incognito') return;
    loadChats();
    if (key) refreshMessages(key);
  }

  function finalizeBackground(key) {
    gen.current.delete(key);
    if (key !== 'incognito') loadChats();
  }

  function syncView() {
    clearInterval(revealTimer.current);
    cancelAnimationFrame(followRaf.current);
    const key = activeKey();
    const r = gen.current.get(key);
    if (r && !r.done) {
      refreshSeq.current++;
      targetContent.current = r.content; targetReason.current = r.reasoning;
      assistantIdRef.current = r.assistantId; pendingDone.current = false;
      doneBlocksRef.current = r.blocks || 0; dispLen.current = r.content.length;
      setDispContent(r.content); setDispReason(r.reasoning);
      setLiveFile(null); setPendingFiles(parseStreamedFiles(r.content));
      setPhase(r.phase === 'thinking' ? 'thinking' : 'generating');
      setStreaming(true); setQueued(r.phase === 'queued');
      startStream();
    } else {
      if (r && r.done) gen.current.delete(key);
      targetContent.current = ''; targetReason.current = ''; pendingDone.current = false; dispLen.current = 0;
      setStreaming(false); setQueued(false); setPhase('static');
      setDispContent(''); setDispReason('');
    }
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
    programmatic.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }
  function onScroll() {
    const el = scrollRef.current; if (!el) return;
    const top = el.scrollTop;
    const dist = el.scrollHeight - top - el.clientHeight;
    setShowJump(dist > 200);
    if (programmatic.current) { programmatic.current = false; lastTop.current = top; return; }
    if (top < lastTop.current - 1) stick.current = false;
    else if (dist < 24) stick.current = true;
    lastTop.current = top;
  }
  function onWheel(e) { if (e.deltaY < -1) stick.current = false; }
  function onTouchMove() { const el = scrollRef.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 24) stick.current = false; }
  function jumpDown() { stick.current = true; setShowJump(false); scrollBottom(true); }

  async function openChat(id, push = true) {
    if (incognito) setIncognito(false);
    setShowProjects(false);
    if (id !== activeIdRef.current) { setLiveFile(null); setPendingFiles({}); setArtifactFocus(null); doneBlocksRef.current = 0; }
    setActiveId(id);
    try {
      const { chat, messages } = await api.get('/api/chats/' + id);
      setMessages(messages);
      setCurrentProject(chat.projectId ? (projects.find(p => p.id === chat.projectId) || { id: chat.projectId, name: 'Project' }) : null);
      if (user?.prefs?.chatStagger !== false && user?.prefs?.messageEntrance !== false) {
        clearTimeout(staggerTimer.current);
        setThreadStagger(true);
        staggerTimer.current = setTimeout(() => setThreadStagger(false), 700);
      }
      setSandbox(!!chat.sandbox);
      setWebSearch(false);
      setHasSummary(!!chat.hasSummary);
      try { const f = await api.get('/api/chats/' + id + '/files'); setFiles(f.files || []); setArtifactsOpen((f.files || []).length > 0 && artifactsOpen); }
      catch { setFiles([]); }
      if (push) history.pushState({}, '', '/chat/' + id);
      else history.replaceState({}, '', '/chat/' + id);
      stick.current = true; setTimeout(() => scrollBottom(false), 30);
    } catch { setActiveId(null); setMessages([]); history.replaceState({}, '', '/'); }
  }
  function newChat(fromPop) {
    if (incognito) setIncognito(false);
    setShowProjects(false);
    setCurrentProject(null);
    setActiveId(null); setMessages([]); setInput('');
    setFiles([]); setArtifactsOpen(false); setHasSummary(false); setLiveFile(null); setPendingFiles({}); setArtifactFocus(null);
    const m = models.find(m => m.id === currentId);
    setSandbox(m?.sandboxAllowed !== false && !!m?.sandboxAuto);
    setWebSearch(false);
    setFocusTick(t => t + 1);
    if (fromPop !== true) history.pushState({}, '', '/');
  }
  function toggleIncognito() {
    if (streaming || queued) return;
    if (incognito) {
      setIncognito(false);
      setMessages([]); setInput('');
      setFocusTick(t => t + 1);
    } else {
      setActiveId(null); setMessages([]); setInput('');
      setFiles([]); setArtifactsOpen(false); setHasSummary(false); setLiveFile(null); setPendingFiles({}); setArtifactFocus(null);
      setSandbox(false);
      const gs = ['Greetings, whoever you are', 'No names, no traces', 'This one stays between us', 'Off the record'];
      setIncognitoGreeting(gs[Math.floor(Math.random() * gs.length)]);
      setIncognito(true);
      setFocusTick(t => t + 1);
      if (location.pathname !== '/') history.pushState({}, '', '/');
    }
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

  async function createFolder(name = 'New folder') {
    try {
      const f = await api.post('/api/folders', { name });
      setFolders(fs => [...fs, { id: f.id, name: f.name, collapsed: false, sortOrder: f.sortOrder }]);
      return f.id;
    } catch { return null; }
  }
  function renameFolder(id, name) {
    const prev = folders.find(f => f.id === id)?.name;
    setFolders(fs => fs.map(f => f.id === id ? { ...f, name } : f));
    api.patch('/api/folders/' + id, { name }).catch(() => {
      setFolders(fs => fs.map(f => f.id === id ? { ...f, name: prev } : f));
    });
  }
  function toggleFolder(id) {
    const cur = folders.find(f => f.id === id);
    const next = !cur?.collapsed;
    setFolders(fs => fs.map(f => f.id === id ? { ...f, collapsed: next } : f));
    api.patch('/api/folders/' + id, { collapsed: next }).catch(() => {
      setFolders(fs => fs.map(f => f.id === id ? { ...f, collapsed: !next } : f));
    });
  }
  async function deleteFolder(id) {
    const prevFolders = folders;
    const prevChats = chats;
    setFolders(fs => fs.filter(f => f.id !== id));
    setChats(cs => cs.map(c => c.folderId === id ? { ...c, folderId: null } : c));
    try { await api.del('/api/folders/' + id); }
    catch { setFolders(prevFolders); setChats(prevChats); }
  }
  function moveChatToFolder(chatId, folderId) {
    const prev = chats.find(c => c.id === chatId)?.folderId ?? null;
    const target = folderId || null;
    if (prev === target) return;
    setChats(cs => cs.map(c => c.id === chatId ? { ...c, folderId: target } : c));
    api.patch('/api/chats/' + chatId, { folderId: target || '' }).catch(() => {
      setChats(cs => cs.map(c => c.id === chatId ? { ...c, folderId: prev } : c));
    });
  }

  async function send(attachments = [], overrideText) {
    if (streaming || queued) return;
    const text = (overrideText != null ? overrideText : input).trim();
    if ((!text && attachments.length === 0) || !currentId) return;

    if (incognito) {
      const history = [...messages
        .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: text }];
      if (!wsSend({ type: 'incognito', modelId: currentId, extended, messages: history })) return;
      gen.current.set('incognito', { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: currentId, blocks: 0 });
      setMessages(ms => [...ms, { id: 'u' + Date.now(), role: 'user', content: text, attachments: [], _enter: true }]);
      setInput('');
      stick.current = true; setTimeout(() => scrollBottom(true), 20);
      return;
    }

    let chatId = activeId;
    if (!chatId) {
      const c = await api.post('/api/chats');
      chatId = c.id; setActiveId(chatId);
      setChats(cs => [{ id: c.id, title: 'New chat', updated_at: c.updated_at, starred: false, folderId: null }, ...cs]);
      history.pushState({}, '', '/chat/' + chatId);
    }
    if (!wsSend({ type: 'chat', chatId, modelId: currentId, extended, content: text, attachments, sandbox, webSearch })) return;
    gen.current.set(chatId, { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: currentId, blocks: 0 });
    setMessages(ms => [...ms, { id: 'u' + Date.now(), role: 'user', content: text, attachments, _enter: true }]);
    setInput('');
    stick.current = true; setTimeout(() => scrollBottom(true), 20);
  }

  async function startProjectChat(project, rawText, attachments = []) {
    if (!currentId) return;
    const text = (rawText || '').trim();
    if (!text && attachments.length === 0) return;
    const c = await api.post('/api/chats', { projectId: project.id });
    setChats(cs => [{ id: c.id, title: 'New chat', updated_at: c.updated_at, starred: false, folderId: null, projectId: project.id }, ...cs]);
    setShowProjects(false); setProjectOpenId(null);
    setCurrentProject(project);
    setActiveId(c.id); setMessages([]); setInput('');
    setFiles([]); setArtifactsOpen(false); setHasSummary(false); setLiveFile(null); setPendingFiles({}); setArtifactFocus(null);
    history.pushState({}, '', '/chat/' + c.id);
    if (!wsSend({ type: 'chat', chatId: c.id, modelId: currentId, extended, content: text, attachments, sandbox, webSearch })) return;
    gen.current.set(c.id, { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: currentId, blocks: 0 });
    setMessages([{ id: 'u' + Date.now(), role: 'user', content: text, attachments, _enter: true }]);
    stick.current = true; setTimeout(() => scrollBottom(true), 20);
  }
  function openProjectChat(chatId, project) {
    setShowProjects(false); setProjectOpenId(null);
    if (project) setCurrentProject(project);
    openChat(chatId);
  }
  function clearChatProject() {
    if (!activeId || !currentProject) { setCurrentProject(null); return; }
    const pid = currentProject.id;
    setCurrentProject(null);
    setChats(cs => cs.map(c => c.id === activeId ? { ...c, projectId: null } : c));
    api.patch('/api/chats/' + activeId, { projectId: '' }).catch(() => {});
    setProjects(ps => ps.map(p => p.id === pid ? { ...p, chatCount: Math.max(0, (p.chatCount || 1) - 1) } : p));
  }
  function openProjects(id = null) {
    setProjectOpenId(id);
    setShowProjects(true);
    history.pushState({}, '', id ? '/project/' + id : '/projects');
  }

  const regenerate = useCallback((messageId) => {
    if (streaming || !activeId || !currentId) return;
    if (!wsSend({ type: 'regenerate', chatId: activeId, modelId: currentId, extended, messageId, sandbox, webSearch })) return;
    gen.current.set(activeId, { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: currentId, blocks: 0 });
    setMessages(ms => { const idx = ms.findIndex(m => m.id === messageId); return idx === -1 ? ms : ms.slice(0, idx); });
    stick.current = true; setTimeout(() => scrollBottom(true), 20);
  }, [streaming, activeId, currentId, extended, sandbox, webSearch]);

  const editMessage = useCallback((messageId, newContent) => {
    if (streaming || !activeId || !currentId) return;
    setMessages(ms => { const idx = ms.findIndex(m => m.id === messageId); if (idx === -1) return ms; const copy = ms.slice(0, idx + 1); copy[idx] = { ...copy[idx], content: newContent }; return copy; });
    stick.current = true; setTimeout(() => scrollBottom(true), 20);
    if (!wsSend({ type: 'edit', chatId: activeId, modelId: currentId, extended, messageId, content: newContent, sandbox, webSearch })) return;
    gen.current.set(activeId, { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: currentId, blocks: 0 });
  }, [streaming, activeId, currentId, extended, sandbox, webSearch]);

  function stop() { const key = activeKey(); try { ws.current?.readyState === 1 && ws.current.send(JSON.stringify({ type: 'stop', chatId: key })); } catch {} pendingDone.current = true; setQueued(false); }
  async function logout() { await api.post('/api/auth/logout'); location.href = '/'; }
  function updatePref(key, value) {
    const prefs = { ...(user?.prefs || {}), [key]: value };
    setUser(u => ({ ...u, prefs }));
    api.patch('/api/me', { prefs }).catch(() => {});
  }

  if (user === undefined) return <div style={{ height: '100%', background: 'var(--bg)' }} />;
  if (!user) return <Login onLogin={(u) => { setUser(u); setIntro(true); }} />;

  const model = models.find(m => m.id === currentId);
  const sandboxAllowed = incognito ? false : (model ? model.sandboxAllowed !== false : true);
  const sandboxOn = sandboxAllowed && sandbox;
  const webSearchAvailable = !incognito && !!cfg.webSearchAvailable;
  const webSearchOn = webSearchAvailable && webSearch;
  const empty = !activeId && messages.length === 0;
  const bgInChat = user?.prefs?.modelBgInChat !== false;
  const modelHasBg = !incognito && !!(model?.bgEnabled && model?.bgImage);
  const activeBg = computeActiveBg(models, currentId, activeId, messages.length, incognito, user?.prefs);
  const composerProps = {
    value: input, onChange: setInput, onSend: send, onStop: stop, streaming: streaming || queued,
    models, currentId, onSelect: setCurrentId, extended, onToggleExtended: () => setExtended(e => !e),
    visionSupported: !!model?.hasVision, canUseUnavailable: !!user?.isAdmin, budget,
    modelHasBg, bgInChat, onToggleBgInChat: () => updatePref('modelBgInChat', !bgInChat),
    sandbox: sandboxOn, sandboxAllowed, onToggleSandbox: () => { if (sandboxAllowed) setSandbox(s => !s); },
    onWantSandbox: () => { if (sandboxAllowed) setSandbox(true); },
    webSearch: webSearchOn, webSearchAvailable, onToggleWebSearch: () => { if (webSearchAvailable) setWebSearch(s => !s); },
    project: currentProject, onClearProject: clearChatProject
  };
  const showArtifactsBtn = sandboxOn || files.length > 0;

  const commands = [
    { id: 'new', label: 'New chat', shortcut: 'Ctrl Shift O', keywords: 'create start', action: () => newChat() },
    { id: 'sidebar', label: collapsed ? 'Show sidebar' : 'Hide sidebar', shortcut: 'Ctrl Shift S', keywords: 'toggle collapse panel', action: () => setCollapsed(c => !c) },
    { id: 'chats', label: 'Browse all chats', keywords: 'overview history search', action: () => setChatsOverview(true) },
    { id: 'spaces', label: 'Open Spaces', keywords: 'group chat invite users', action: () => { history.pushState({}, '', '/spaces'); setShowSpaces(true); } },
    { id: 'projects', label: 'Open Projects', keywords: 'project workspace organize', action: () => openProjects(null) },
    { id: 'incognito', label: incognito ? 'Exit incognito' : 'Start incognito chat', keywords: 'private ghost', action: () => toggleIncognito() },
    { id: 'settings', label: 'Open settings', keywords: 'preferences account theme', action: () => setShowSettings(true) },
    ...(user?.isAdmin ? [{ id: 'admin', label: 'Open admin panel', keywords: 'models users connection providers', action: () => { history.pushState({}, '', '/admin'); setShowAdmin(true); } }] : []),
    { id: 'changelog', label: 'View changelog', keywords: 'updates version', action: () => setShowChangelog(true) },
    { id: 'credits', label: 'View credits', keywords: 'about', action: () => setShowCredits(true) },
    { id: 'license', label: 'View licensing', keywords: 'legal', action: () => setShowLicense(true) },
    { id: 'logout', label: 'Log out', keywords: 'sign out exit', action: () => logout() }
  ];

  return (
    <div className={'app' + (incognito ? ' app-incognito' : '') + (intro ? ' intro' : '') + (bgVisible ? ' has-bg' : '')}>
      <AppBackground bg={activeBg} />
      {intro && <div className="intro-curtain" />}
      <Sidebar user={user} chats={chats} chatsLoaded={chatsLoaded} activeId={activeId} appName={cfg.appName}
        folders={folders} onCreateFolder={createFolder} onRenameFolder={renameFolder} onToggleFolder={toggleFolder} onDeleteFolder={deleteFolder} onMoveChat={moveChatToFolder}
        onNew={newChat} onOpen={openChat} onDelete={deleteChat} onToggleStar={toggleStar}
        collapsed={collapsed} onToggle={() => setCollapsed(c => !c)}
        onSettings={() => setShowSettings(true)} onAdmin={() => { history.pushState({}, '', '/admin'); setShowAdmin(true); }}
        onCredits={() => setShowCredits(true)} onChangelog={() => setShowChangelog(true)} onLicense={() => setShowLicense(true)} onLogout={logout} version={cfg.version}
        onChatsOverview={() => setChatsOverview(true)}
        onSpaces={() => { history.pushState({}, '', '/spaces'); setShowSpaces(true); }} spacesPending={spacesPending}
        projects={projects} onProjects={() => openProjects(null)} onOpenProject={(id) => openProjects(id)} />

      <div className={'main' + (incognito ? ' incognito' : '')} data-incognito={incognito ? 'on' : undefined}>
        {incognito && (
          <div className="incognito-bar">
            <div className="incognito-title"><Ghost style={{ width: 18 }} /> Incognito chat</div>
            <button className="incognito-close" onClick={toggleIncognito} title="Exit incognito" disabled={streaming || queued}>✕</button>
          </div>
        )}
        {!incognito && empty && (
          <button className="incognito-fab" onClick={toggleIncognito} title="Incognito chat — not saved" disabled={streaming || queued}>
            <Ghost style={{ width: 18 }} />
          </button>
        )}
        {empty ? (
          <div className="center-wrap">
            <div className="greeting">
              {incognito
                ? <><Ghost style={{ width: 44 }} /> {incognitoGreeting}</>
                : (model?.staticIcon
                  ? <><img src={model.staticIcon} alt="" style={{ width: 44, height: 44, objectFit: 'contain' }} /> {greeting}</>
                  : greeting)}
            </div>
            <div className="composer-wrap">
              <Composer {...composerProps} autoFocus modelUp focusKey={focusTick} />
            </div>
            <div className="qp-slot">
              {incognito ? (
                <div className="incognito-note">Incognito chats aren't saved to your history.</div>
              ) : cfg.quickPrompts && cfg.quickPrompts.length > 0 && (
                <QuickPrompts prompts={cfg.quickPrompts} visible={!input.trim()} disabled={streaming} onPick={(p) => send([], p)} />
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="topbar">
              <div className="chat-name">{chats.find(c => c.id === activeId)?.title || 'New chat'} <ChevDown style={{ width: 15 }} /></div>
              <div className="topbar-actions">
                {!incognito && (
                  <button className="paper-btn" onClick={toggleIncognito} title="Incognito chat — not saved" disabled={streaming || queued}>
                    <Ghost style={{ width: 18 }} />
                  </button>
                )}
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
              <div className={'thread' + (threadStagger ? ' stagger' : '')}>
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
        <ArtifactsPanel chatId={activeId} files={files} live={liveFile} pending={pendingFiles} focus={artifactFocus} onClose={() => setArtifactsOpen(false)} />
      )}

      {summaryOpen && activeId && (
        <SummaryModal chatId={activeId} onClose={() => setSummaryOpen(false)}
          onChanged={(has) => { setHasSummary(has); }} />
      )}

      {showSettings && <SettingsModal user={user} cfg={cfg} onClose={() => setShowSettings(false)} onUpdated={setUser} onDeleted={() => { location.href = '/'; }} onExportChats={exportAllChats} onImportChats={importChatsFile} />}
      {chatsOverview && <ChatsOverview onClose={() => setChatsOverview(false)} onOpen={(id) => { setChatsOverview(false); openChat(id); }} />}
      {showAdmin && <AdminPanel user={user} onClose={() => { setShowAdmin(false); if (/^\/admin(\/|$)/.test(location.pathname)) history.pushState({}, '', '/'); }} />}
      {showSpaces && <SpacesPanel user={user} onClose={() => { setShowSpaces(false); refreshSpacesPending(); if (/^\/spaces(\/|$)/.test(location.pathname)) history.pushState({}, '', '/'); }} />}
      {showProjects && <ProjectsPanel openId={projectOpenId} composerProps={composerProps}
        onClose={() => { setShowProjects(false); setProjectOpenId(null); if (/^\/projects?(\/|$)/.test(location.pathname) || /^\/project\//.test(location.pathname)) history.pushState({}, '', '/'); }}
        onOpenChat={openProjectChat} onStartChat={startProjectChat}
        onOpenProject={(id) => { setProjectOpenId(id); history.replaceState({}, '', id ? '/project/' + id : '/projects'); loadProjects(); }} />}
      {showCredits && <DocModal title="Credits" name="credits" serif onClose={() => setShowCredits(false)} />}
      {showLicense && <DocModal title="Licensing" name="license" onClose={() => setShowLicense(false)} />}
      {showChangelog && <DocModal title="Changelog" name="changelog" onClose={() => setShowChangelog(false)} />}
      {cmdkOpen && <CommandPalette commands={commands} onClose={() => setCmdkOpen(false)} />}
    </div>
  );
}
