import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from './api.js';
import { t } from './i18n.jsx';
import { applyPrefs } from './prefs.js';
import { kwargValuesArr, defaultValueOf } from './kwargs.js';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import AppBackground from './components/AppBackground.jsx';
import Composer from './components/Composer.jsx';
import QuickPrompts from './components/QuickPrompts.jsx';
import CompactingBar from './components/CompactingBar.jsx';
import EngineStrip from './components/EngineStrip.jsx';
import LedgerBar from './components/LedgerBar.jsx';
import SummaryModal from './components/SummaryModal.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { computeActiveBg } from './lib/appbg.js';

import Message from './components/Message.jsx';
const SettingsModal = React.lazy(() => import('./components/SettingsModal.jsx'));
const ModelDocs = React.lazy(() => import('./components/ModelDocs.jsx'));
const AdminPanel = React.lazy(() => import('./components/AdminPanel.jsx'));
const Playground = React.lazy(() => import('./components/Playground.jsx'));
import DocModal from './components/DocModal.jsx';
import ArtifactsPanel from './components/ArtifactsPanel.jsx';
import ChatControls from './components/ChatControls.jsx';
import ModelDropdown from './components/ModelDropdown.jsx';
import CallPanel from './components/CallPanel.jsx';
import { voiceEmit } from './voice.js';
import ChatsOverview from './components/ChatsOverview.jsx';
import SpacesPanel from './components/SpacesPanel.jsx';
import ProjectsPanel from './components/ProjectsPanel.jsx';
import ChatMenu from './components/ChatMenu.jsx';
import PersonasModal from './components/PersonasModal.jsx';
import SearchModal from './components/SearchModal.jsx';
import Toaster from './components/Toaster.jsx';
import Lightbox from './components/Lightbox.jsx';
import ShortcutsModal from './components/ShortcutsModal.jsx';
import ThreadRail from './components/ThreadRail.jsx';
import ThreadFind from './components/ThreadFind.jsx';
import { railItems } from './lib/threadmeta.js';
const BranchTree = React.lazy(() => import('./components/BranchTree.jsx'));
import { toast } from './toast.js';
import { copyText } from './clipboard.js';
import { Down, ChevDown, Paper, Compact, Ghost, Search, Menu, Sliders, X, Gauge, Fork } from './components/icons.jsx';

const DEFAULT_CFG = { appName: 'open-quill', disclaimer: 'Assistants can make mistakes, double-check responses.', greetings: ['How can I help you?'], appIcon: '', quickPrompts: [], version: '' };





export default function App() {
  const [user, setUser] = useState(undefined);
  const userRef = useRef(undefined);
  useEffect(() => { userRef.current = user; }, [user]);
  const [intro, setIntro] = useState(false);
  const [models, setModels] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [chatRemovedModel, setChatRemovedModel] = useState(null);
  const modelsRef = useRef([]);
  const modelsLoadedRef = useRef(false);
  const pendingModelCheck = useRef(null);
  const pickModel = useCallback((id) => { setChatRemovedModel(null); setCurrentId(id); }, []);
  const modelById = useMemo(() => {
    const m = new Map();
    for (const x of models) m.set(x.id, x);
    return m;
  }, [models]);
  useEffect(() => {
    modelsRef.current = models;
    if (models.length) modelsLoadedRef.current = true;
  }, [models]);
  useEffect(() => {
    if (!models.length) return;
    const p = pendingModelCheck.current;
    if (!p) return;
    pendingModelCheck.current = null;
    resolveLastModel(p);
  }, [models]);
  const ghostModels = useRef(new Map());
  const resolveMsgModel = useCallback((msg, fallback) => {
    const live = modelById.get(msg.model_id);
    if (live) return live;
    if (msg.role === 'assistant' && msg.model_id && (msg.model_name || msg.model_icon)) {
      const key = msg.model_id + '|' + (msg.model_name || '') + '|' + (msg.model_icon || '');
      let g = ghostModels.current.get(key);
      if (!g) {
        g = { id: msg.model_id, displayName: msg.model_name || t('Removed model'), staticIcon: msg.model_icon || '', removed: true };
        ghostModels.current.set(key, g);
      }
      return g;
    }
    return fallback;
  }, [modelById]);
  const sidebarFns = useRef({});
  const sbCreateFolder = useCallback((...a) => sidebarFns.current.createFolder(...a), []);
  const sbRenameFolder = useCallback((...a) => sidebarFns.current.renameFolder(...a), []);
  const sbToggleFolder = useCallback((...a) => sidebarFns.current.toggleFolder(...a), []);
  const sbDeleteFolder = useCallback((...a) => sidebarFns.current.deleteFolder(...a), []);
  const sbMoveChat = useCallback((...a) => sidebarFns.current.moveChatToFolder(...a), []);
  const sbNewChat = useCallback((...a) => sidebarFns.current.newChat(...a), []);
  const sbOpenChat = useCallback((...a) => sidebarFns.current.openChat(...a), []);
  const sbDeleteChat = useCallback((...a) => sidebarFns.current.deleteChat(...a), []);
  const sbToggleStar = useCallback((...a) => sidebarFns.current.toggleStar(...a), []);
  const sbLogout = useCallback((...a) => sidebarFns.current.logout(...a), []);
  const sbProjects = useCallback(() => sidebarFns.current.openProjects(null), []);
  const sbOpenProject = useCallback((id) => sidebarFns.current.openProjects(id), []);
  const onSearchCb = useCallback(() => setShowSearch(true), []);
  const onToggleSidebarCb = useCallback(() => setCollapsed(c => !c), []);
  const onMobileCloseCb = useCallback(() => setMobileDrawer(false), []);
  const onSettingsCb = useCallback(() => setShowSettings(true), []);
  const onAdminCb = useCallback(() => { history.pushState({}, '', '/admin'); setShowAdmin(true); }, []);
  const onPlaygroundCb = useCallback(() => { history.pushState({}, '', '/playground'); setShowPlayground(true); }, []);
  const onCreditsCb = useCallback(() => setShowCredits(true), []);
  const onChangelogCb = useCallback(() => setShowChangelog(true), []);
  const onLicenseCb = useCallback(() => setShowLicense(true), []);
  const onChatsOverviewCb = useCallback(() => { setMobileDrawer(false); setChatsOverview(true); }, []);
  const onSpacesCb = useCallback(() => { setMobileDrawer(false); history.pushState({}, '', '/spaces'); setShowSpaces(true); }, []);
  const closeArtifacts = useCallback(() => setArtifactsOpen(false), []);

  const [extended, setExtended] = useState(false);
  const [kwargValues, setKwargValues] = useState({});
  const reasoningEffort = kwargValues.effort || '';
  const setKwarg = useCallback((id, value) => setKwargValues(prev => ({ ...prev, [id]: value })), []);
  const setReasoningEffort = useCallback((value) => setKwargValues(prev => ({ ...prev, effort: typeof value === 'function' ? value(prev.effort || '') : value })), []);
  const [bgVisible, setBgVisible] = useState(false);
  const [chats, setChats] = useState([]);
  const [folders, setFolders] = useState([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [safetyFlagged, setSafetyFlagged] = useState(false);
  const [safetyChecking, setSafetyChecking] = useState(false);
  const [safetyReason, setSafetyReason] = useState('');
  const [chatEnded, setChatEnded] = useState(false);
  const [ctlOpen, setCtlOpen] = useState(false);
  const [chatGenParams, setChatGenParams] = useState(null);
  const [chatSysOverride, setChatSysOverride] = useState('');
  const [chatEndedReason, setChatEndedReason] = useState('');
  const [queuedList, setQueuedList] = useState([]);
  const queuedListRef = useRef([]);
  const setQueue = (updater) => setQueuedList(prev => { const next = typeof updater === 'function' ? updater(prev) : updater; queuedListRef.current = next; return next; });
  const chatCache = useRef(new Map());
  const cacheChat = (id, entry) => {
    if (!id) return;
    const cache = chatCache.current;
    const prev = cache.get(id) || {};
    cache.delete(id);
    cache.set(id, { ...prev, ...entry });
    if (cache.size > 25) cache.delete(cache.keys().next().value);
  };
  const sendRef = useRef(null);
  const genOptsRef = useRef({});
  const [canContinue, setCanContinue] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const compareRef = useRef(null);
  const draftKey = (id) => 'oq-draft-' + (id || 'new');
  const draftTimer = useRef(null);
  const draftPending = useRef(null);
  const flushDraftRef = useRef(null);
  const writeDraft = (id, text) => {
    try {
      if (text && text.trim()) localStorage.setItem(draftKey(id), text);
      else localStorage.removeItem(draftKey(id));
    } catch {}
  };
  const flushDraft = () => {
    clearTimeout(draftTimer.current);
    draftTimer.current = null;
    const p = draftPending.current;
    if (!p) return;
    draftPending.current = null;
    writeDraft(p.id, p.text);
  };
  flushDraftRef.current = flushDraft;
  const saveDraft = (id, text) => {
    if (incognitoRef.current) return;
    const p = draftPending.current;
    if (p && p.id !== id) flushDraft();
    draftPending.current = { id, text };
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(flushDraft, 200);
  };
  const loadDraft = (id) => { try { return localStorage.getItem(draftKey(id)) || ''; } catch { return ''; } };
  const clearDraft = (id) => {
    clearTimeout(draftTimer.current);
    draftTimer.current = null;
    draftPending.current = null;
    try { localStorage.removeItem(draftKey(id)); } catch {}
  };
  useEffect(() => {
    const flush = () => { if (flushDraftRef.current) flushDraftRef.current(); };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, []);
  const styleId = user?.prefs?.styleId || 'normal';
  const setStyleId = (id) => updatePref('styleId', id);
  const saveStyles = async (list) => {
    const { styles } = await api.put('/api/me/styles', { styles: list });
    setUser(u => ({ ...u, styles }));
  };
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPlayground, setShowPlayground] = useState(false);
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
  const [liveCall, setLiveCall] = useState(null);
  const [compacting, setCompacting] = useState(false);
  const [hasSummary, setHasSummary] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [chatInstructions, setChatInstructions] = useState('');
  const [chatPins, setChatPins] = useState([]);
  const [personasOpen, setPersonasOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
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
  const [findOpen, setFindOpen] = useState(false);
  const [findMatches, setFindMatches] = useState(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [kbFocus, setKbFocus] = useState(null);
  const kbFocusRef = useRef(null);
  useEffect(() => { kbFocusRef.current = kbFocus; }, [kbFocus]);
  const onFindMatches = useCallback((ids) => setFindMatches(ids), []);
  const closeFind = useCallback(() => { setFindOpen(false); setFindMatches(null); }, []);
  const msgActions = useRef({});
  const railList = useMemo(() => railItems(messages), [messages]);
  const findRevision = useMemo(() => {
    let n = 0;
    for (const m of messages) n += m.content ? m.content.length : 0;
    return messages.length + ':' + n;
  }, [messages]);
  useEffect(() => {
    const prev = document.querySelectorAll('.msg.kb-focus');
    prev.forEach(el => el.classList.remove('kb-focus'));
    if (!kbFocus) return;
    const el = document.querySelector('[data-mid="' + kbFocus + '"]');
    if (el) el.classList.add('kb-focus');
  }, [kbFocus, messages]);
  useEffect(() => { setKbFocus(null); }, [activeId]);
  const msgKeysOn = user?.prefs?.msgKeys !== false;
  useEffect(() => { if (!msgKeysOn) setKbFocus(null); }, [msgKeysOn]);

  const [telemetry, setTelemetry] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [liveSteers, setLiveSteers] = useState([]);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const ledgerDefaultApplied = useRef(false);
  const [ledger, setLedger] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  const [queued, setQueued] = useState(false);
  const [chatErrors, setChatErrors] = useState({});
  const [dispContent, setDispContent] = useState('');
  const [dispReason, setDispReason] = useState('');
  const [phase, setPhase] = useState('static');

  const ws = useRef(null);
  const gen = useRef(new Map());
  const targetContent = useRef('');
  const targetReason = useRef('');
  const pendingDone = useRef(false);
  const liveRef = useRef(null);
  const selectingRef = useRef(false);
  const hasSelectionRef = useRef(false);
  const assistantIdRef = useRef(null);
  const streamModelRef = useRef(null);
  const revealTimer = useRef(null);
  const followRaf = useRef(0);
  const followTs = useRef(0);
  const dispLen = useRef(0);
  const scrollRef = useRef(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  const programmatic = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const animate = user?.prefs?.animations == null ? cfg.uiPreset !== 'openai' : user.prefs.animations !== false;
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
  const messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    const m = models.find(x => x.id === currentId);
    const defs = (m && Array.isArray(m.kwargs)) ? m.kwargs.filter(d => !d.parentId) : [];
    if (!defs.length) return;
    setKwargValues(prev => {
      let changed = false;
      const next = { ...prev };
      for (const d of defs) {
        const values = kwargValuesArr(d);
        if (!values.length) continue;
        if (values.includes(next[d.id])) continue;
        next[d.id] = defaultValueOf(d);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [currentId, models]);
  const homeSelectionRef = useRef(null);
  useEffect(() => {
    if (!activeId && !incognito) homeSelectionRef.current = { modelId: currentId, extended, kwargValues };
  }, [activeId, incognito, currentId, extended, kwargValues]);
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

  useEffect(() => () => {
    stopLoops();
    clearTimeout(staggerTimer.current);
    clearTimeout(draftTimer.current);
  }, []);

  useEffect(() => {
    api.get('/api/me').then(({ user }) => setUser(user)).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    if (!user) return;
    const preset = cfg?.uiPreset === 'openai' ? 'openai' : 'anthropic';
    applyPrefs(user?.prefs, preset);
    const t = user?.prefs?.theme || 'dark';
    if (t === 'system' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const h = () => applyPrefs(user?.prefs, preset);
      mq.addEventListener?.('change', h);
      return () => mq.removeEventListener?.('change', h);
    }
  }, [user, cfg?.uiPreset]);
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
    const down = (e) => { if (scrollRef.current && scrollRef.current.contains(e.target)) selectingRef.current = true; };
    const up = () => { selectingRef.current = false; };
    const selChange = () => {
      let has = false;
      try {
        const sel = window.getSelection();
        has = !!(sel && !sel.isCollapsed && sel.rangeCount && scrollRef.current && scrollRef.current.contains(sel.getRangeAt(0).commonAncestorContainer));
      } catch { has = false; }
      hasSelectionRef.current = has;
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('selectionchange', selChange);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('selectionchange', selChange);
    };
  }, []);
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
    const nav = user.prefs || {};
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); setCollapsed(c => !c); return; }
      if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setCmdkOpen(o => !o); return; }
      if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); setShowSearch(true); return; }
      if (e.key === '?' && !mod) {
        const el = document.activeElement;
        const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        if (!typing) { e.preventDefault(); setShowShortcuts(s => !s); return; }
      }
      if (mod && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); newChat(); return; }
      if (mod && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        if (nav.threadFind === false || !messagesRef.current.length) return;
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if (mod || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (document.querySelector('.overlay')) return;
      const list = messagesRef.current;
      if (!list.length) return;
      if (e.key === 'b') {
        if (nav.branchMap === false) return;
        e.preventDefault();
        if (activeIdRef.current) setTreeOpen(true);
        return;
      }
      if (nav.msgKeys === false) return;
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const at = list.findIndex(m => m.id === kbFocusRef.current);
        let next;
        if (at < 0) next = e.key === 'j' ? 0 : list.length - 1;
        else next = Math.max(0, Math.min(list.length - 1, at + (e.key === 'j' ? 1 : -1)));
        const target = list[next];
        if (target) { setKbFocus(target.id); jumpToMessage(target.id, { flash: false }); }
        return;
      }
      const focused = kbFocusRef.current ? list.find(m => m.id === kbFocusRef.current) : null;
      if (!focused) return;
      if (e.key === 'Escape') { e.preventDefault(); setKbFocus(null); return; }
      if (e.key === 'c') {
        e.preventDefault();
        const clean = (focused.content || '').replace(/\[\[OQR:[A-Za-z0-9+/=]+\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
        copyText(clean).then(ok => ok && toast(t('Message copied')));
        return;
      }
      if (e.key === 'e') {
        if (focused.role !== 'user' || streamingRef.current) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('oq-msg-edit', { detail: { id: focused.id } }));
        return;
      }
      if (e.key === 'r') {
        if (focused.role !== 'assistant' || streamingRef.current) return;
        e.preventDefault();
        msgActions.current.regenerate?.(focused.id);
        return;
      }
      if (e.key === 'y') {
        if (streamingRef.current || !activeIdRef.current) return;
        e.preventDefault();
        msgActions.current.fork?.(focused.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user]);
  useEffect(() => {
    const m = models.find(x => x.id === currentId);
    if (m && m.sandboxAllowed === false) setSandbox(false);
    if (m && m.webSearchAllowed === false) setWebSearch(false);
    else if (!activeId && !incognito && m && user?.prefs?.webSearchDefault && cfg.webSearchAvailable) setWebSearch(true);
  }, [currentId, activeId, models, incognito, cfg.webSearchAvailable, user?.prefs?.webSearchDefault]);
  function openFromUrl() {
    const p = location.pathname;
    const wantsAdmin = /^\/admin(\/|$)/.test(p);
    const wantsPlayground = /^\/playground(\/|$)/.test(p);
    const isAdmin = !!user?.isAdmin;
    if ((wantsAdmin || wantsPlayground) && !isAdmin) history.replaceState({}, '', '/');
    const admin = wantsAdmin && isAdmin;
    const playground = wantsPlayground && isAdmin;
    setShowAdmin(admin);
    setShowPlayground(playground);
    if (admin || playground) return;
    const spaces = /^\/spaces(\/|$)/.test(p);
    setShowSpaces(spaces);
    if (spaces) return;
    const pm = p.match(/^\/project\/(.+)$/);
    if (pm) { setProjectOpenId(decodeURIComponent(pm[1])); setShowProjects(true); return; }
    if (/^\/projects(\/|$)/.test(p)) { setProjectOpenId(null); setShowProjects(true); return; }
    setShowProjects(false);
    const m = p.match(/^\/chat\/(.+)$/);
    if (m) openChat(decodeURIComponent(m[1]), false);
    else {
      flushDraft();
      setActiveId(null); setMessages([]);
      if (!incognitoRef.current) setInput(loadDraft(null));
    }
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
  const [presetPicked, setPresetPicked] = useState(false);
  async function choosePreset(p) {
    setPresetPicked(true);
    try { await api.patch('/api/admin/app-config', { uiPreset: p }); await loadAppConfig(); } catch {}
  }
  useEffect(() => {
    const appName = cfg.appName || 'open-quill';
    if (incognito) { document.title = 'Incognito chat - ' + appName; return; }
    const active = activeId ? chats.find(c => c.id === activeId) : null;
    document.title = active ? `${active.title || t('Untitled chat')} - ${appName}` : `New chat - ${appName}`;
  }, [activeId, chats, cfg.appName, incognito]);
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
    const preset = c.uiPreset === 'openai' ? 'openai' : 'anthropic';
    document.documentElement.setAttribute('data-preset', preset);
    try { localStorage.setItem('oq-preset', preset); } catch {}
    applyPrefs(userRef.current?.prefs, preset);
    document.documentElement.setAttribute('data-font', c.appFont === 'sans' ? 'sans' : 'serif');
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
      setChatErrors(prev => ({ ...prev, [activeKey()]: 'Connection lost, reconnecting. Try again in a moment.' }));
      return false;
    }
    try { sock.send(JSON.stringify(obj)); return true; }
    catch { return false; }
  }

  function activeKey() { return incognitoRef.current ? 'incognito' : activeIdRef.current; }
  function dismissError(key) {
    const k = key || activeKey();
    setChatErrors(prev => { if (!(k in prev)) return prev; const n = { ...prev }; delete n[k]; return n; });
  }
  function recFor(key) {
    let r = gen.current.get(key);
    if (!r) { r = { content: '', reasoning: '', phase: 'generating', done: false, assistantId: null, model_id: currentIdRef.current, live: null, steers: [], status: null }; gen.current.set(key, r); }
    return r;
  }

  const ledgerOpenRef = useRef(false);
  useEffect(() => { ledgerOpenRef.current = ledgerOpen; }, [ledgerOpen]);
  useEffect(() => {
    if (ledgerDefaultApplied.current || !user) return;
    ledgerDefaultApplied.current = true;
    if (user.prefs?.ledgerDefault) setLedgerOpen(true);
  }, [user]);
  const loadLedger = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) { setLedger(null); return; }
    try { setLedger(await api.get('/api/chats/' + id + '/ledger?modelId=' + encodeURIComponent(currentIdRef.current || ''))); }
    catch { setLedger(null); }
  }, []);
  useEffect(() => {
    if (!ledgerOpen || !activeId) return;
    loadLedger();
  }, [ledgerOpen, activeId, currentId, messages.length, loadLedger]);
  const toggleExclude = useCallback(async (messageId, excluded) => {
    const id = activeIdRef.current;
    if (!id) return;
    setLedger(l => l ? { ...l, messages: l.messages.map(m => m.id === messageId ? { ...m, excluded } : m) } : l);
    setMessages(ms => ms.map(m => m.id === messageId ? { ...m, excluded } : m));
    try { await api.patch('/api/chats/' + id + '/messages/' + messageId, { excluded }); } catch {}
    loadLedger();
    toast(excluded ? t('Message dropped from context') : t('Message back in context'), { icon: 'info' });
  }, [loadLedger]);
  const steer = useCallback((text) => {
    const id = activeIdRef.current;
    const body = String(text || '').trim();
    if (!id || !body) return;
    wsSend({ type: 'steer', chatId: id, text: body });
    setLiveSteers(l => [...l, body]);
  }, []);

  function handleWs(m) {
    if (m.type === 'session_revoked') { location.href = '/'; return; }
    if (m.type === 'config') { loadModels(); loadAppConfig(); try { window.dispatchEvent(new CustomEvent('oq-config')); } catch {} return; }
    if (m.type === 'resume') {
      const list = Array.isArray(m.turns) ? m.turns : [];
      for (const t of list) {
        if (!t || !t.chatId) continue;
        gen.current.set(t.chatId, {
          content: t.content || '',
          reasoning: t.reasoning || '',
          phase: t.phase === 'queued' ? 'queued' : (t.phase === 'thinking' ? 'thinking' : 'generating'),
          done: false,
          assistantId: t.messageId || null,
          model_id: t.modelId || currentIdRef.current,
          live: t.live || null,
          steers: Array.isArray(t.steers) ? t.steers : [],
          status: t.status || null
        });
      }
      if (list.some(t => t && t.chatId === activeKey())) syncView();
      return;
    }
    if (typeof m.type === 'string' && m.type.startsWith('space_')) {
      try { window.dispatchEvent(new CustomEvent('oq-space', { detail: m })); } catch {}
      if (m.type === 'space_invite' || m.type === 'space_updated' || m.type === 'space_removed' || m.type === 'space_deleted') refreshSpacesPending();
      return;
    }
    if (m.type === 'files') {
      if (m.chatId && m.chatId !== activeIdRef.current) return;
      setFiles(m.files || []);
      const lf = liveRef.current;
      if (lf && lf.path && (m.files || []).some(f => f.path === lf.path)) { liveRef.current = null; setLiveFile(null); }
      return;
    }
    if (m.type === 'tool_live') {
      const r = recFor(m.chatId); r.live = m.live || null;
      if (m.chatId !== activeKey()) return;
      const live = m.live;
      if (live && live.path && (live.tool === 'create_file' || live.tool === 'str_replace')) {
        const lf = { path: live.path, content: live.content || '', tool: live.tool, oldStr: live.oldStr ?? null };
        liveRef.current = lf; setLiveFile(lf);
      } else if (!live) {
        liveRef.current = null; setLiveFile(null);
      }
      setLiveCall(live && live.tool ? { ...live } : null);
      return;
    }
    if (m.type === 'tool_live_delta') {
      const r = recFor(m.chatId);
      if (r.live && r.live.tool) r.live = { ...r.live, content: (r.live.content || '') + m.text };
      if (m.chatId !== activeKey()) return;
      const lf = liveRef.current;
      if (lf) { const nf = { ...lf, content: (lf.content || '') + m.text }; liveRef.current = nf; setLiveFile(nf); }
      return;
    }
    if (m.type === 'tool_exec') {
      const r = recFor(m.chatId); r.live = m.call || null;
      if (m.chatId !== activeKey()) return;
      if (m.call && m.call.tool) setLiveCall(m.call);
      return;
    }
    if (m.type === 'tool') { return; }
    if (m.type === 'compacting') { if (m.chatId === activeKey()) setCompacting(true); return; }
    if (m.type === 'compacted') { if (m.chatId === activeKey()) { setCompacting(false); setHasSummary(true); } return; }
    if (m.type === 'ctx_rolling') {
      if (m.chatId === activeKey()) toast(`Context limit reached (${(m.limit || 0).toLocaleString()} tokens), trimming older messages so the chat can continue`, { icon: 'info', kind: 'warn', duration: 6000 });
      return;
    }
    if (m.type === 'title') { setChats(cs => cs.map(c => c.id === m.chatId ? { ...c, title: m.title } : c)); return; }
    if (m.type === 'chat_ended') {
      setChats(cs => cs.map(c => c.id === m.chatId ? { ...c, ended: true } : c));
      if (m.chatId === activeKey()) { setChatEnded(true); setChatEndedReason(m.reason || ''); }
      return;
    }
    if (m.type === 'queued') {
      const r = recFor(m.chatId); r.phase = 'queued';
      if (m.chatId === activeKey()) setQueued(true);
      return;
    }
    if (m.type === 'status') {
      const r = recFor(m.chatId);
      r.status = m.phase === 'generating' ? null : { phase: m.phase, processed: m.processed, total: m.total, cache: m.cache, pct: m.pct, ms: m.ms };
      if (m.chatId === activeKey()) setModelStatus(r.status);
      return;
    }
    if (m.type === 'telemetry') {
      if (m.chatId === activeKey()) setTelemetry({ tps: m.tps, promptTps: m.promptTps, promptTokens: m.promptTokens, genTokens: m.genTokens, ctx: m.ctx, exact: !!m.exact });
      return;
    }
    if (m.type === 'steered') {
      const r = recFor(m.chatId);
      r.steers = [...(r.steers || []), ...(m.notes || [])];
      if (m.chatId === activeKey()) setLiveSteers(r.steers);
      return;
    }
    if (m.type === 'start') {
      voiceEmit({ type: 'start', chatId: m.chatId });
      const r = recFor(m.chatId);
      r.content = ''; r.reasoning = ''; r.phase = 'generating'; r.done = false; r.error = false; r.assistantId = m.messageId; r.live = null; r.steers = []; r.status = null;
      if (m.chatId === activeKey()) {
        setTelemetry(null); setLiveSteers([]); setModelStatus(null);
        refreshSeq.current++;
        setCompacting(false); setLiveFile(null); setLiveCall(null); liveRef.current = null;
        targetContent.current = ''; targetReason.current = ''; pendingDone.current = false;
        assistantIdRef.current = m.messageId; dispLen.current = 0;
        streamModelRef.current = r.model_id || currentIdRef.current;
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
      voiceEmit({ type: 'content', chatId: m.chatId, text: m.text });
      const r = recFor(m.chatId); r.content += m.text; r.phase = 'generating';
      if (m.chatId === activeKey()) {
        targetContent.current = r.content;
        setPhase('generating');
        if (m.text.indexOf('[[OQR:') !== -1) { dispLen.current = r.content.length; setDispContent(r.content); setLiveCall(null); }
        else if (!animateRef.current) { setDispContent(r.content); dispLen.current = r.content.length; }
      }
      return;
    }
    if (m.type === 'error') {
      voiceEmit({ type: 'error', chatId: m.chatId });
      const r = gen.current.get(m.chatId);
      const hadContent = !!(r && r.content);
      if (m.chatId === activeKey()) {
        if (hadContent) { pendingDone.current = true; finalize(); }
        else {
          stopLoops();
          gen.current.delete(m.chatId);
          targetContent.current = ''; targetReason.current = ''; pendingDone.current = false; dispLen.current = 0;
          setDispContent(''); setDispReason('');
          setLiveFile(null); setLiveCall(null); liveRef.current = null;
          setQueued(false); setStreaming(false); setPhase('static');
        }
      } else if (hadContent) {
        finalizeBackground(m.chatId);
      } else {
        gen.current.delete(m.chatId);
      }
      setChatErrors(prev => ({ ...prev, [m.chatId]: String(m.error || 'The model returned an error.') }));
      return;
    }
    if (m.type === 'done') {
      voiceEmit({ type: 'done', chatId: m.chatId });
      const r = recFor(m.chatId); r.done = true;
      if (m.chatId === activeKey()) { pendingDone.current = true; if (!animateRef.current) finalize(); }
      else finalizeBackground(m.chatId);
      loadBudget();
      if (m.chatId === activeKey()) {
        if (ledgerOpenRef.current) loadLedger();
        setCanContinue(!!m.truncated);
        const cmp = compareRef.current;
        if (cmp && cmp.chatId === m.chatId) {
          if (!cmp.messageId && m.messageId) cmp.messageId = m.messageId;
          const nextId = cmp.remaining.shift();
          if (nextId && cmp.messageId) {
            (() => { const g = genOptsRef.current; setTimeout(() => wsSend({ type: 'regenerate', chatId: cmp.chatId, modelId: nextId, extended: g.extended, reasoningEffort: g.reasoningEffort, kwargValues: g.kwargValues, messageId: cmp.messageId, sandbox: g.sandbox, webSearch: g.webSearch, styleId: g.styleId }), 150); })();
          } else {
            compareRef.current = null;
            toast('Model comparison ready, use the version arrows or compare button on the response.', { duration: 6000 });
            (() => { const q2 = queuedListRef.current[0]; if (q2) { setQueue(l => l.slice(1)); setTimeout(() => sendRef.current(q2.attachments || [], q2.text, { fromQueue: true }), 150); } })();
          }
        } else {
          const q = queuedListRef.current[0];
          if (q) { setQueue(l => l.slice(1)); setTimeout(() => sendRef.current(q.attachments || [], q.text, { fromQueue: true }), 120); }
        }
      }
      return;
    }
  }

  function stopLoops() {
    clearInterval(revealTimer.current);
    revealTimer.current = null;
    cancelAnimationFrame(followRaf.current);
    followRaf.current = 0;
  }

  function startStream() {
    stopLoops();
    follow();
    const period = Math.max(8, Math.min(100, revealRef.current || 0)) ;
    revealTimer.current = setInterval(() => {
      const target = targetContent.current;
      if (dispLen.current >= target.length) { if (pendingDone.current) finalize(); return; }
      const instant = !animateRef.current || revealRef.current <= 0;
      setDispContent(prev => {
        const remaining = target.length - prev.length;
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
    const now = performance.now();
    const dt = Math.min(80, now - (followTs.current || now));
    followTs.current = now;
    if (el && stick.current && !selectingRef.current && !hasSelectionRef.current) {
      const target = el.scrollHeight - el.clientHeight;
      const diff = target - el.scrollTop;
      if (diff > 0.5) {
        programmatic.current = true;
        const k = 1 - Math.exp(-dt / 85);
        el.scrollTop = el.scrollTop + Math.max(1, diff * k);
      }
    }
    followRaf.current = requestAnimationFrame(follow);
  }

  function finalize() {
    const key = activeKey();
    const r = gen.current.get(key);
    if (!r && !streaming) return;
    stopLoops();
    const content = r ? r.content : targetContent.current;
    const reasoning = r ? r.reasoning : targetReason.current;
    const id = (r && r.assistantId) || assistantIdRef.current || ('a' + Date.now());
    const mid = r ? r.model_id : currentIdRef.current;
    gen.current.delete(key);
    setStreaming(false); setPhase('static'); setQueued(false);
    setMessages(ms => ms.some(m => m.id === id) ? ms : [...ms, { id, role: 'assistant', content, reasoning, model_id: mid }]);
    setDispContent(''); setDispReason('');
    setLiveFile(null); setLiveCall(null); liveRef.current = null;
    targetContent.current = ''; targetReason.current = ''; pendingDone.current = false; dispLen.current = 0;
    if (stick.current && !selectingRef.current && !hasSelectionRef.current) setTimeout(() => scrollBottom(false), 0);
    if (key === 'incognito') return;
    loadChats();
    if (key) refreshMessages(key);
  }

  function finalizeBackground(key) {
    gen.current.delete(key);
    if (key !== 'incognito') loadChats();
  }

  function syncView() {
    stopLoops();
    const key = activeKey();
    const r = gen.current.get(key);
    if (r && !r.done) {
      refreshSeq.current++;
      targetContent.current = r.content; targetReason.current = r.reasoning;
      assistantIdRef.current = r.assistantId; pendingDone.current = false;
      streamModelRef.current = r.model_id || currentIdRef.current;
      dispLen.current = r.content.length;
      setDispContent(r.content); setDispReason(r.reasoning);
      const live = r.live;
      if (live && live.path && (live.tool === 'create_file' || live.tool === 'str_replace')) {
        const lf = { path: live.path, content: live.content || '', tool: live.tool, oldStr: live.oldStr ?? null };
        liveRef.current = lf; setLiveFile(lf);
      } else { liveRef.current = null; setLiveFile(null); }
      setLiveCall(live && live.tool ? { ...live } : null);
      setLiveSteers(Array.isArray(r.steers) ? r.steers : []);
      setModelStatus(r.status || null);
      setPhase(r.phase === 'thinking' ? 'thinking' : 'generating');
      setStreaming(true); setQueued(r.phase === 'queued');
      startStream();
    } else {
      if (r && r.done) gen.current.delete(key);
      targetContent.current = ''; targetReason.current = ''; pendingDone.current = false; dispLen.current = 0;
      setStreaming(false); setQueued(false); setPhase('static');
      setDispContent(''); setDispReason('');
      setLiveCall(null);
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
      cacheChat(id, { messages: server });
    } catch {}
  }
  const selectBranch = useCallback(async (siblingId) => {
    if (streaming || !activeId || !siblingId) return;
    try { await api.post('/api/chats/' + activeId + '/branch', { messageId: siblingId }); await refreshMessages(activeId); setTimeout(() => scrollBottom(false), 20); } catch {}
  }, [streaming, activeId]);
  useEffect(() => {
    const id = activeIdRef.current;
    if (id && !incognito && chatCache.current.has(id)) cacheChat(id, { messages });
  }, [messages]);
  const forkChat = useCallback(async (messageId) => {
    if (streaming || !activeId) return;
    try {
      const r = await api.post('/api/chats/' + activeId + '/fork', { messageId });
      await loadChats();
      if (r?.id) { openChat(r.id); toast(t('Forked into a new chat'), { icon: 'fork' }); }
    } catch {}
  }, [streaming, activeId]);
  const togglePin = useCallback((messageId, pinned) => {
    if (!activeId) return;
    setMessages(ms => ms.map(m => m.id === messageId ? { ...m, pinned } : m));
    api.patch('/api/chats/' + activeId + '/messages/' + messageId, { pinned }).catch(() => {});
    toast(pinned ? t('Message pinned, kept in context') : t('Message unpinned'), { icon: 'pin' });
  }, [activeId]);
  const togglePinFile = useCallback(async (att) => {
    if (!activeId || !att?.url) return;
    const isPinned = chatPins.some(p => p.url === att.url);
    try {
      const r = isPinned
        ? await api.del('/api/chats/' + activeId + '/pins', { url: att.url })
        : await api.post('/api/chats/' + activeId + '/pins', { name: att.name, url: att.url, type: att.type || '' });
      setChatPins(r.pins || []);
      toast(isPinned ? t('File unpinned from chat') : t('File pinned, kept in context'), { icon: 'pin' });
    } catch {}
  }, [activeId, chatPins]);
  function jumpToMessage(id, opts) {
    setChatMenuOpen(false);
    stick.current = false;
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-mid="' + id + '"]');
      if (!el) return;
      el.scrollIntoView({ behavior: opts?.instant ? 'auto' : 'smooth', block: 'center' });
      if (opts?.flash === false) return;
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
    });
  }
  const railJump = useCallback((id) => { setKbFocus(id); jumpToMessage(id, { flash: false }); }, []);
  async function copyConversation() {
    const text = messages.filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => (m.role === 'user' ? 'You' : 'Assistant') + ':\n' + (typeof m.content === 'string' ? m.content : '')).join('\n\n');
    try { await navigator.clipboard.writeText(text); toast(t('Conversation copied'), { icon: 'copy' }); } catch {}
  }
  async function saveSavedPrompts(list) {
    setUser(u => ({ ...u, savedPrompts: list }));
    try { await api.put('/api/me/prompts', { prompts: list }); } catch {}
  }
  function savePromptFromInput(title) {
    const text = (input || '').trim();
    if (!text) return;
    const list = [...(user?.savedPrompts || []), { id: 'p' + Date.now(), title: (title || text.slice(0, 40)).trim(), text }];
    saveSavedPrompts(list);
    toast(t('Prompt saved'), { icon: 'star' });
  }
  function deleteSavedPrompt(id) { saveSavedPrompts((user?.savedPrompts || []).filter(p => p.id !== id)); }
  async function savePersonas(list) {
    setUser(u => ({ ...u, personas: list }));
    try { await api.put('/api/me/personas', { personas: list }); } catch {}
  }
  async function applyPersona(p) {
    if (!p) return;
    if (p.modelId && models.find(m => m.id === p.modelId)) setCurrentId(p.modelId);
    setChatInstructions(p.instructions || '');
    if (activeId) {
      try { await api.patch('/api/chats/' + activeId, { instructions: p.instructions || '' }); } catch {}
    }
    toast(t('Applied persona: ') + p.name, { icon: 'star' });
  }
  function commitRename() {
    const t = renameVal.trim();
    setRenaming(false);
    if (!activeId || !t) return;
    setChats(cs => cs.map(c => c.id === activeId ? { ...c, title: t } : c));
    api.patch('/api/chats/' + activeId, { title: t }).catch(() => {});
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

  const openSeq = useRef(0);
  function applyChatMeta(chat) {
    setCurrentProject(chat.projectId ? (projects.find(p => p.id === chat.projectId) || { id: chat.projectId, name: 'Project' }) : null);
    setSandbox(!!chat.sandbox);
    setWebSearch(false);
    setHasSummary(!!chat.hasSummary);
    setChatEnded(!!chat.ended);
    setChatEndedReason(chat.endedReason || '');
    setChatGenParams(chat.genParams || null);
    setChatSysOverride(chat.systemOverride || '');
    setChatInstructions(chat.instructions || '');
    setChatPins(Array.isArray(chat.pinnedFiles) ? chat.pinnedFiles : []);
  }
  function resolveLastModel(lastA) {
    if (modelsRef.current.find(mm => mm.id === lastA.model_id)) {
      setCurrentId(lastA.model_id);
      setExtended(!!lastA.extended);
      if (lastA.kwargValues && typeof lastA.kwargValues === 'object') setKwargValues(prev => ({ ...prev, ...lastA.kwargValues }));
      else if (lastA.reasoningEffort) setReasoningEffort(lastA.reasoningEffort);
      setChatRemovedModel(null);
    } else {
      setChatRemovedModel({ id: lastA.model_id, name: lastA.model_name || t('The original model') });
    }
  }
  function applyLastModel(msgs) {
    const lastA = [...msgs].reverse().find(mm => mm.role === 'assistant' && mm.model_id);
    if (!lastA) { pendingModelCheck.current = null; setChatRemovedModel(null); return; }
    if (!modelsLoadedRef.current) { pendingModelCheck.current = lastA; setChatRemovedModel(null); return; }
    pendingModelCheck.current = null;
    resolveLastModel(lastA);
  }
  async function openChat(id, push = true) {
    setMobileDrawer(false);
    if (incognito) setIncognito(false);
    setShowProjects(false);
    if (id !== activeIdRef.current) { setLiveFile(null); setLiveCall(null); liveRef.current = null; setArtifactFocus(null); setTelemetry(null); setLiveSteers([]); setLedger(null); setModelStatus(null); }
    setActiveId(id);
    const seq = ++openSeq.current;
    const cached = chatCache.current.get(id);
    if (cached) {
      setMessages(cached.messages || []);
      applyChatMeta(cached.chat || {});
      applyLastModel(cached.messages || []);
      setFiles(cached.files || []);
      setArtifactsOpen((cached.files || []).length > 0 && artifactsOpen);
    } else {
      setMessages([]);
      setFiles([]);
    }
    setCtlOpen(false);
    setCanContinue(false); setQueue([]);
    flushDraft();
    setInput(loadDraft(id));
    setChatMenuOpen(false);
    if (push) history.pushState({}, '', '/chat/' + id);
    else history.replaceState({}, '', '/chat/' + id);
    stick.current = true; setTimeout(() => scrollBottom(false), 30);
    try {
      const { chat, messages } = await api.get('/api/chats/' + id);
      if (seq !== openSeq.current || activeIdRef.current !== id) { cacheChat(id, { chat, messages }); return; }
      refreshSeq.current++;
      setMessages(prev => (cached && prev.length === messages.length)
        ? messages.map((sm, i) => { const pm = prev[i]; return { ...sm, _k: (pm && pm.role === sm.role) ? (pm._k || pm.id) : sm.id }; })
        : messages);
      applyChatMeta(chat);
      applyLastModel(messages);
      cacheChat(id, { chat, messages });
      if (!cached && user?.prefs?.chatStagger !== false && user?.prefs?.messageEntrance !== false) {
        clearTimeout(staggerTimer.current);
        setThreadStagger(true);
        staggerTimer.current = setTimeout(() => setThreadStagger(false), 700);
      }
      try { const f = await api.get('/api/chats/' + id + '/files'); if (seq !== openSeq.current || activeIdRef.current !== id) { cacheChat(id, { files: f.files || [] }); return; } setFiles(f.files || []); setArtifactsOpen((f.files || []).length > 0 && artifactsOpen); cacheChat(id, { files: f.files || [] }); }
      catch { if (seq === openSeq.current && activeIdRef.current === id && !cached) setFiles([]); }
      if (!cached) { stick.current = true; setTimeout(() => scrollBottom(false), 30); }
    } catch { if (seq === openSeq.current) { if (!cached) { setActiveId(null); setMessages([]); history.replaceState({}, '', '/'); } } }
  }
  function newChat(fromPop) {
    setMobileDrawer(false);
    if (incognito) setIncognito(false);
    setShowProjects(false);
    setCurrentProject(null);
    setActiveId(null); setMessages([]); setInput('');
    setFiles([]); setArtifactsOpen(false); setHasSummary(false); setLiveFile(null); setLiveCall(null); liveRef.current = null; setArtifactFocus(null);
    setTelemetry(null); setLiveSteers([]); setLedger(null); setModelStatus(null);
    setChatEnded(false); setChatEndedReason('');
    setChatRemovedModel(null);
    setCanContinue(false); setQueue([]);
    setChatGenParams(null); setChatSysOverride('');
    flushDraft();
    setInput(loadDraft(null));
    const restored = homeSelectionRef.current;
    const targetId = (restored && restored.modelId && models.find(m => m.id === restored.modelId)) ? restored.modelId : currentId;
    if (restored) {
      if (targetId !== currentId) setCurrentId(targetId);
      setExtended(!!restored.extended);
      setKwargValues(restored.kwargValues || {});
    }
    const m = models.find(m => m.id === targetId);
    setSandbox(m?.sandboxAllowed !== false && !!m?.sandboxAuto);
    setWebSearch(!!cfg.webSearchAvailable && m?.webSearchAllowed !== false && (!!m?.webSearchAuto || user?.prefs?.webSearchDefault === true));
    setFocusTick(t => t + 1);
    if (fromPop !== true) history.pushState({}, '', '/');
  }
  function toggleIncognito() {
    if (streaming || queued) return;
    if (incognito) {
      setIncognito(false);
      incognitoRef.current = false;
      setMessages([]); setInput(loadDraft(null));
      setFocusTick(t => t + 1);
    } else {
      flushDraft();
      setActiveId(null); setMessages([]); setInput('');
      incognitoRef.current = true;
      setFiles([]); setArtifactsOpen(false); setHasSummary(false); setLiveFile(null); setLiveCall(null); liveRef.current = null; setArtifactFocus(null);
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
    chatCache.current.delete(id);
    setChats(cs => cs.filter(c => c.id !== id));
    if (id === activeId) newChat();
  }
  const deleteMessage = useCallback(async (messageId) => {
    const id = activeIdRef.current;
    if (!id || streamingRef.current) return;
    setMessages(ms => ms.filter(m => m.id !== messageId));
    try { await api.del('/api/chats/' + id + '/messages/' + messageId); await refreshMessages(id); }
    catch { refreshMessages(id); }
  }, []);
  function toggleArchive(id) {
    const cur = chats.find(c => c.id === id);
    const next = !cur?.archived;
    setChats(cs => cs.map(c => c.id === id ? { ...c, archived: next } : c));
    api.patch('/api/chats/' + id, { archived: next }).catch(() => {});
    if (next && id === activeId) toast('Chat archived, find it under Chats → Archived.');
  }

  function toggleStar(id) {
    const cur = chats.find(c => c.id === id);
    const next = !cur?.starred;
    setChats(cs => cs.map(c => c.id === id ? { ...c, starred: next } : c));
    api.patch('/api/chats/' + id, { starred: next }).catch(() => {});
  }

  async function createFolder(name = t('New folder')) {
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

  async function send(attachments = [], overrideText, opts = {}) {
    if ((streaming || queued) && !opts.fromQueue) return;
    if (safetyChecking) return;
    if (safetyFlagged) return;
    const text = (overrideText != null ? overrideText : input).trim();
    if ((!text && attachments.length === 0) || !currentId) return;

    dismissError();
    setCanContinue(false);
    const sbAllowed = incognito ? false : (models.find(x => x.id === currentId)?.sandboxAllowed !== false);
    if (sbAllowed && sandbox && !opts.call) { setArtifactFocus(null); setArtifactsOpen(true); }
    if (compareIds.length && !opts.call) {
      compareRef.current = { chatId: null, remaining: [...compareIds], messageId: null };
      setCompareIds([]);
    }

    if (cfg.safetyCheckEnabled && text) {
      setSafetyChecking(true);
      let allowed = true;
      let reason = '';
      try {
        const r = await api.post('/api/safety-check', { text, modelId: currentId });
        allowed = r?.allowed !== false;
        reason = typeof r?.reason === 'string' ? r.reason.trim() : '';
      } catch {}
      setSafetyChecking(false);
      if (!allowed) { setSafetyReason(reason); setSafetyFlagged(true); return; }
    }

    if (incognito) {
      const history = [...messages
        .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: text }];
      if (!wsSend({ type: 'incognito', modelId: currentId, extended, reasoningEffort, kwargValues, messages: history })) return;
      gen.current.set('incognito', { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: currentId, live: null });
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
      if ((chatGenParams && Object.keys(chatGenParams).length) || (chatSysOverride && chatSysOverride.trim())) {
        try { await api.patch('/api/chats/' + chatId, { genParams: chatGenParams || {}, systemOverride: chatSysOverride || '' }); } catch {}
      }
    }
    if (compareRef.current && !compareRef.current.chatId) compareRef.current.chatId = chatId;
    clearDraft(activeId);
    if (!wsSend({ type: 'chat', chatId, modelId: currentId, extended, reasoningEffort, kwargValues, content: text, attachments, sandbox, webSearch, call: !!opts.call, styleId })) return;
    gen.current.set(chatId, { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: currentId, live: null });
    setMessages(ms => [...ms, { id: 'u' + Date.now(), role: 'user', content: text, attachments, _enter: true }]);
    if (!opts.call) setInput('');
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
    setFiles([]); setArtifactsOpen(false); setHasSummary(false); setLiveFile(null); setLiveCall(null); liveRef.current = null; setArtifactFocus(null);
    history.pushState({}, '', '/chat/' + c.id);
    if (!wsSend({ type: 'chat', chatId: c.id, modelId: currentId, extended, reasoningEffort, kwargValues, content: text, attachments, sandbox, webSearch, styleId })) return;
    gen.current.set(c.id, { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: currentId, live: null });
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
    setMobileDrawer(false);
    setProjectOpenId(id);
    setShowProjects(true);
    history.pushState({}, '', id ? '/project/' + id : '/projects');
  }

  const regenerate = useCallback((messageId) => {
    if (streaming || !activeId || !currentId) return;
    dismissError();
    if (!wsSend({ type: 'regenerate', chatId: activeId, modelId: currentId, extended, reasoningEffort, kwargValues, messageId, sandbox, webSearch, styleId })) return;
    gen.current.set(activeId, { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: currentId, live: null });
    setMessages(ms => { const idx = ms.findIndex(m => m.id === messageId); return idx === -1 ? ms : ms.slice(0, idx); });
    stick.current = true; setTimeout(() => scrollBottom(true), 20);
  }, [streaming, activeId, currentId, extended, reasoningEffort, kwargValues, sandbox, webSearch]);

  useEffect(() => {
    msgActions.current.regenerate = regenerate;
    msgActions.current.fork = forkChat;
  }, [regenerate, forkChat]);

  const regenerateWith = useCallback((messageId, modelId) => {
    if (streaming || !activeId || !modelId) return;
    dismissError();
    setChatRemovedModel(null);
    setCurrentId(modelId);
    if (!wsSend({ type: 'regenerate', chatId: activeId, modelId, extended, reasoningEffort, kwargValues, messageId, sandbox, webSearch, styleId })) return;
    gen.current.set(activeId, { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: modelId, live: null });
    setMessages(ms => { const idx = ms.findIndex(m => m.id === messageId); return idx === -1 ? ms : ms.slice(0, idx); });
    stick.current = true; setTimeout(() => scrollBottom(true), 20);
    const mm = models.find(m => m.id === modelId);
    if (mm) toast(t('Retrying with ') + mm.displayName, { icon: 'check' });
  }, [streaming, activeId, extended, reasoningEffort, kwargValues, sandbox, webSearch, models]);

  const editMessage = useCallback((messageId, newContent) => {
    if (streaming || !activeId || !currentId) return;
    setMessages(ms => { const idx = ms.findIndex(m => m.id === messageId); if (idx === -1) return ms; const copy = ms.slice(0, idx + 1); copy[idx] = { ...copy[idx], content: newContent }; return copy; });
    stick.current = true; setTimeout(() => scrollBottom(true), 20);
    if (!wsSend({ type: 'edit', chatId: activeId, modelId: currentId, extended, reasoningEffort, kwargValues, messageId, content: newContent, sandbox, webSearch, styleId })) return;
    gen.current.set(activeId, { content: '', reasoning: '', phase: 'queued', done: false, assistantId: null, model_id: currentId, live: null });
  }, [streaming, activeId, currentId, extended, reasoningEffort, kwargValues, sandbox, webSearch]);

  function stop() { const key = activeKey(); try { ws.current?.readyState === 1 && ws.current.send(JSON.stringify({ type: 'stop', chatId: key })); } catch {} pendingDone.current = true; setQueued(false); }
  async function logout() { await api.post('/api/auth/logout'); location.href = '/'; }
  function updatePref(key, value) {
    const prefs = { ...(user?.prefs || {}), [key]: value };
    setUser(u => ({ ...u, prefs }));
    api.patch('/api/me', { prefs }).catch(() => {});
  }

  if (user === undefined) return <div style={{ height: '100%', background: 'var(--bg)' }} />;
  if (!user) return <Login onLogin={(u) => { setUser(u); setIntro(true); }} />;

  const model = modelById.get(currentId);
  const activeChat = activeId ? chats.find(c => c.id === activeId) : null;
  const sandboxAllowed = incognito ? false : (model ? model.sandboxAllowed !== false : true);
  const sandboxOn = sandboxAllowed && sandbox;
  const webSearchAvailable = !incognito && !!cfg.webSearchAvailable && (model ? model.webSearchAllowed !== false : true);
  const webSearchOn = webSearchAvailable && webSearch;
  const empty = !activeId && messages.length === 0;
  const bgInChat = user?.prefs?.modelBgInChat !== false;
  const modelHasBg = !incognito && !!(model?.bgEnabled && model?.bgImage);
  const activeBg = computeActiveBg(models, currentId, activeId, messages.length, incognito, user?.prefs);
  sendRef.current = send;
  genOptsRef.current = { extended, reasoningEffort, kwargValues, sandbox, webSearch, styleId };
  const composerProps = {
    value: input, onChange: (v) => { if (safetyFlagged) { setSafetyFlagged(false); setSafetyReason(''); } setInput(v); saveDraft(activeId, v); }, onSend: send, onStop: stop, streaming: streaming || queued,
    queueCount: queuedList.length,
    onQueue: (t, atts) => setQueue(l => [...l, { id: 'q' + Date.now() + Math.random().toString(36).slice(2, 7), text: t, attachments: atts || [] }]),
    onSteer: steer, canSteer: streaming && !!activeId && !incognito && user?.prefs?.steering === true,
    canContinue, onContinue: () => { setCanContinue(false); send([], 'Continue exactly where your previous reply stopped, without repeating any content.'); },
    compareIds, onSetCompare: setCompareIds,
    safetyFlagged, safetyChecking, safetyReason, safetyVerbose: !!cfg.safetyCheckVerbose,
    styles: user?.styles || [], styleId, onSelectStyle: setStyleId, onSaveStyles: saveStyles,
    conversationEnded: chatEnded, endedReason: chatEndedReason,
    removedModel: activeId ? chatRemovedModel : null,
    onOpenDocs: () => setShowDocs(true),
    hideModelPicker: cfg.uiPreset === 'openai',
    models, currentId, onSelect: pickModel, extended, onToggleExtended: () => setExtended(e => !e),
    reasoningEffort, onSetEffort: setReasoningEffort, kwargValues, onSetKwarg: setKwarg,
    visionSupported: !!model?.hasVision, canUseUnavailable: !!user?.isAdmin, budget,
    modelHasBg, bgInChat, onToggleBgInChat: () => updatePref('modelBgInChat', !bgInChat),
    sandbox: sandboxOn, sandboxAllowed, onToggleSandbox: () => { if (sandboxAllowed) setSandbox(s => !s); },
    webSearch: webSearchOn, webSearchAvailable, onToggleWebSearch: () => { if (webSearchAvailable) setWebSearch(s => !s); },
    project: currentProject, onClearProject: clearChatProject,
    savedPrompts: user?.savedPrompts || [], onUsePrompt: (t) => { setInput(t); setFocusTick(x => x + 1); }, onSavePrompt: savePromptFromInput, onDeletePrompt: deleteSavedPrompt,
    onNewChat: () => newChat(), onShortcuts: () => setShowShortcuts(true),
    voiceMic: !!cfg.voiceMic, voiceCall: !!cfg.voiceCall && !incognito, sttEngine: cfg.voiceStt || 'browser',
    onStartCall: () => { setArtifactsOpen(false); setCallOpen(true); }
  };
  const showArtifactsBtn = sandboxOn || files.length > 0;

  const commands = [
    { id: 'new', label: t('New chat'), shortcut: 'Ctrl Shift O', keywords: 'create start', action: () => newChat() },
    { id: 'sidebar', label: collapsed ? t('Show sidebar') : t('Hide sidebar'), shortcut: 'Ctrl Shift S', keywords: 'toggle collapse panel', action: () => setCollapsed(c => !c) },
    { id: 'ledger', label: ledgerOpen ? t('Hide context ledger') : t('Show context ledger'), keywords: 'context tokens ledger budget window', action: () => setLedgerOpen(o => !o) },
    { id: 'chats', label: t('Browse all chats'), keywords: 'overview history search', action: () => setChatsOverview(true) },
    { id: 'search', label: t('Search chats'), shortcut: 'Ctrl Shift F', keywords: 'find message text', action: () => setShowSearch(true) },
    { id: 'shortcuts', label: t('Keyboard shortcuts'), shortcut: '?', keywords: 'keys help hotkeys', action: () => setShowShortcuts(true) },
    { id: 'spaces', label: t('Open Spaces'), keywords: 'group chat invite users', action: () => { history.pushState({}, '', '/spaces'); setShowSpaces(true); } },
    { id: 'projects', label: t('Open Projects'), keywords: 'project workspace organize', action: () => openProjects(null) },
    { id: 'incognito', label: incognito ? t('Exit incognito') : t('Start incognito chat'), keywords: 'private ghost', action: () => toggleIncognito() },
    { id: 'modeldocs', label: t('Model docs'), keywords: 'models compare docs catalog capabilities', action: () => setShowDocs(true) },
    { id: 'settings', label: t('Open settings'), keywords: 'preferences account theme', action: () => setShowSettings(true) },
    ...(user?.isAdmin ? [{ id: 'admin', label: t('Open admin panel'), keywords: 'models users connection providers', action: () => { history.pushState({}, '', '/admin'); setShowAdmin(true); } }] : []),
    ...(user?.isAdmin ? [{ id: 'playground', label: t('Open playground'), keywords: 'test model tune sampling kwargs prompt', action: () => { history.pushState({}, '', '/playground'); setShowPlayground(true); } }] : []),
    { id: 'changelog', label: t('View changelog'), keywords: 'updates version', action: () => setShowChangelog(true) },
    { id: 'credits', label: t('View credits'), keywords: 'about', action: () => setShowCredits(true) },
    { id: 'license', label: t('View licensing'), keywords: 'legal', action: () => setShowLicense(true) },
    { id: 'logout', label: t('Log out'), keywords: 'sign out exit', action: () => logout() }
  ];

  sidebarFns.current = { createFolder, renameFolder, toggleFolder, deleteFolder, moveChatToFolder, newChat, openChat, deleteChat, toggleStar, logout, openProjects };

  return (
    <div className={'app' + (incognito ? ' app-incognito' : '') + (intro ? ' intro' : '') + (bgVisible ? ' has-bg' : '') + (collapsed ? ' sb-collapsed' : '')}>
      <a className="skip-link" href="#oq-composer">{t('Skip to message input')}</a>
      <AppBackground bg={activeBg} />
      {intro && <div className="intro-curtain" />}
      <Sidebar user={user} chats={chats} chatsLoaded={chatsLoaded} activeId={activeId} appName={cfg.appName} onSearch={onSearchCb}
        folders={folders} onCreateFolder={sbCreateFolder} onRenameFolder={sbRenameFolder} onToggleFolder={sbToggleFolder} onDeleteFolder={sbDeleteFolder} onMoveChat={sbMoveChat}
        onNew={sbNewChat} onOpen={sbOpenChat} onDelete={sbDeleteChat} onToggleStar={sbToggleStar}
        collapsed={collapsed} onToggle={onToggleSidebarCb}
        mobileOpen={mobileDrawer} onMobileClose={onMobileCloseCb}
        onSettings={onSettingsCb} onAdmin={onAdminCb} onPlayground={onPlaygroundCb}
        onCredits={onCreditsCb} onChangelog={onChangelogCb} onLicense={onLicenseCb} onLogout={sbLogout} version={cfg.version}
        onChatsOverview={onChatsOverviewCb}
        onSpaces={onSpacesCb} spacesPending={spacesPending}
        projects={projects} onProjects={sbProjects} onOpenProject={sbOpenProject} />

      {mobileDrawer && <div className="drawer-backdrop" onClick={() => setMobileDrawer(false)} />}

      <div className={'main' + (incognito ? ' incognito' : '')} data-incognito={incognito ? 'on' : undefined}>
        <Toaster />
        {incognito && (
          <div className="incognito-bar">
            <div className="incognito-title"><Ghost style={{ width: 18 }} /> Incognito chat</div>
            <button className="incognito-close" onClick={toggleIncognito} title={t("Exit incognito")} disabled={streaming || queued}>✕</button>
          </div>
        )}
        {empty && (
          <button className="mobile-menu-btn empty-menu" onClick={() => setMobileDrawer(true)} title="Menu"><Menu style={{ width: 20 }} /></button>
        )}
        {!incognito && empty && (
          <button className={'incognito-fab' + (user?.isAdmin ? ' with-ctl' : '')} onClick={toggleIncognito} title="Incognito chat, not saved" disabled={streaming || queued}>
            <Ghost style={{ width: 18 }} />
          </button>
        )}
        {empty && !incognito && user?.isAdmin && (
          <button className={'incognito-fab ctl-fab' + (ctlOpen ? ' active' : '')} onClick={() => { setArtifactsOpen(false); setCtlOpen(o => !o); }} title="Chat controls (admin)" disabled={streaming || queued}>
            <Sliders style={{ width: 17 }} />
          </button>
        )}
        {empty && !incognito && cfg.uiPreset === 'openai' && (
          <div className="home-topbar">
            <div className="topbar-model tbm-flex">
              <ModelDropdown models={models} currentId={currentId} onSelect={pickModel} extended={extended} onToggleExtended={() => setExtended(e => !e)} reasoningEffort={reasoningEffort} onSetEffort={setReasoningEffort} kwargValues={kwargValues} onSetKwarg={setKwarg} canUseUnavailable={!!user?.isAdmin} isAdmin={!!user?.isAdmin} up={false} />
              <button type="button" className="mdocs-btn" title={t('Model docs')} onClick={() => setShowDocs(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5.6C10.6 4.4 8.7 3.8 6.5 3.8c-1 0-2 .13-2.9.4v14.6c.9-.27 1.9-.4 2.9-.4 2.2 0 4.1.6 5.5 1.8 1.4-1.2 3.3-1.8 5.5-1.8 1 0 2 .13 2.9.4V4.2c-.9-.27-1.9-.4-2.9-.4-2.2 0-4.1.6-5.5 1.8zM12 5.6v14.6" /></svg></button>
            </div>
          </div>
        )}
        {empty ? (
          <div className="center-wrap">
            <div className="greeting">
              {incognito
                ? (cfg.uiPreset === 'openai'
                    ? <span className="incog-title">{t("Temporary Chat")}</span>
                    : <><Ghost style={{ width: 44 }} /> {t(incognitoGreeting)}</>)
                : (() => {
                    const h = new Date().getHours();
                    const part = h < 5 ? t('Working late') : h < 12 ? t('Good morning') : h < 17 ? t('Good afternoon') : h < 22 ? t('Good evening') : t('Burning the midnight oil');
                    const nm = (user?.displayName || '').split(' ')[0];
                    const line = nm ? part + ', ' + nm : part;
                    return model?.staticIcon
                      ? <><img src={model.staticIcon} alt="" style={{ width: 44, height: 44, objectFit: 'contain' }} /> {line}</>
                      : line;
                  })()}
            </div>
            <div className="composer-wrap">
              <Composer {...composerProps} autoFocus modelUp focusKey={focusTick} />
            </div>
            <div className="qp-slot">
              {incognito ? (
                <div className={cfg.uiPreset === 'openai' ? 'incog-note' : 'incognito-note'}>{cfg.uiPreset === 'openai' ? "This chat won't appear in history. Incognito chats aren't saved." : "Incognito chats aren't saved to your history."}</div>
              ) : cfg.quickPrompts && cfg.quickPrompts.length > 0 && (
                <QuickPrompts prompts={cfg.quickPrompts} visible={!input.trim()} disabled={streaming} onPick={(p) => send([], p)} />
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="topbar">
              {cfg.uiPreset === 'openai' && (
                <div className="topbar-model tbm-flex">
                  <ModelDropdown models={models} currentId={currentId} onSelect={pickModel} extended={extended} onToggleExtended={() => setExtended(e => !e)} reasoningEffort={reasoningEffort} onSetEffort={setReasoningEffort} kwargValues={kwargValues} onSetKwarg={setKwarg} canUseUnavailable={!!user?.isAdmin} isAdmin={!!user?.isAdmin} up={false} />
              <button type="button" className="mdocs-btn" title={t('Model docs')} onClick={() => setShowDocs(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5.6C10.6 4.4 8.7 3.8 6.5 3.8c-1 0-2 .13-2.9.4v14.6c.9-.27 1.9-.4 2.9-.4 2.2 0 4.1.6 5.5 1.8 1.4-1.2 3.3-1.8 5.5-1.8 1 0 2 .13 2.9.4V4.2c-.9-.27-1.9-.4-2.9-.4-2.2 0-4.1.6-5.5 1.8zM12 5.6v14.6" /></svg></button>
                </div>
              )}
              <button className="mobile-menu-btn" onClick={() => setMobileDrawer(true)} title="Menu"><Menu style={{ width: 20 }} /></button>
              {renaming ? (
                <input className="chat-rename" autoFocus value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }} />
              ) : (
                <div className="chat-name-wrap">
                  <button className="chat-name" onClick={() => setChatMenuOpen(o => !o)}>
                    <span className="ct-title">{activeChat?.title || 'New chat'}</span> <ChevDown style={{ width: 15 }} />
                  </button>
                  {(chatInstructions || '').trim() && <span className="chat-instr-dot" title="This chat has custom instructions" />}
                  {chatMenuOpen && activeId && (
                    <ChatMenu
                      chat={{ id: activeId, title: activeChat?.title || 'New chat', instructions: chatInstructions, starred: !!activeChat?.starred, archived: !!activeChat?.archived }}
                      modelId={currentId}
                      pinned={messages.filter(m => m.pinned)}
                      pins={chatPins}
                      onUnpinFile={(url) => togglePinFile({ url })}
                      onOpenPersonas={() => { setChatMenuOpen(false); setPersonasOpen(true); }}
                      onJump={jumpToMessage}
                      onCopyConversation={copyConversation}
                      onClose={() => setChatMenuOpen(false)}
                      onRename={() => { setRenameVal(activeChat?.title || ''); setRenaming(true); }}
                      onFork={() => forkChat()}
                      onToggleStar={() => toggleStar(activeId)}
                      onToggleArchive={() => toggleArchive(activeId)}
                      onInstructionsSaved={(v) => setChatInstructions(v)} />
                  )}
                </div>
              )}
              <div className="topbar-actions">
                {!incognito && (
                  <button className="paper-btn" onClick={toggleIncognito} title="Incognito chat, not saved" disabled={streaming || queued}>
                    <Ghost style={{ width: 18 }} />
                  </button>
                )}
                {hasSummary && (
                  <button className="paper-btn" onClick={() => setSummaryOpen(true)} title="Conversation memory">
                    <Compact style={{ width: 18 }} />
                  </button>
                )}
                {user?.isAdmin && activeId && (
                  <button className={'paper-btn' + (ctlOpen ? ' active' : '')} onClick={() => { setArtifactsOpen(false); setCtlOpen(o => !o); }} title="Chat controls (admin)">
                    <Sliders style={{ width: 17 }} />
                  </button>
                )}
                {messages.length > 0 && user?.prefs?.threadFind !== false && (
                  <button className={'paper-btn' + (findOpen ? ' active' : '')} onClick={() => (findOpen ? closeFind() : setFindOpen(true))} title={t('Find in conversation')} aria-label={t('Find in conversation')} aria-pressed={findOpen}>
                    <Search style={{ width: 17 }} />
                  </button>
                )}
                {activeId && messages.length > 0 && user?.prefs?.branchMap !== false && (
                  <button className={'paper-btn' + (treeOpen ? ' active' : '')} onClick={() => setTreeOpen(o => !o)} title={t('Branch map')} aria-label={t('Branch map')} aria-pressed={treeOpen}>
                    <Fork style={{ width: 17 }} />
                  </button>
                )}
                {activeId && (
                  <button className={'paper-btn' + (ledgerOpen ? ' active' : '')} onClick={() => setLedgerOpen(o => !o)} title={t('Context ledger')} aria-label={t('Context ledger')} aria-pressed={ledgerOpen}>
                    <Gauge style={{ width: 18 }} />
                  </button>
                )}
                {showArtifactsBtn && (
                  <button className={'paper-btn' + (artifactsOpen ? ' active' : '') + (liveFile ? ' writing' : '')} onClick={() => { setCallOpen(false); setArtifactsOpen(o => !o); }} title="Artifacts">
                    <Paper style={{ width: 18 }} />{files.length > 0 && <span className="paper-count">{files.length}</span>}
                  </button>
                )}
                {/* Share button, disabled for now, kept for later use
                <button className="share-btn">Share</button>
                */}
              </div>
            </div>
            {findOpen && user?.prefs?.threadFind !== false && <ThreadFind scrollRef={scrollRef} revision={findRevision} onMatches={onFindMatches} onClose={closeFind} />}
            <div className="scroll-area" id="oq-thread" ref={scrollRef} onScroll={onScroll} onWheel={onWheel} onTouchMove={onTouchMove}>
              <div className={'thread' + (threadStagger ? ' stagger' : '') + (ledgerOpen ? ' ledger-on' : '') + (messages.length > 24 ? ' virt' : '') + (findOpen ? ' finding' : '')}
                role="log" aria-label={t('Conversation')} aria-live="polite" aria-relevant="additions text" aria-busy={streaming ? 'true' : 'false'}>
                {ledgerOpen && <LedgerBar ledger={ledger} />}
                {(() => {
                  const streamKey = assistantIdRef.current || '_stream';
                  const renderList = streaming
                    ? [...messages.filter(m => m.id !== streamKey), { id: streamKey, _k: streamKey, role: 'assistant', content: dispContent, reasoning: dispReason, model_id: streamModelRef.current || currentId, _streaming: true }]
                    : messages;
                  let lastA = null;
                  for (let i = renderList.length - 1; i >= 0; i--) if (renderList[i].role === 'assistant') { lastA = renderList[i]; break; }
                  const ledgerById = new Map((ledgerOpen && ledger ? ledger.messages : []).map(m => [m.id, m]));
                  const ledgerLimit = (ledgerOpen && ledger && ledger.limit) || 0;
                  return renderList.map(msg => {
                    const li = ledgerOpen ? ledgerById.get(msg.id) : null;
                    return (
                    <Message key={msg._k || msg.id} msg={msg} model={resolveMsgModel(msg, model)} models={models} currentId={currentId} chatId={activeId} pins={chatPins} chatEnded={chatEnded}
                      ledger={ledgerOpen}
                      ledgerTokens={li ? li.tokens : 0}
                      ledgerPct={li && ledgerLimit ? Math.min(100, Math.round((li.tokens / ledgerLimit) * 1000) / 10) : 0}
                      ledgerState={li ? (li.excluded ? 'excluded' : li.summarized ? 'summarized' : 'active') : ''}
                      onToggleExclude={toggleExclude}
                      steers={msg._streaming ? liveSteers : (msg.steers || null)}
                      status={msg._streaming ? modelStatus : null}
                      streaming={!!msg._streaming} phase={msg._streaming ? ((modelById.get(currentId)?.hideThinking && phase === 'thinking') ? 'generating' : phase) : 'static'} liveCall={msg._streaming ? liveCall : null}
                      onTogglePinFile={togglePinFile} onRegenerate={regenerate} onRegenerateWith={regenerateWith} onEdit={editMessage} onDelete={streaming || queued ? null : deleteMessage} onSelectBranch={selectBranch} onFork={forkChat} onTogglePin={togglePin}
                      showIcon={msg.role === 'assistant' && (cfg.uiPreset === 'openai' || (lastA && msg.id === lastA.id))} />
                    );
                  });
                })()}
                {chatErrors[activeKey()] && (
                  <div className="chat-error" role="alert">
                    <div className="chat-error-main">
                      <span className="chat-error-title">{t('Something went wrong')}</span>
                      <span className="chat-error-text">{chatErrors[activeKey()]}</span>
                    </div>
                    <button className="chat-error-x" title={t('Dismiss')} onClick={() => dismissError()}><X style={{ width: 15 }} /></button>
                  </div>
                )}
                {queuedList.map(q => (
                  <div key={q.id} className="queue-ghost">
                    <div className="msg user ghost">
                      <div className="bubble-user"><div className="ghost-text">{q.text}</div></div>
                      <div className="ghost-row">
                        <span className="ghost-note">Queued</span>
                        <button className="ghost-remove" onClick={() => setQueue(l => l.filter(x => x.id !== q.id))}><X style={{ width: 12 }} /> Remove from queue</button>
                      </div>
                    </div>
                    <div className="msg assistant ghost">
                      <div className="ghost-placeholder"><span /><span /><span /></div>
                    </div>
                  </div>
                ))}
                {queued && !streaming && (
                  <div className="msg assistant"><div className="queue-wait"><img src="/starburst.svg" className="pulse think-dot" alt="" /> Waiting for queue…</div></div>
                )}
                {compacting && <CompactingBar />}
                <div className="thread-pad" />
              </div>
            </div>
            {user?.prefs?.threadRail !== false && <ThreadRail items={railList} scrollRef={scrollRef} matches={findMatches} onJump={railJump} />}
            {showJump && <button className="to-bottom" onClick={jumpDown} title={t('Jump to latest')} aria-label={t('Jump to latest')}><Down style={{ width: 17 }} /></button>}
            <div className={'composer-wrap active-composer' + (cfg.uiPreset === 'openai' ? ' floating' : '')} style={{ maxWidth: cfg.uiPreset === 'openai' ? 808 : 760, margin: '0 auto', width: '100%', padding: '0 20px' }}>
              {user?.prefs?.engineStrip !== false && <EngineStrip telemetry={telemetry} streaming={streaming} />}
              <Composer {...composerProps} focusKey={focusTick} />
              <div className="disclaimer">{t(cfg.disclaimer)}</div>
            </div>
          </>
        )}
      </div>

      {artifactsOpen && activeId && !callOpen && (
        <ArtifactsPanel chatId={activeId} files={files} live={liveFile} focus={artifactFocus} onClose={closeArtifacts} />
      )}
      {ctlOpen && user?.isAdmin && !incognito && (
        <ChatControls chatId={activeId || null} initialParams={chatGenParams} initialOverride={chatSysOverride} onChange={(p, o) => { setChatGenParams(p && Object.keys(p).length ? p : null); setChatSysOverride(o || ''); }} onClose={() => setCtlOpen(false)} />
      )}
      {callOpen && (
        <CallPanel chatId={activeId} model={model}
          voice={{ stt: cfg.voiceStt || 'browser', tts: cfg.voiceTts || 'browser', ttsVoice: cfg.voiceTtsVoice || '', ttsSpeed: cfg.voiceTtsSpeed || 1 }}
          onSendText={(t) => send([], t, { call: true })}
          onClose={() => setCallOpen(false)} />
      )}

      {summaryOpen && activeId && (
        <SummaryModal chatId={activeId} onClose={() => setSummaryOpen(false)}
          onChanged={(has) => { setHasSummary(has); }} />
      )}

      {showDocs && <React.Suspense fallback={null}><ModelDocs models={models} currentId={currentId} onClose={() => setShowDocs(false)} onTry={(id) => { pickModel(id); setShowDocs(false); }} /></React.Suspense>}
      {showSettings && <React.Suspense fallback={null}><SettingsModal user={user} cfg={cfg} onClose={() => setShowSettings(false)} onUpdated={setUser} onDeleted={() => { location.href = '/'; }} onExportChats={exportAllChats} onImportChats={importChatsFile} /></React.Suspense>}
      {user?.isAdmin && cfg.uiPresetChosen === false && !presetPicked && (
        <div className="preset-scrim">
          <div className="preset-modal">
            <h2 className="preset-title">Choose your interface</h2>
            <p className="preset-sub">Pick the look for this workspace. You can change it any time in Admin → Branding.</p>
            <div className="preset-grid">
              <button className="preset-card" onClick={() => choosePreset('anthropic')}>
                <span className="preset-swatch anthropic"><span className="ps-dot" /></span>
                <span className="preset-name">Anthropic</span>
                <span className="preset-desc">Warm serif look with the classic open-quill layout.</span>
              </button>
              <button className="preset-card" onClick={() => choosePreset('openai')}>
                <span className="preset-swatch openai"><span className="ps-dot" /></span>
                <span className="preset-name">OpenAI</span>
                <span className="preset-desc">Pitch-black ChatGPT layout with the model picker up top.</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {chatsOverview && <ChatsOverview onClose={() => setChatsOverview(false)} onOpen={(id) => { setChatsOverview(false); openChat(id); }} onChatsChanged={() => loadChats()} />}
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} onOpen={(id) => openChat(id)} />}
      {personasOpen && <PersonasModal personas={user?.personas || []} models={models} currentId={currentId} onApply={applyPersona} onSave={savePersonas} onClose={() => setPersonasOpen(false)} />}
      {showShortcuts && <ShortcutsModal prefs={user?.prefs} onClose={() => setShowShortcuts(false)} />}
      {treeOpen && activeId && user?.prefs?.branchMap !== false && <React.Suspense fallback={null}><BranchTree chatId={activeId} onSelect={selectBranch} onJump={jumpToMessage} onClose={() => setTreeOpen(false)} /></React.Suspense>}
      <Lightbox />
      {showAdmin && <React.Suspense fallback={null}><AdminPanel user={user} onClose={() => { setShowAdmin(false); if (/^\/admin(\/|$)/.test(location.pathname)) history.pushState({}, '', '/'); }} /></React.Suspense>}
      {showPlayground && <React.Suspense fallback={null}><Playground onClose={() => { setShowPlayground(false); if (/^\/playground(\/|$)/.test(location.pathname)) history.pushState({}, '', '/'); }} /></React.Suspense>}
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
