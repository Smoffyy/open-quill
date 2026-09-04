import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { api } from './api.js';
import { t, tk } from './i18n.jsx';
import { applyPrefs, prefersDark, appFontId } from './prefs.js';
import { kwargValuesArr, defaultValueOf } from './kwargs.js';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import AppBackground from './components/AppBackground.jsx';
import Composer from './components/Composer.jsx';
import QuickPrompts from './components/QuickPrompts.jsx';
import CompactingBar from './components/CompactingBar.jsx';
import EngineStrip from './components/EngineStrip.jsx';
import CtxGauge from './components/CtxGauge.jsx';
import ContextInspector from './components/ContextInspector.jsx';
import LedgerBar from './components/LedgerBar.jsx';
import ThreadSkeleton from './components/ThreadSkeleton.jsx';
import SummaryModal from './components/SummaryModal.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { computeActiveBg } from './lib/appbg.js';
import { presetOf, nextTheme } from './lib/palettes.js';
import Disclaimer from './components/Disclaimer.jsx';
import { ThemeProvider } from './lib/theme/store.jsx';
import ThemeSlot from './components/builder/ThemeSlot.jsx';
import FirstRun from './components/builder/FirstRun.jsx';
const BuildMode = React.lazy(() => import('./components/builder/BuildMode.jsx'));

import Message from './components/Message.jsx';
import TopbarActions from './components/TopbarActions.jsx';
const SettingsModal = React.lazy(() => import('./components/SettingsModal.jsx'));
const PromptLedger = React.lazy(() => import('./components/PromptLedger.jsx'));
const ModelDocs = React.lazy(() => import('./components/ModelDocs.jsx'));
const AdminPanel = React.lazy(() => import('./components/AdminPanel.jsx'));
const Playground = React.lazy(() => import('./components/Playground.jsx'));
import DocModal from './components/DocModal.jsx';
import ArtifactsPanel from './components/ArtifactsPanel.jsx';
import ChatControls from './components/ChatControls.jsx';
import ModelDropdown from './components/ModelDropdown.jsx';
import CallPanel from './components/CallPanel.jsx';
import ChatsOverview from './components/ChatsOverview.jsx';
import ArtifactsLibrary from './components/ArtifactsLibrary.jsx';
import ScheduledTasks from './components/ScheduledTasks.jsx';
import Tip from './components/Tip.jsx';
import SpacesPanel from './components/SpacesPanel.jsx';
import ProjectsPanel from './components/ProjectsPanel.jsx';
import { ChatMenu, menuAtButton } from './components/ChatMenu.jsx';
import PersonasModal from './components/PersonasModal.jsx';
import SearchModal from './components/SearchModal.jsx';
import Toaster from './components/Toaster.jsx';
import Lightbox from './components/Lightbox.jsx';
import ShortcutsModal from './components/ShortcutsModal.jsx';
import ThreadRail from './components/ThreadRail.jsx';
import ThreadFind from './components/ThreadFind.jsx';
import Outline from './components/Outline.jsx';
import { buildOutline } from './lib/outline.js';
import { railItems } from './lib/threadmeta.js';
import { useDrafts } from './lib/drafts.js';
import { statusDelayEnabled } from './lib/status.js';
import { resolveReveal, revealSpeedMs } from './lib/reveal.js';
import { comboKeys, comboLabel, resolveKeybinds } from './lib/keybinds.js';
import { useKeybinds, isTypingTarget } from './lib/keyboard.js';
import { useThreadScroll } from './lib/threadscroll.js';
import { useGenMirror } from './lib/genmirror.js';
import { useLiveTools, EMPTY_CALLS } from './lib/livetools.js';
import { dispatchWs } from './lib/wsmessages.js';
import { createLru } from './lib/lru.js';
import { useTurnMeta, liveLedgerTokens } from './lib/turnmeta.js';
import { useTurnStream } from './lib/turnstream.js';
import { parseRoute, shouldResetPath, pathForChat, pathForProject } from './lib/route.js';
import { useSocket } from './lib/socket.js';
const BranchTree = React.lazy(() => import('./components/BranchTree.jsx'));
import { toast } from './toast.js';
import { copyText } from './clipboard.js';
import { Down, ChevDown, Paper, Compact, Ghost, Search, Menu, Sliders, X, Gauge, Fork, Panel, Copy, Check, Star, Telescope, TextIcon, Expand } from './components/icons.jsx';
import { BRAND_ICON } from './lib/brand.js';

const SKELETON_DELAY = 100;
const HEAVY_THREAD_CHARS = 40000;
const DEFAULT_CFG = { appName: 'open-quill', disclaimer: tk('Assistants can make mistakes, double-check responses.'), greetings: [tk('How can I help you?')], appIcon: '', quickPrompts: [], version: '' };

export default function App() {
  const [user, setUser] = useState(undefined);
  const userRef = useRef(undefined);
  useEffect(() => { userRef.current = user; }, [user]);
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
  const sbNewChat = useCallback((...a) => { setLibPage(null); setChatsOverview(false); setShowSpaces(false); sidebarFns.current.newChat(...a); }, []);
  const sbOpenChat = useCallback((...a) => { setLibPage(null); setChatsOverview(false); setShowSpaces(false); sidebarFns.current.openChat(...a); }, []);
  const sbDeleteChat = useCallback((...a) => sidebarFns.current.deleteChat(...a), []);
  const sbToggleStar = useCallback((...a) => sidebarFns.current.toggleStar(...a), []);
  const sbLogout = useCallback((...a) => sidebarFns.current.logout(...a), []);
  const sbMoveToProject = useCallback((...a) => sidebarFns.current.moveChatToProject(...a), []);
  const navTo = useCallback((to) => {
    setMobileDrawer(false);
    setChatsOverview(to === 'chats');
    setShowSpaces(to === 'spaces');
    if (to !== 'projects') { setShowProjects(false); setProjectOpenId(null); }
    setLibPage(to === 'artifacts' || to === 'scheduled' ? to : null);
    if (to === 'spaces') history.pushState({}, '', '/spaces');
    else if (to !== 'projects' && (shouldResetPath('spaces', location.pathname) || shouldResetPath('projects', location.pathname))) history.pushState({}, '', '/');
  }, []);
  const sbProjects = useCallback(() => { navTo('projects'); sidebarFns.current.openProjects(null); }, [navTo]);
  const sbOpenProject = useCallback((id) => { navTo('projects'); sidebarFns.current.openProjects(id); }, [navTo]);
  const sbNewProject = useCallback(() => { navTo('projects'); sidebarFns.current.newProject(); }, [navTo]);
  const onSearchCb = useCallback(() => setCmdkOpen(true), []);
  const onToggleSidebarCb = useCallback(() => setCollapsed(c => !c), []);
  const onMobileCloseCb = useCallback(() => setMobileDrawer(false), []);
  const onSettingsCb = useCallback(() => { setMobileDrawer(false); setSettingsTab('general'); setShowSettings(true); }, []);
  const onSkillsCb = useCallback(() => { setMobileDrawer(false); setSettingsTab('skills'); setShowSettings(true); }, []);
  const onVersionCb = useCallback(() => { setMobileDrawer(false); setSettingsTab('version'); setShowSettings(true); }, []);
  const onDocsCb = useCallback(() => { setMobileDrawer(false); setShowDocs(true); }, []);
  const onAdminCb = useCallback(() => { setMobileDrawer(false); history.pushState({}, '', '/admin'); setShowAdmin(true); }, []);
  const onPlaygroundCb = useCallback(() => { setMobileDrawer(false); history.pushState({}, '', '/playground'); setShowPlayground(true); }, []);
  const onCreditsCb = useCallback(() => { setMobileDrawer(false); setShowCredits(true); }, []);
  const onChangelogCb = useCallback(() => { setMobileDrawer(false); setShowChangelog(true); }, []);
  const onLicenseCb = useCallback(() => { setMobileDrawer(false); setShowLicense(true); }, []);
  const onChatsOverviewCb = useCallback(() => navTo('chats'), [navTo]);
  const onSpacesCb = useCallback(() => navTo('spaces'), [navTo]);
  const onArtifactsCb = useCallback(() => navTo('artifacts'), [navTo]);
  const onScheduledCb = useCallback(() => navTo('scheduled'), [navTo]);
  const closeArtifacts = useCallback(() => setArtifactsOpen(false), []);

  const [extended, setExtended] = useState(false);
  const [kwargValues, setKwargValues] = useState({});
  const reasoningEffort = kwargValues.effort || '';
  const setKwarg = useCallback((id, value) => setKwargValues(prev => ({ ...prev, [id]: value })), []);
  const setReasoningEffort = useCallback((value) => setKwargValues(prev => ({ ...prev, effort: typeof value === 'function' ? value(prev.effort || '') : value })), []);
  const [bgVisible, setBgVisible] = useState(false);
  const [chats, setChats] = useState([]);
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
  const chatCache = useRef(null);
  if (!chatCache.current) chatCache.current = createLru(25);
  const cacheChat = (id, entry) => chatCache.current.merge(id, entry);
  const sendRef = useRef(null);
  const genOptsRef = useRef({});
  const [canContinue, setCanContinue] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const compareRef = useRef(null);
  const styleId = user?.prefs?.styleId || 'normal';
  const setStyleId = (id) => updatePref('styleId', id);
  const saveStyles = async (list) => {
    const { styles } = await api.put('/api/me/styles', { styles: list });
    setUser(u => ({ ...u, styles }));
  };
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general');
  const kbHandlers = useRef({});
  const [chordHint, setChordHint] = useState(null);
  const turnMeta = useTurnMeta();
  // The routing decision belongs to the chat, not to the turn, so it survives a
  // new turn starting and is dropped when the chat changes.
  useEffect(() => { turnMeta.setRoute(null); }, [activeId, turnMeta.setRoute]);
  const [ledgerPrompt, setLedgerPrompt] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [skills, setSkills] = useState([]);
  const loadSkills = useCallback(() => api.get('/api/skills').then(r => setSkills(r.skills || [])).catch(() => {}), []);
  const toggleSkill = useCallback(async (sk) => {
    if (!sk.editable) { toast(t('Workspace skills are managed in the admin panel.')); return; }
    try { await api.patch('/api/skills/' + sk.id, { enabled: !sk.enabled }); loadSkills(); }
    catch { toast(t('Could not update the skill.')); }
  }, [loadSkills]);
  const onSettingsClosed = useCallback(() => { setShowSettings(false); loadSkills(); }, [loadSkills]);
  useEffect(() => { loadSkills(); }, [loadSkills]);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPlayground, setShowPlayground] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showLicense, setShowLicense] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [authCtx, setAuthCtx] = useState(null);
  const [budget, setBudget] = useState(null);
  const [greeting, setGreeting] = useState(DEFAULT_CFG.greetings[0]);
  const [sandbox, setSandbox] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [files, setFiles] = useState([]);
  const [pendingFiles, setPendingFiles] = useState({});
  const liveTools = useLiveTools();
  const { file: liveFile, call: liveCall, calls: liveCalls, clear: clearLive } = liveTools;
  const [stopping, setStopping] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [hasSummary, setHasSummary] = useState(false);
  const [titleMenu, setTitleMenu] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [chatPins, setChatPins] = useState([]);
  const [personasOpen, setPersonasOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [inspectOpen, setInspectOpen] = useState(false);
  const titleChevRef = useRef(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const artifactsOpenRef = useRef(false);
  useEffect(() => { artifactsOpenRef.current = artifactsOpen; }, [artifactsOpen]);
  const [callOpen, setCallOpen] = useState(false);
  const [artifactFocus, setArtifactFocus] = useState(null);
  const [incognito, setIncognito] = useState(false);
  const [incognitoGreeting, setIncognitoGreeting] = useState(tk('Greetings, whoever you are'));
  const [chatsOverview, setChatsOverview] = useState(false);
  const [libPage, setLibPage] = useState(null);
  const runTask = useCallback(async (task) => {
    try {
      const r = await api.post('/api/tasks/' + task.id + '/run', {});
      setLibPage(null);
      newChat();
      setInput(r.prompt || '');
      setFocusTick(n => n + 1);
    } catch { toast(t('Could not run the task.')); }
  }, []);
  const sidebarCombo = React.useMemo(() => {
    const c = resolveKeybinds(user?.prefs).toggleSidebar;
    return c ? comboKeys(c).join('+') : '';
  }, [user?.prefs]);
  const [showSpaces, setShowSpaces] = useState(false);
  const [spacesPending, setSpacesPending] = useState(0);
  const [projects, setProjects] = useState([]);
  const [showProjects, setShowProjects] = useState(false);
  const [projectOpenId, setProjectOpenId] = useState(null);
  const [projectCreate, setProjectCreate] = useState(false);
  const [currentProject, setCurrentProject] = useState(null);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findMatches, setFindMatches] = useState(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [kbFocus, setKbFocus] = useState(null);
  const lastDarkPalette = useRef('');
  const kbFocusRef = useRef(null);
  useEffect(() => { kbFocusRef.current = kbFocus; }, [kbFocus]);
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-oq-focus', focusMode);
    if (!focusMode) return undefined;
    const esc = (e) => {
      if (e.key !== 'Escape' || isTypingTarget(document.activeElement) || document.querySelector('.overlay')) return;
      setFocusMode(false);
    };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); root.removeAttribute('data-oq-focus'); };
  }, [focusMode]);
  const onFindMatches = useCallback((ids) => setFindMatches(ids), []);
  const closeFind = useCallback(() => { setFindOpen(false); setFindMatches(null); }, []);
  const msgActions = useRef({});
  const railList = useMemo(() => railItems(messages), [messages]);
  const outline = useMemo(() => buildOutline(messages), [messages]);
  const findRevision = useMemo(() => {
    let n = 0;
    for (const m of messages) n += m.content ? m.content.length : 0;
    return messages.length + ':' + n;
  }, [messages]);
  const heavyThread = useMemo(() => {
    if (messages.length > 24) return true;
    let chars = 0;
    for (const m of messages) {
      chars += (m.content ? m.content.length : 0) + (m.reasoning ? m.reasoning.length : 0);
      if (chars > HEAVY_THREAD_CHARS) return true;
    }
    return false;
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

  const { telemetry, promptTokens: livePrompt, status: modelStatus, steers: liveSteers, route: routeInfo } = turnMeta;
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const ledgerDefaultApplied = useRef(false);
  const [ledger, setLedger] = useState(null);
  const [chatErrors, setChatErrors] = useState({});
  const [errorCopied, setErrorCopied] = useState(false);

  const handleWsRef = useRef(null);
  const onWsMessage = useCallback((m) => handleWsRef.current?.(m), []);
  const shouldReconnect = useCallback(() => !!userRef.current, []);
  const socket = useSocket({ onMessage: onWsMessage, shouldReconnect });
  const { connect, send: socketSend } = socket;
  const getCurrentModelId = useCallback(() => currentIdRef.current, []);
  const { busyChats, syncBusy, peek, queueRec, dropRec, recFor, resumeRec } = useGenMirror(getCurrentModelId);
  const nextTurnPending = useRef(false);
  const selectingRef = useRef(false);
  const hasSelectionRef = useRef(false);
  const canFollow = useCallback(() => !selectingRef.current && !hasSelectionRef.current, []);
  const {
    scrollRef, stick, showJump,
    scrollBottom, pinToBottom, onScroll, onWheel, onTouchMove, jumpDown, resetJump,
    startFollow, stopFollow
  } = useThreadScroll({ canFollow });
  const animate = resolveReveal(user?.prefs, cfg.uiPreset === 'openai' ? 'openai' : 'anthropic') === 'typewriter';
  const revealMs = revealSpeedMs(user?.prefs?.revealMs);
  // finalize is redefined every render; the hook reads it through a ref so the
  // reveal timer always calls the current one.
  const finalizeRef = useRef(null);
  const stream = useTurnStream({
    animate,
    speedMs: revealMs,
    onRevealComplete: () => finalizeRef.current?.(),
    onFollowStart: startFollow,
    onFollowStop: stopFollow
  });
  const {
    content: dispContent, reasoning: dispReason, segs: dispSegs,
    phase, streaming, queued, streamingRef, queuedRef,
    assistantId: assistantIdRef, modelId: streamModelRef
  } = stream;
  const [threadLoading, setThreadLoading] = useState(false);
  const skelTimer = useRef(null);
  const showMsgSpeed = !!user?.prefs?.msgSpeed;
  const showCtxGauge = !!user?.prefs?.ctxGauge;
  const statusDelay = statusDelayEnabled(user?.prefs?.statusDelay);
  const ledgerTokens = liveLedgerTokens({ streaming, promptTokens: livePrompt, telemetry, ledgerOpen });

  const activeIdRef = useRef(null);
  const currentIdRef = useRef(null);
  const incognitoRef = useRef(false);
  useEffect(() => { incognitoRef.current = incognito; }, [incognito]);
  const { saveDraft, loadDraft, clearDraft, flushDraft } = useDrafts(incognitoRef);
  const refreshSeq = useRef(0);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
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

  useEffect(() => () => {
    stream.stopTimer();
    clearTimeout(skelTimer.current);
  }, []);

  useEffect(() => {
    api.get('/api/me').then(({ user }) => setUser(user)).catch(() => {
      setUser(null);
      api.get('/api/auth/context').then(c => {
        setAuthCtx(c);
        const preset = c.uiPreset === 'openai' ? 'openai' : 'anthropic';
        document.documentElement.setAttribute('data-preset', preset);
        try { localStorage.setItem('oq-preset', preset); } catch {}
        document.documentElement.setAttribute('data-font', appFontId(c.appFont));
        applyPrefs(null, preset);
      }).catch(() => {});
    });
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
  useEffect(() => { if (user) { loadModels(); loadChats(); loadAppConfig(); loadBudget(); connect(); openFromUrl(); refreshSpacesPending(); loadProjects(); } }, [!!user]);
  async function loadBudget() { try { setBudget(await api.get('/api/me/budget')); } catch {} }
  async function loadProjects() { try { setProjects(await api.get('/api/projects')); } catch {} }

  useEffect(() => {
    const onPop = () => openFromUrl();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => { syncView(); }, [activeId, incognito]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [activeId, messages]);
  useEffect(() => {
    const down = (e) => { if (scrollRef.current && scrollRef.current.contains(e.target)) selectingRef.current = true; };
    const up = () => { selectingRef.current = false; };
    const selChange = () => {
      let has;
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
  useKeybinds(user, kbHandlers, setChordHint);
  useEffect(() => {
    const m = models.find(x => x.id === currentId);
    if (m && m.sandboxAllowed === false) setSandbox(false);
    if (m && m.webSearchAllowed === false) setWebSearch(false);
    else if (!activeId && !incognito && m && user?.prefs?.webSearchDefault && cfg.webSearchAvailable) setWebSearch(true);
  }, [currentId, activeId, models, incognito, cfg.webSearchAvailable, user?.prefs?.webSearchDefault]);
  function openFromUrl() {
    const r = parseRoute(location.pathname, { isAdmin: !!user?.isAdmin });
    if (r.replace) history.replaceState({}, '', r.replace);
    const onProjects = r.view === 'project' || r.view === 'projects';
    // Every view flag is written on every route change. The branches used to
    // return early, so going Back into Spaces from a project left the projects
    // panel mounted underneath it.
    setShowAdmin(r.view === 'admin');
    setShowPlayground(r.view === 'playground');
    setShowSpaces(r.view === 'spaces');
    setShowProjects(onProjects);
    if (onProjects) { setProjectOpenId(r.id ?? null); return; }
    if (r.view !== 'home' && r.view !== 'chat') return;
    if (r.view === 'chat') { openChat(r.id, false); return; }
    flushDraft();
    setActiveId(null); setMessages([]);
    if (!incognitoRef.current) setInput(loadDraft(null));
  }

  async function loadModels() {
    const m = await api.get('/api/models');
    setModels(m);
    // keep the user's current pick; on first load (login) fall back to the default model, else the first
    setCurrentId(id => id && m.find(x => x.id === id) ? id : (m.find(x => x.isDefault)?.id || m[0]?.id || null));
  }
  async function loadChats() { try { setChats(await api.get('/api/chats')); } catch {} finally { setChatsLoaded(true); } }
  async function loadAppConfig() { try { applyCfg(await api.get('/api/app-config')); } catch {} }
  const [presetPicked, setPresetPicked] = useState(false);
  // Activating a layout is what sets the base preset now, so the first-run
  // picker hands back here only to dismiss itself and re-read the config.
  const onPresetChosen = useCallback(() => {
    setPresetPicked(true);
    loadAppConfig();
  }, []);
  useEffect(() => {
    const appName = cfg.appName || 'open-quill';
    if (incognito) { document.title = t('Incognito chat - {app}', { app: appName }); return; }
    const active = activeId ? chats.find(c => c.id === activeId) : null;
    document.title = active ? `${active.title || t('Untitled chat')} - ${appName}` : `New chat - ${appName}`;
  }, [activeId, chats, cfg.appName, incognito]);
  async function refreshSpacesPending() { try { const l = await api.get('/api/spaces'); setSpacesPending(l.filter(s => s.myStatus === 'invited').length); } catch {} }
  async function exportAllChats() { window.open('/api/chats/export-all', '_blank'); }
  async function importChatsFile(file) {
    try {
      const json = JSON.parse(await file.text());
      const r = await api.post('/api/chats/import', json);
      await loadChats();
      toast(t('Imported {n} chat(s)', { n: r.imported }), { icon: 'check' });
    } catch (e) { toast(e.message || t('Could not import that file.'), { icon: 'info', kind: 'warn' }); }
  }
  function applyCfg(c) {
    setCfg(c);
    const list = c.greetings && c.greetings.length ? c.greetings : DEFAULT_CFG.greetings;
    setGreeting(list[Math.floor(Math.random() * list.length)]);
    const preset = c.uiPreset === 'openai' ? 'openai' : 'anthropic';
    document.documentElement.setAttribute('data-preset', preset);
    try { localStorage.setItem('oq-preset', preset); } catch {}
    applyPrefs(userRef.current?.prefs, preset);
    document.documentElement.setAttribute('data-font', appFontId(c.appFont));
    let link = document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = c.appIcon || BRAND_ICON;
  }

  function wsSend(obj) {
    if (socketSend(obj)) return true;
    setChatErrors(prev => ({ ...prev, [activeKey()]: t('Connection lost, reconnecting. Try again in a moment.') }));
    return false;
  }

  function activeKey() { return incognitoRef.current ? 'incognito' : activeIdRef.current; }
  function dismissError(key) {
    const k = key || activeKey();
    setChatErrors(prev => { if (!(k in prev)) return prev; const n = { ...prev }; delete n[k]; return n; });
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
    if (streamingRef.current && ledger) return;
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
    turnMeta.addSteers(body);
  }, []);

  // Every frame's effect on state lives in lib/wsmessages.js, one handler per
  // type. This builds the context they read; it is rebuilt each render so the
  // handlers always see current closures.
  const wsCtx = {
    activeKey,
    refs: { activeIdRef, currentIdRef, ledgerOpenRef, compareRef, nextTurnPending, refreshSeq },
    mirror: { recFor, peek, dropRec, syncBusy, resumeRec },
    stream,
    meta: turnMeta,
    tools: liveTools,
    set: {
      files: setFiles, pendingFiles: setPendingFiles, chats: setChats, errors: setChatErrors,
      compacting: setCompacting, hasSummary: setHasSummary,
      ended: setChatEnded, endedReason: setChatEndedReason, canContinue: setCanContinue
    },
    text: { modelError: t('The model returned an error.') },
    actions: {
      notifyContextTrimmed: (limit) => toast(
        t('Context limit reached ({limit} tokens), trimming older messages so the chat can continue', { limit: limit.toLocaleString() }),
        { icon: 'info', kind: 'warn', duration: 6000 }),
      finalize: () => finalize(),
      finalizeBackground: (key) => finalizeBackground(key),
      syncView: () => syncView(),
      loadModels: () => loadModels(),
      loadAppConfig: () => loadAppConfig(),
      loadBudget: () => loadBudget(),
      loadLedger: () => loadLedger(),
      refreshSpacesPending: () => refreshSpacesPending()
    }
  };

  function handleWs(m) { dispatchWs(m, wsCtx); }

  handleWsRef.current = handleWs;

  // Nothing may append to `messages` between the server's `done` and this
  // committing, or the streamed reply is replaced by a thread that does not
  // contain it yet. The stream hands its text over and clears itself in one go;
  // the ordering below is the part that matters and stays here.
  function finalize() {
    const key = activeKey();
    const r = peek(key);
    if (!r && !streaming) return;
    const out = stream.commit();
    const id = out.assistantId || (r && r.assistantId) || ('a' + Date.now());
    const mid = out.modelId || (r ? r.model_id : currentIdRef.current);
    if (r && r.done) dropRec(key);
    setStopping(false);
    if (out.content || out.reasoning) {
      setMessages(ms => ms.some(m => m.id === id)
        ? ms
        : [...ms, { id, role: 'assistant', content: out.content, reasoning: out.reasoning, model_id: mid }]);
    }
    clearLive();
    if (stick.current && !selectingRef.current && !hasSelectionRef.current) setTimeout(() => scrollBottom(false), 0);
    if (key !== 'incognito') { loadChats(); if (key) refreshMessages(key); }
    startNextTurn();
  }
  finalizeRef.current = finalize;

  function startNextTurn() {
    if (!nextTurnPending.current) return;
    nextTurnPending.current = false;
    const cmp = compareRef.current;
    if (cmp && cmp.chatId === activeIdRef.current) {
      const nextId = cmp.remaining.shift();
      if (nextId && cmp.messageId) {
        setTimeout(() => wsSend({ type: 'regenerate', chatId: cmp.chatId, modelId: nextId, messageId: cmp.messageId, ...genOptsRef.current }), 150);
        return;
      }
      compareRef.current = null;
      toast(t('Model comparison ready, use the version arrows or compare button on the response.'), { duration: 6000 });
    }
    const q = queuedListRef.current[0];
    if (!q) return;
    setQueue(l => l.slice(1));
    setTimeout(() => sendRef.current(q.attachments || [], q.text, { fromQueue: true }), 120);
  }

  function finalizeBackground(key) {
    dropRec(key);
    if (key !== 'incognito') loadChats();
  }

  // Point the view at whatever the chat we just switched to is doing: pick up a
  // turn still in flight, or show nothing in flight at all.
  function syncView() {
    stream.stopTimer();
    resetJump();
    const key = activeKey();
    const r = peek(key);
    if (r && !r.done) {
      refreshSeq.current++;
      stream.restore(r, currentIdRef.current);
      liveTools.restore(r.live, r.liveCalls);
      turnMeta.restore(r);
    } else {
      if (r && r.done) dropRec(key);
      stream.clear();
      // Also drops the file preview, which this branch used to leave pointing at
      // the previous chat's half-written file.
      clearLive();
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
    setTitleMenu(null);
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
  const outlineJump = useCallback((entry) => {
    const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
    const host = document.querySelector('[data-mid="' + esc(entry.mid) + '"]');
    if (!host) return;
    const heads = host.querySelectorAll('h1,h2,h3,h4,h5,h6');
    const target = heads[entry.li] || host;
    stick.current = false;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.remove('head-flash'); void target.offsetWidth; target.classList.add('head-flash');
    setTimeout(() => target.classList.remove('head-flash'), 1400);
  }, [stick]);
  async function copyConversation() {
    const text = messages.filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => (m.role === 'user' ? 'You' : t('Assistant')) + ':\n' + (typeof m.content === 'string' ? m.content : '')).join('\n\n');
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
    if (activeId) {
      try { await api.patch('/api/chats/' + activeId, { instructions: p.instructions || '' }); } catch {}
    }
    toast(t('Applied persona: {name}', { name: p.name }), { icon: 'star' });
  }
  function commitRename() {
    const t = renameVal.trim();
    setRenaming(false);
    if (!activeId || !t) return;
    setChats(cs => cs.map(c => c.id === activeId ? { ...c, title: t } : c));
    api.patch('/api/chats/' + activeId, { title: t }).catch(() => {});
  }

  function stepFocus(delta) {
    const list = messagesRef.current;
    if (!list.length) return false;
    const at = list.findIndex(m => m.id === kbFocusRef.current);
    const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, at + delta));
    const target = list[next];
    if (!target) return false;
    setKbFocus(target.id);
    jumpToMessage(target.id, { flash: false });
    return true;
  }

  // Everything a chat's view owns, cleared as one. newChat, toggleIncognito and
  // startProjectChat each used to spell this out, and they had already begun to
  // disagree about which pieces were included.
  function resetChatView() {
    setFiles([]); setPendingFiles({}); setArtifactsOpen(false); setHasSummary(false);
    clearLive(); setArtifactFocus(null);
    turnMeta.reset(); setLedger(null);
  }

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
  function armSkeleton(on, onDelay) {
    clearTimeout(skelTimer.current);
    if (!on) { setThreadLoading(false); return; }
    skelTimer.current = setTimeout(() => { if (onDelay) onDelay(); setThreadLoading(true); }, SKELETON_DELAY);
  }
  async function openChat(id, push = true) {
    setMobileDrawer(false);
    if (incognito) setIncognito(false);
    setShowProjects(false);
    if (id !== activeIdRef.current) { clearLive(); setArtifactFocus(null); turnMeta.reset(); setLedger(null); }
    setActiveId(id);
    const seq = ++openSeq.current;
    const cached = chatCache.current.get(id);
    if (cached) {
      setMessages(cached.messages || []);
      applyChatMeta(cached.chat || {});
      applyLastModel(cached.messages || []);
      setFiles(cached.files || []);
      setPendingFiles({});
      setArtifactsOpen((cached.files || []).length > 0 && artifactsOpenRef.current);
      armSkeleton(false);
    } else {
      setPendingFiles({});
      armSkeleton(true, () => {
        if (seq === openSeq.current && activeIdRef.current === id) { setMessages([]); setFiles([]); }
      });
    }
    setCtlOpen(false);
    setCanContinue(false); setQueue([]);
    flushDraft();
    setInput(loadDraft(id));
    setTitleMenu(null);
    if (push) history.pushState({}, '', pathForChat(id));
    else history.replaceState({}, '', pathForChat(id));
    if (cached) pinToBottom(false, 30);
    try {
      const { chat, messages } = await api.get('/api/chats/' + id);
      if (seq !== openSeq.current || activeIdRef.current !== id) { cacheChat(id, { chat, messages }); return; }
      armSkeleton(false);
      refreshSeq.current++;
      setMessages(prev => (cached && prev.length === messages.length)
        ? messages.map((sm, i) => { const pm = prev[i]; return { ...sm, _k: (pm && pm.role === sm.role) ? (pm._k || pm.id) : sm.id }; })
        : messages);
      applyChatMeta(chat);
      applyLastModel(messages);
      cacheChat(id, { chat, messages });
      if (!cached) pinToBottom(false, 30);
      try { const f = await api.get('/api/chats/' + id + '/files'); if (seq !== openSeq.current || activeIdRef.current !== id) { cacheChat(id, { files: f.files || [] }); return; } setFiles(f.files || []); setArtifactsOpen((f.files || []).length > 0 && artifactsOpenRef.current); cacheChat(id, { files: f.files || [] }); }
      catch { if (seq === openSeq.current && activeIdRef.current === id && !cached) setFiles([]); }
    } catch { if (seq === openSeq.current) { armSkeleton(false); if (!cached) { setActiveId(null); setMessages([]); history.replaceState({}, '', '/'); } } }
  }
  function newChat(fromPop) {
    setMobileDrawer(false);
    if (incognito) setIncognito(false);
    setShowProjects(false);
    setCurrentProject(null);
    armSkeleton(false);
    setActiveId(null); setMessages([]); setInput('');
    resetChatView();
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
      resetChatView();
      setSandbox(false);
      const gs = [tk('Greetings, whoever you are'), tk('No names, no traces'), tk('This one stays between us'), tk('Off the record')];
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
    if (!id || streamingRef.current || queuedRef.current) return;
    setMessages(ms => ms.filter(m => m.id !== messageId));
    try { await api.del('/api/chats/' + id + '/messages/' + messageId); await refreshMessages(id); }
    catch { refreshMessages(id); }
  }, []);
  function toggleStar(id) {
    const cur = chats.find(c => c.id === id);
    const next = !cur?.starred;
    setChats(cs => cs.map(c => c.id === id ? { ...c, starred: next } : c));
    api.patch('/api/chats/' + id, { starred: next }).catch(() => {});
  }

  function moveChatToProject(chatId, projectId) {
    const prev = chats.find(c => c.id === chatId)?.projectId ?? null;
    const target = projectId || null;
    if (prev === target) return;
    setChats(cs => cs.map(c => c.id === chatId ? { ...c, projectId: target } : c));
    api.patch('/api/chats/' + chatId, { projectId: target || '' })
      .then(() => loadProjects())
      .catch(() => setChats(cs => cs.map(c => c.id === chatId ? { ...c, projectId: prev } : c)));
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
      queueRec('incognito', currentId);
      setMessages(ms => [...ms, { id: 'u' + Date.now(), role: 'user', content: text, attachments: [], _enter: true }]);
      setInput('');
      pinToBottom(true, 20);
      return;
    }

    let chatId = activeId;
    if (!chatId) {
      const c = await api.post('/api/chats');
      chatId = c.id; setActiveId(chatId);
      setChats(cs => [{ id: c.id, title: 'New chat', updated_at: c.updated_at, starred: false }, ...cs]);
      history.pushState({}, '', pathForChat(chatId));
      if ((chatGenParams && Object.keys(chatGenParams).length) || (chatSysOverride && chatSysOverride.trim())) {
        try { await api.patch('/api/chats/' + chatId, { genParams: chatGenParams || {}, systemOverride: chatSysOverride || '' }); } catch {}
      }
    }
    if (compareRef.current && !compareRef.current.chatId) compareRef.current.chatId = chatId;
    clearDraft(activeId);
    if (!wsSend({ type: 'chat', chatId, modelId: currentId, extended, reasoningEffort, kwargValues, content: text, attachments, sandbox, webSearch, call: !!opts.call, styleId })) return;
    queueRec(chatId, currentId);
    setMessages(ms => [...ms, { id: 'u' + Date.now(), role: 'user', content: text, attachments, _enter: true }]);
    if (!opts.call) setInput('');
    pinToBottom(true, 20);
  }

  async function startProjectChat(project, rawText, attachments = []) {
    if (!currentId) return;
    const text = (rawText || '').trim();
    if (!text && attachments.length === 0) return;
    const c = await api.post('/api/chats', { projectId: project.id });
    setChats(cs => [{ id: c.id, title: 'New chat', updated_at: c.updated_at, starred: false, projectId: project.id }, ...cs]);
    setShowProjects(false); setProjectOpenId(null);
    setCurrentProject(project);
    setActiveId(c.id); setMessages([]); setInput('');
    resetChatView();
    history.pushState({}, '', pathForChat(c.id));
    if (!wsSend({ type: 'chat', chatId: c.id, modelId: currentId, extended, reasoningEffort, kwargValues, content: text, attachments, sandbox, webSearch, styleId })) return;
    queueRec(c.id, currentId);
    setMessages([{ id: 'u' + Date.now(), role: 'user', content: text, attachments, _enter: true }]);
    pinToBottom(true, 20);
  }
  // Opening a chat before the project list has loaded leaves a placeholder named
  // "Project"; fill in the real one once the list arrives.
  useEffect(() => {
    if (!currentProject || !projects.length) return;
    const full = projects.find(p => p.id === currentProject.id);
    if (full && full.name !== currentProject.name) setCurrentProject(full);
  }, [projects, currentProject]);

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
    history.pushState({}, '', pathForProject(id));
  }

  const regenerate = useCallback((messageId) => {
    if (streaming || !activeId || !currentId) return;
    dismissError();
    if (!wsSend({ type: 'regenerate', chatId: activeId, modelId: currentId, messageId, ...genOptsRef.current })) return;
    queueRec(activeId, currentId);
    setMessages(ms => {
      const idx = ms.findIndex(m => m.id === messageId);
      if (idx === -1) return ms;
      return ms.slice(0, ms[idx].role === 'user' ? idx + 1 : idx);
    });
    pinToBottom(true, 20);
  }, [streaming, activeId, currentId]);

  useEffect(() => {
    msgActions.current.regenerate = regenerate;
    msgActions.current.fork = forkChat;
  }, [regenerate, forkChat]);

  const regenerateWith = useCallback((messageId, modelId) => {
    if (streaming || !activeId || !modelId) return;
    dismissError();
    setChatRemovedModel(null);
    setCurrentId(modelId);
    if (!wsSend({ type: 'regenerate', chatId: activeId, modelId, messageId, ...genOptsRef.current })) return;
    queueRec(activeId, modelId);
    setMessages(ms => {
      const idx = ms.findIndex(m => m.id === messageId);
      if (idx === -1) return ms;
      return ms.slice(0, ms[idx].role === 'user' ? idx + 1 : idx);
    });
    pinToBottom(true, 20);
    const mm = models.find(m => m.id === modelId);
    if (mm) toast(t('Retrying with {model}', { model: mm.displayName }), { icon: 'check' });
  }, [streaming, activeId, models]);

  const editMessage = useCallback((messageId, newContent) => {
    if (streaming || !activeId || !currentId) return;
    setMessages(ms => { const idx = ms.findIndex(m => m.id === messageId); if (idx === -1) return ms; const copy = ms.slice(0, idx + 1); copy[idx] = { ...copy[idx], content: newContent }; return copy; });
    pinToBottom(true, 20);
    if (!wsSend({ type: 'edit', chatId: activeId, modelId: currentId, messageId, content: newContent, ...genOptsRef.current })) return;
    queueRec(activeId, currentId);
  }, [streaming, activeId, currentId]);

  // Deliberately does NOT finalize. finalize() refetches the thread, and the
  // server only writes the assistant row once it has unwound the turn — going
  // early replaced the in-progress message with a thread that does not contain
  // it yet, losing every tool result the user had just watched happen. The
  // server's `done` arrives after the write and drives finalize as usual.
  function stop() { socketSend({ type: 'stop', chatId: activeKey() }); stream.setQueued(false); setStopping(true); }
  // Message is memoized, so onContinue has to keep a stable identity — but a
  // useCallback closing over `send` freezes the first render's copy, where
  // currentId is still null and send returns immediately. sendRef is kept
  // current during render, so the click always reaches the live send.
  const continueReply = useCallback(() => {
    setCanContinue(false);
    sendRef.current([], t('Carry on from exactly where your previous reply stopped. Do not repeat or summarise what you already did, it is already saved. If work is still unfinished, make the tool calls to finish it now.'));
  }, []);
  const stopChat = useCallback((chatId) => {
    if (!chatId) return;
    if (chatId === activeKey()) { stop(); return; }
    wsSend({ type: 'stop', chatId });
  }, []);
  async function logout() { await api.post('/api/auth/logout'); location.href = '/'; }
  function updatePref(key, value) {
    const prefs = { ...(user?.prefs || {}), [key]: value };
    setUser(u => ({ ...u, prefs }));
    api.patch('/api/me', { prefs }).catch(() => {});
  }

  if (user === undefined) return <div style={{ height: '100%', background: 'var(--bg)' }} />;
  if (!user) return <Login cfg={authCtx} onLogin={(u) => setUser(u)} />;

  const model = modelById.get(currentId);
  const activeChat = activeId ? chats.find(c => c.id === activeId) : null;
  const activeProject = activeChat?.projectId ? projects.find(p => p.id === activeChat.projectId) : null;
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
  const ctxGaugeEl = (showCtxGauge && activeId && !incognito)
    ? <CtxGauge chatId={activeId} modelId={currentId} streaming={streaming || queued}
        revision={messages.length + ':' + (messages[messages.length - 1]?.id || '')} />
    : null;

  const composerProps = {
    placeholder: activeId && !incognito ? t('Write a message...') : undefined,
    projects,
    onSetProject: activeId ? (p) => moveChatToProject(activeId, p.id) : null,
    value: input, onChange: (v) => { if (safetyFlagged) { setSafetyFlagged(false); setSafetyReason(''); } setInput(v); saveDraft(activeId, v); }, onSend: send, onStop: stop, streaming: streaming || queued, stopping,
    queueCount: queuedList.length,
    onQueue: (t, atts) => setQueue(l => [...l, { id: 'q' + Date.now() + Math.random().toString(36).slice(2, 7), text: t, attachments: atts || [] }]),
    onSteer: steer, canSteer: streaming && !!activeId && !incognito && user?.prefs?.steering === true,
    compareIds, onSetCompare: setCompareIds,
    safetyFlagged, safetyChecking, safetyReason, safetyVerbose: !!cfg.safetyCheckVerbose,
    styles: user?.styles || [], styleId, onSelectStyle: setStyleId, onSaveStyles: saveStyles,
    conversationEnded: chatEnded, endedReason: chatEndedReason,
    removedModel: activeId ? chatRemovedModel : null,
    skills, onToggleSkill: toggleSkill, onManageSkills: () => onSkillsCb(),
    hideModelPicker: cfg.uiPreset === 'openai',
    chipsBelow: cfg.uiPreset === 'openai',
    models, currentId, onSelect: pickModel, extended, onToggleExtended: () => setExtended(e => !e),
    reasoningEffort, onSetEffort: setReasoningEffort, kwargValues, onSetKwarg: setKwarg,
    visionSupported: !!model?.hasVision, canUseUnavailable: !!user?.isAdmin, budget,
    modelHasBg, bgInChat, onToggleBgInChat: () => updatePref('modelBgInChat', !bgInChat),
    sandbox: sandboxOn, sandboxAllowed, onToggleSandbox: () => { if (sandboxAllowed) setSandbox(s => !s); },
    webSearch: webSearchOn, webSearchAvailable, onToggleWebSearch: () => { if (webSearchAvailable) setWebSearch(s => !s); },
    project: currentProject, onClearProject: clearChatProject, onOpenProject: openProjects,
    savedPrompts: user?.savedPrompts || [], onUsePrompt: (t) => { setInput(t); setFocusTick(x => x + 1); }, onSavePrompt: savePromptFromInput, onDeletePrompt: deleteSavedPrompt,
    onNewChat: () => newChat(), onShortcuts: () => setShowShortcuts(true),
    voiceMic: !!cfg.voiceMic, voiceCall: !!cfg.voiceCall && !incognito, sttEngine: cfg.voiceStt || 'browser',
    onStartCall: () => { setArtifactsOpen(false); setCallOpen(true); },
    ctxGauge: cfg.uiPreset === 'openai' ? null : ctxGaugeEl
  };
  const showArtifactsBtn = sandboxOn || files.length > 0;
  // Sits beside the incognito button in both the greeting and a live chat, so turning
  // sandbox tools on reveals it before the first message is sent.
  const artifactsBtn = showArtifactsBtn ? (
    <button className={'paper-btn' + (artifactsOpen ? ' active' : '') + (liveFile ? ' writing' : '')}
      onClick={() => { setCallOpen(false); setArtifactsOpen(o => !o); }}
      title={t("Artifacts")} aria-label={t("Artifacts")} aria-pressed={artifactsOpen}>
      <Paper />{files.length > 0 && <span className="paper-count">{files.length}</span>}
    </button>
  ) : null;

  function focusedMsg() {
    const list = messagesRef.current;
    if (!list.length || !kbFocusRef.current) return null;
    return list.find(m => m.id === kbFocusRef.current) || null;
  }
  function stepChat(delta) {
    if (!chats.length) return false;
    const at = chats.findIndex(c => c.id === activeId);
    const next = at < 0 ? (delta > 0 ? 0 : chats.length - 1) : at + delta;
    if (next < 0 || next >= chats.length) return false;
    openChat(chats[next].id);
    return true;
  }
  kbHandlers.current = {
    toggleSidebar: () => setCollapsed(c => !c),
    commandPalette: () => setCmdkOpen(o => !o),
    searchChats: () => setShowSearch(true),
    newChat: () => newChat(),
    shortcuts: () => setShowShortcuts(x => !x),
    openSettings: () => { setSettingsTab('general'); setShowSettings(true); },
    toggleIncognito: () => { toggleIncognito(); },
    toggleTheme: () => {
      const next = nextTheme({
        themePref: user?.prefs?.theme,
        preset: presetOf(cfg.uiPreset),
        prefersDark: prefersDark(),
        lastDark: lastDarkPalette.current
      });
      if (next.remember) lastDarkPalette.current = next.remember;
      updatePref('theme', next.theme);
    },
    focusComposer: () => { setFocusTick(x => x + 1); },
    attachFiles: () => { window.dispatchEvent(new CustomEvent('oq-attach-files')); },
    toggleWebSearch: () => { if (!webSearchAvailable) return false; setWebSearch(v => !v); },
    toggleSandbox: () => { if (!sandboxAllowed) return false; setSandbox(v => !v); },
    stopGeneration: () => { if (!streaming && !queued) return false; stop(); },
    scrollBottom: () => pinToBottom(true),
    toggleLedger: () => setLedgerOpen(o => !o),
    promptLedger: () => { if (!activeIdRef.current) return false; setLedgerPrompt(true); },
    toggleArtifacts: () => { if (!showArtifactsBtn) return false; setCallOpen(false); setArtifactsOpen(o => !o); },
    nextChat: () => stepChat(1),
    prevChat: () => stepChat(-1),
    findInChat: () => { if (!messagesRef.current.length) return false; setFindOpen(true); },
    branchMap: () => { if (!activeIdRef.current || !messagesRef.current.length) return false; setTreeOpen(true); },
    toggleOutline: () => { if (!outline.length) return false; setOutlineOpen(o => !o); },
    focusMode: () => { if (!focusMode && !(activeIdRef.current && messagesRef.current.length)) return false; setFocusMode(o => !o); },
    msgNext: () => stepFocus(1),
    msgPrev: () => stepFocus(-1),
    clearFocus: () => { if (!kbFocusRef.current) return false; setKbFocus(null); },
    msgCopy: () => {
      const m = focusedMsg();
      if (!m) return false;
      const clean = (m.content || '').replace(/\[\[OQ(?:R:[A-Za-z0-9+/=]+|T:\d+)\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
      copyText(clean).then(ok => ok && toast(t('Message copied')));
    },
    msgEdit: () => {
      const m = focusedMsg();
      if (!m || m.role !== 'user' || streamingRef.current) return false;
      window.dispatchEvent(new CustomEvent('oq-msg-edit', { detail: { id: m.id } }));
    },
    msgRetry: () => {
      const m = focusedMsg();
      if (!m || m.role !== 'assistant' || streamingRef.current) return false;
      msgActions.current.regenerate?.(m.id);
    },
    msgFork: () => {
      const m = focusedMsg();
      if (!m || streamingRef.current || !activeIdRef.current) return false;
      msgActions.current.fork?.(m.id);
    },
  };

  const kb = resolveKeybinds(user?.prefs);
  const commands = [
    { id: 'new', label: t('New chat'), shortcut: comboLabel(kb.newChat), keywords: 'create start', action: () => newChat() },
    { id: 'sidebar', label: collapsed ? t('Show sidebar') : t('Hide sidebar'), shortcut: comboLabel(kb.toggleSidebar), keywords: 'toggle collapse panel', action: () => setCollapsed(c => !c) },
    { id: 'ledger', label: ledgerOpen ? t('Hide context ledger') : t('Show context ledger'), shortcut: comboLabel(kb.toggleLedger), keywords: 'context tokens ledger budget window', action: () => setLedgerOpen(o => !o) },
    ...((activeId && messages.length > 0) || focusMode ? [{ id: 'focus', label: focusMode ? t('Exit focus mode') : t('Enter focus mode'), shortcut: comboLabel(kb.focusMode), keywords: 'reading distraction free immersive zen hide sidebar', action: () => setFocusMode(o => !o) }] : []),
    ...(outline.length ? [{ id: 'outline', label: outlineOpen ? t('Hide contents') : t('Show contents'), shortcut: comboLabel(kb.toggleOutline), keywords: 'outline headings table of contents jump sections', action: () => setOutlineOpen(o => !o) }] : []),
    { id: 'chats', label: t('Browse all chats'), keywords: 'overview history search', action: () => setChatsOverview(true) },
    { id: 'search', label: t('Search chats'), shortcut: comboLabel(kb.searchChats), keywords: 'find message text', action: () => setShowSearch(true) },
    { id: 'shortcuts', label: t('Keyboard shortcuts'), shortcut: comboLabel(kb.shortcuts), keywords: 'keys help hotkeys', action: () => setShowShortcuts(true) },
    { id: 'spaces', label: t('Open Spaces'), keywords: 'group chat invite users', action: () => { history.pushState({}, '', '/spaces'); setShowSpaces(true); } },
    { id: 'projects', label: t('Open Projects'), keywords: 'project workspace organize', action: () => openProjects(null) },
    { id: 'incognito', label: incognito ? t('Exit incognito') : t('Start incognito chat'), shortcut: comboLabel(kb.toggleIncognito), keywords: 'private ghost', action: () => toggleIncognito() },
    { id: 'modeldocs', label: t('Model docs'), keywords: 'models compare docs catalog capabilities', action: () => setShowDocs(true) },
    { id: 'settings', label: t('Open settings'), shortcut: comboLabel(kb.openSettings), keywords: 'preferences account theme', action: () => { setSettingsTab('general'); setShowSettings(true); } },
    { id: 'promptledger', label: t('What gets sent'), keywords: 'prompt inspect context debug tokens', action: () => { if (activeId) setLedgerPrompt(true); } },
    { id: 'keybinds', label: t('Customize shortcuts'), keywords: 'keybinds hotkeys keys remap', action: () => { setSettingsTab('keybinds'); setShowSettings(true); } },
    ...(user?.isAdmin ? [{ id: 'admin', label: t('Open admin panel'), keywords: 'models users connection providers', action: () => { history.pushState({}, '', '/admin'); setShowAdmin(true); } }] : []),
    ...(user?.isAdmin ? [{ id: 'build', label: t('Enter build mode'), keywords: 'theme builder design layout customise interface', action: () => { try { localStorage.setItem('oq-build-mode', '1'); } catch {} window.location.reload(); } }] : []),
    ...(user?.isAdmin ? [{ id: 'playground', label: t('Open playground'), keywords: 'test model tune sampling kwargs prompt', action: () => { history.pushState({}, '', '/playground'); setShowPlayground(true); } }] : []),
    { id: 'changelog', label: t('View changelog'), keywords: 'updates version', action: () => setShowChangelog(true) },
    { id: 'credits', label: t('View credits'), keywords: 'about', action: () => setShowCredits(true) },
    { id: 'license', label: t('View licensing'), keywords: 'legal', action: () => setShowLicense(true) },
    { id: 'logout', label: t('Log out'), keywords: 'sign out exit', action: () => logout() }
  ];

  const modelPicker = (
    <div className="topbar-model tbm-flex">
      <ModelDropdown models={models} currentId={currentId} onSelect={pickModel} extended={extended} onToggleExtended={() => setExtended(e => !e)} reasoningEffort={reasoningEffort} onSetEffort={setReasoningEffort} kwargValues={kwargValues} onSetKwarg={setKwarg} canUseUnavailable={!!user?.isAdmin} isAdmin={!!user?.isAdmin} up={false} />
      
      {ctxGaugeEl}
    </div>
  );

  sidebarFns.current = { newChat, openChat, deleteChat, toggleStar, logout, openProjects, moveChatToProject, newProject: () => { openProjects(null); setProjectCreate(true); } };

  return (
    <ThemeProvider user={user} cfg={cfg}>
    <div className={'app' + (incognito ? ' app-incognito' : '') + (bgVisible ? ' has-bg' : '') + (collapsed ? ' sb-collapsed' : '')}>
      <a className="skip-link" href="#oq-composer">{t('Skip to message input')}</a>
      <AppBackground bg={activeBg} />
      <Sidebar user={user} chats={chats} chatsLoaded={chatsLoaded} activeId={activeId} appName={cfg.appName} onSearch={onSearchCb}
        dest={showProjects ? 'projects' : showSpaces ? 'spaces' : chatsOverview ? 'chats' : libPage}
        onArtifacts={onArtifactsCb} onScheduled={onScheduledCb}
        onCustomize={onSkillsCb} onModelDocs={onDocsCb} showModelDocs={cfg.modelDocs !== false} onVersion={onVersionCb}
        onNew={sbNewChat} onOpen={sbOpenChat} onDelete={sbDeleteChat} onToggleStar={sbToggleStar}
        collapsed={collapsed} onToggle={onToggleSidebarCb}
        mobileOpen={mobileDrawer} onMobileClose={onMobileCloseCb}
        onSettings={onSettingsCb} onAdmin={onAdminCb} onPlayground={onPlaygroundCb}
        onCredits={onCreditsCb} onChangelog={onChangelogCb} onLicense={onLicenseCb} onLogout={sbLogout} version={cfg.version}
        onChatsOverview={onChatsOverviewCb}
        onSpaces={onSpacesCb} spacesPending={spacesPending}
        projects={projects} onProjects={sbProjects} onOpenProject={sbOpenProject} onNewProject={sbNewProject} onMoveToProject={sbMoveToProject}
        busyChats={busyChats} onStopChat={stopChat} />

      {collapsed && (
        <Tip label={t('Open sidebar')} keys={sidebarCombo}>
          <button className="rail-open" onClick={onToggleSidebarCb} aria-label={t('Open sidebar')}>
            <Panel style={{ width: 16 }} />
          </button>
        </Tip>
      )}
      {mobileDrawer && <div className="drawer-backdrop" onClick={() => setMobileDrawer(false)} />}

      <div className={'main' + (incognito ? ' incognito' : '')} data-incognito={incognito ? 'on' : undefined}>
        <Toaster />
        <ThemeSlot name="main.top" />
        {libPage && (
          <div className="lib-overlay" role="region" aria-label={libPage === 'artifacts' ? t('Artifacts') : t('Scheduled tasks')}>
            {libPage === 'artifacts'
              ? <ArtifactsLibrary onSearch={() => setShowSearch(true)} onNew={() => { setLibPage(null); newChat(); }}
                  onOpen={(a) => { setLibPage(null); openChat(a.chatId); }} />
              : <ScheduledTasks onSearch={() => setShowSearch(true)} onRunTask={runTask} />}
          </div>
        )}

        {incognito && (
          <div className="incognito-bar">
            <div className="incog-left">
              {empty && cfg.uiPreset === 'openai' && modelPicker}
              <div className="incognito-title"><Ghost style={{ width: 18 }} /> {t("Incognito chat")}</div>
            </div>
            <button className="incognito-close" onClick={toggleIncognito} title={t("Exit incognito")} aria-label={t("Exit incognito")} disabled={streaming || queued}><X style={{ width: 16 }} /></button>
          </div>
        )}
        {empty && (
          <button className="mobile-menu-btn empty-menu" onClick={() => setMobileDrawer(true)} title={t("Menu")}><Menu style={{ width: 20 }} /></button>
        )}
        {!incognito && empty && (
          <TopbarActions className="home-actions"
            leading={<>
              <button className="paper-btn" onClick={toggleIncognito} title={t("Incognito chat, not saved")} disabled={streaming || queued}>
                <Ghost />
              </button>
              {artifactsBtn}
            </>}
            items={[
              user?.isAdmin && { id: 'ctl', icon: <Sliders />, label: t("Chat controls (admin)"), active: ctlOpen, disabled: streaming || queued, onClick: () => { setArtifactsOpen(false); setCtlOpen(o => !o); } }
            ]} />
        )}
        {empty && !incognito && cfg.uiPreset === 'openai' && (
          <div className="home-topbar">
            {modelPicker}
          </div>
        )}
        {empty ? (
          <div className="center-wrap">
            <ThemeSlot name="home.above" />
            <div className="greeting">
              {incognito
                ? (cfg.uiPreset === 'openai'
                    ? <span className="incog-title">{t("Temporary Chat")}</span>
                    : <><Ghost style={{ width: 44 }} /> {t(incognitoGreeting)}</>)
                : (() => {
                    let line;
                    if (cfg.greetingsChosen && greeting) line = t(greeting);
                    else {
                      const h = new Date().getHours();
                      const part = h < 5 ? t('Working late') : h < 12 ? t('Good morning') : h < 17 ? t('Good afternoon') : h < 22 ? t('Good evening') : t('Burning the midnight oil');
                      const nm = (user?.displayName || '').split(' ')[0];
                      line = nm ? part + ', ' + nm : part;
                    }
                    return model?.staticIcon
                      ? <><img src={model.staticIcon} alt="" style={{ objectFit: 'contain' }} /> {line}</>
                      : line;
                  })()}
            </div>
            <ThemeSlot name="composer.above" />
            <div className="composer-wrap">
              <Composer {...composerProps} autoFocus modelUp focusKey={focusTick} />
            </div>
            <div className="qp-slot">
              {incognito ? (
                <div className={cfg.uiPreset === 'openai' ? 'incog-note' : 'incognito-note'}>{cfg.uiPreset === 'openai' ? t("This chat won't appear in history. Incognito chats aren't saved.") : t("Incognito chats aren't saved to your history.")}</div>
              ) : cfg.quickPrompts && cfg.quickPrompts.length > 0 && (
                <QuickPrompts prompts={cfg.quickPrompts} visible={!input.trim()} disabled={streaming} onPick={(p) => send([], p)} />
              )}
            </div>
            <ThemeSlot name="home.below" />
          </div>
        ) : (
          <>
            <div className="topbar">
              {cfg.uiPreset === 'openai' && modelPicker}
              <button className="mobile-menu-btn" onClick={() => setMobileDrawer(true)} title={t("Menu")}><Menu style={{ width: 20 }} /></button>
              {renaming ? (
                <input className="chat-rename" autoFocus value={renameVal}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }} />
              ) : (
                <div className="chat-name-wrap">
                  {activeProject && (
                    <>
                      <button className="ct-crumb" onClick={() => { setProjectOpenId(activeProject.id); setShowProjects(true); history.pushState({}, '', pathForProject(activeProject.id)); }}>
                        {activeProject.name}
                      </button>
                      <span className="ct-sep">/</span>
                    </>
                  )}
                  <button className="chat-name ct-name" disabled={!activeId} title={t('Rename chat')}
                    onClick={() => { setRenameVal(activeChat?.title || ''); setRenaming(true); }}>
                    <span className="ct-title">{activeChat?.title || t('New chat')}</span>
                  </button>
                  <button className="chat-name ct-caret" ref={titleChevRef} disabled={!activeId}
                    title={t('Chat options')} aria-label={t('Chat options')} aria-haspopup="menu" aria-expanded={!!titleMenu}
                    onClick={(e) => { const at = menuAtButton(e.currentTarget); setTitleMenu(m => m ? null : at); }}>
                    <ChevDown />
                  </button>
                  {titleMenu && activeId && (
                    <ChatMenu
                      chat={{ id: activeId, title: activeChat?.title || t('New chat'), starred: !!activeChat?.starred, projectId: activeChat?.projectId || null }}
                      at={titleMenu} projects={projects} busy={busyChats.includes(activeId)} anchorRef={titleChevRef}
                      onStopChat={stopChat}
                      onToggleStar={toggleStar}
                      onMoveToProject={moveChatToProject}
                      onDelete={deleteChat}
                      onClose={() => setTitleMenu(null)} />
                  )}
                </div>
              )}
              <TopbarActions
                leading={<>
                  {!incognito && (
                    <button className="paper-btn" onClick={toggleIncognito} title={t("Incognito chat, not saved")} disabled={streaming || queued}>
                      <Ghost />
                    </button>
                  )}
                  {artifactsBtn}
                </>}
                items={[
                  hasSummary && { id: 'summary', icon: <Compact />, label: t("Conversation memory"), onClick: () => setSummaryOpen(true) },
                  { id: 'personas', icon: <Star />, label: t('Personas'), onClick: () => setPersonasOpen(true) },
                  messages.length > 0 && { id: 'copyall', icon: <Copy />, label: t('Copy all'), onClick: () => copyConversation() },
                  activeId && { id: 'inspect', icon: <Telescope />, label: t('Inspect context'), onClick: () => setInspectOpen(true) },
                  user?.isAdmin && activeId && { id: 'ctl', icon: <Sliders />, label: t("Chat controls (admin)"), active: ctlOpen, onClick: () => { setArtifactsOpen(false); setCtlOpen(o => !o); } },
                  messages.length > 0 && user?.prefs?.threadFind !== false && { id: 'find', icon: <Search />, label: t('Find in conversation'), active: findOpen, onClick: () => (findOpen ? closeFind() : setFindOpen(true)) },
                  activeId && messages.length > 0 && user?.prefs?.branchMap !== false && { id: 'tree', icon: <Fork />, label: t('Branch map'), active: treeOpen, onClick: () => setTreeOpen(o => !o) },
                  outline.length > 1 && user?.prefs?.threadOutline !== false && { id: 'outline', icon: <TextIcon />, label: t('Contents'), active: outlineOpen, onClick: () => setOutlineOpen(o => !o) },
                  activeId && messages.length > 0 && { id: 'focus', icon: <Expand />, label: focusMode ? t('Exit focus mode') : t('Focus mode'), active: focusMode, onClick: () => setFocusMode(o => !o) },
                  activeId && { id: 'ledger', icon: <Gauge />, label: t('Context ledger'), active: ledgerOpen, onClick: () => setLedgerOpen(o => !o) },
                ]} />
            </div>
            {findOpen && user?.prefs?.threadFind !== false && <ThreadFind scrollRef={scrollRef} revision={findRevision} onMatches={onFindMatches} onClose={closeFind} />}
            <div className="scroll-area" id="oq-thread" ref={scrollRef} onScroll={onScroll} onWheel={onWheel} onTouchMove={onTouchMove}>
              <div className={'thread' + (ledgerOpen ? ' ledger-on' : '') + (heavyThread ? ' virt' : '') + (findOpen ? ' finding' : '')}
                role="log" aria-label={t('Conversation')} aria-live="polite" aria-relevant="additions text" aria-busy={streaming ? 'true' : 'false'}>
                {ledgerOpen && <LedgerBar ledger={ledger} liveUsed={ledgerTokens.used} live={streaming} />}
                {threadLoading && messages.length === 0 && <ThreadSkeleton />}
                {(() => {
                  const streamKey = assistantIdRef.current || '_stream';
                  const renderList = streaming
                    ? [...messages.filter(m => m.id !== streamKey), { id: streamKey, _k: streamKey, role: 'assistant', content: dispContent, reasoning: dispReason, reasoningSegs: dispSegs, model_id: streamModelRef.current || currentId, _streaming: true }]
                    : messages;
                  let lastA = null;
                  for (let i = renderList.length - 1; i >= 0; i--) if (renderList[i].role === 'assistant') { lastA = renderList[i]; break; }
                  const ledgerById = new Map((ledgerOpen && ledger ? ledger.messages : []).map(m => [m.id, m]));
                  const ledgerLimit = (ledgerOpen && ledger && ledger.limit) || 0;
                  return renderList.map(msg => {
                    const li = ledgerOpen ? ledgerById.get(msg.id) : null;
                    const liTokens = li ? li.tokens : (ledgerOpen && msg._streaming ? ledgerTokens.generated : 0);
                    return (
                    <Message key={msg._k || msg.id} msg={msg} model={resolveMsgModel(msg, model)} models={models} currentId={currentId} chatId={activeId} pins={chatPins} chatEnded={chatEnded}
                      canContinue={(canContinue || !!msg.truncated) && !streaming && !chatEnded && msg === lastA && !msg._streaming}
                      onContinue={continueReply}
                      ledger={ledgerOpen}
                      ledgerTokens={liTokens}
                      ledgerPct={liTokens && ledgerLimit ? Math.min(100, Math.round((liTokens / ledgerLimit) * 1000) / 10) : 0}
                      ledgerState={li ? (li.excluded ? 'excluded' : li.summarized ? 'summarized' : 'active') : (msg._streaming ? 'active' : '')}
                      onToggleExclude={toggleExclude}
                      steers={msg._streaming ? liveSteers : (msg.steers || null)}
                      status={msg._streaming ? modelStatus : null}
                      statusDelay={statusDelay}
                      streaming={!!msg._streaming} phase={msg._streaming ? ((modelById.get(currentId)?.hideThinking && phase === 'thinking') ? 'generating' : phase) : 'static'} liveCall={msg._streaming ? liveCall : null} liveCalls={msg._streaming ? liveCalls : EMPTY_CALLS}
                      onTogglePinFile={togglePinFile} onRegenerate={regenerate} onRegenerateWith={regenerateWith} onEdit={editMessage} onDelete={deleteMessage} onSelectBranch={selectBranch} onFork={forkChat} onTogglePin={togglePin}
                      showSpeed={showMsgSpeed}
                      showIcon={msg.role === 'assistant' && (cfg.uiPreset === 'openai' || (lastA && msg.id === lastA.id))}
                      preset={cfg.uiPreset === 'openai' ? 'openai' : 'anthropic'} />
                    );
                  });
                })()}
                {chatErrors[activeKey()] && (
                  <div className="chat-error" role="alert">
                    <div className="chat-error-main">
                      <span className="chat-error-title">{t('Something went wrong')}</span>
                      <span className="chat-error-text">{chatErrors[activeKey()]}</span>
                    </div>
                    <div className="chat-error-actions">
                      <button className="chat-error-copy" title={errorCopied ? t('Copied') : t('Copy')}
                        onClick={async () => { if (await copyText(chatErrors[activeKey()])) { setErrorCopied(true); setTimeout(() => setErrorCopied(false), 1400); } }}>
                        {errorCopied ? <Check style={{ width: 15 }} /> : <Copy style={{ width: 15 }} />}
                      </button>
                      <button className="chat-error-x" title={t('Dismiss')} onClick={() => dismissError()}><X style={{ width: 15 }} /></button>
                    </div>
                  </div>
                )}
                {queuedList.map(q => (
                  <div key={q.id} className="queue-ghost">
                    <div className="msg user ghost">
                      <div className="bubble-user"><div className="ghost-text">{q.text}</div></div>
                      <div className="ghost-row">
                        <span className="ghost-note">{t("Queued")}</span>
                        <button className="ghost-remove" onClick={() => setQueue(l => l.filter(x => x.id !== q.id))}><X style={{ width: 12 }} /> {t("Remove from queue")}</button>
                      </div>
                    </div>
                    <div className="msg assistant ghost">
                      <div className="ghost-placeholder"><span /><span /><span /></div>
                    </div>
                  </div>
                ))}
                {queued && !streaming && (
                  <div className="msg assistant"><div className="queue-wait"><img src={BRAND_ICON} className="pulse think-dot" alt="" /> {t("Waiting for queue…")}</div></div>
                )}
                {compacting && <CompactingBar />}
                <div className="thread-pad" />
              </div>
            </div>
            {user?.prefs?.threadRail !== false && <ThreadRail items={railList} scrollRef={scrollRef} matches={findMatches} onJump={railJump} />}
            {outlineOpen && outline.length > 0 && user?.prefs?.threadOutline !== false && <Outline items={outline} onJump={outlineJump} onClose={() => setOutlineOpen(false)} />}
            {showJump && <button className="to-bottom" onClick={jumpDown} title={t('Jump to latest')} aria-label={t('Jump to latest')}><Down style={{ width: 17 }} /></button>}
            <div className={'composer-wrap active-composer' + (cfg.uiPreset === 'openai' ? ' floating' : '')} style={{ maxWidth: cfg.uiPreset === 'openai' ? undefined : 'var(--reading-max, 808px)', margin: '0 auto', width: '100%', padding: '0 20px' }}>
              {user?.prefs?.engineStrip === true && <EngineStrip telemetry={telemetry} streaming={streaming} route={routeInfo} />}
              <Composer {...composerProps} focusKey={focusTick} />
              <Disclaimer text={cfg.disclaimer} />
            </div>
          </>
        )}
      </div>

      {artifactsOpen && activeId && !callOpen && (
        <ArtifactsPanel chatId={activeId} files={files} live={liveFile} pending={pendingFiles} focus={artifactFocus} onClose={closeArtifacts} />
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
      {showSettings && <React.Suspense fallback={null}><SettingsModal user={user} cfg={cfg} initialTab={settingsTab} onClose={onSettingsClosed} onUpdated={setUser} onDeleted={() => { location.href = '/'; }} onExportChats={exportAllChats} onImportChats={importChatsFile}
        onTrySkill={(sk) => { newChat(); setInput('/' + sk.name + ' '); setFocusTick(n => n + 1); }} /></React.Suspense>}
      {user?.isAdmin && cfg.uiPresetChosen === false && !presetPicked && (
        <FirstRun onDone={onPresetChosen} />
      )}
      {chatsOverview && <ChatsOverview onClose={() => setChatsOverview(false)} onOpen={(id) => { setChatsOverview(false); openChat(id); }} onChatsChanged={() => loadChats()} />}
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} onOpen={(id) => openChat(id)} />}
      {inspectOpen && activeId && <ContextInspector chatId={activeId} modelId={currentId} onClose={() => setInspectOpen(false)} />}
      {personasOpen && <PersonasModal personas={user?.personas || []} models={models} currentId={currentId} onApply={applyPersona} onSave={savePersonas} onClose={() => setPersonasOpen(false)} />}
      {ledgerPrompt && activeId && (
        <React.Suspense fallback={null}>
          <PromptLedger chatId={activeId} modelId={currentId} onClose={() => setLedgerPrompt(false)} />
        </React.Suspense>
      )}
      {chordHint && (
        <div className="chord-hint" role="status">
          <div className="chord-hint-head">{comboKeys(chordHint.head).map((k, i) => <kbd key={i}>{k}</kbd>)}<span>{t('then…')}</span></div>
          <div className="chord-hint-list">
            {chordHint.items.map(({ action, key }) => (
              <div className="chord-hint-item" key={action.id}><kbd>{comboKeys(key).join('')}</kbd><span>{t(action.label)}</span></div>
            ))}
            {!chordHint.items.length && <div className="chord-hint-item muted">{t('No chords bound yet.')}</div>}
          </div>
        </div>
      )}
      {showShortcuts && <ShortcutsModal prefs={user?.prefs} onClose={() => setShowShortcuts(false)} onCustomize={() => { setShowShortcuts(false); setSettingsTab('keybinds'); setShowSettings(true); }} />}
      {treeOpen && activeId && user?.prefs?.branchMap !== false && <React.Suspense fallback={null}><BranchTree chatId={activeId} onSelect={selectBranch} onJump={jumpToMessage} onClose={() => setTreeOpen(false)} onChanged={async () => { await refreshMessages(activeId); setTimeout(() => scrollBottom(false), 20); toast(t('Message copied into this branch')); }} /></React.Suspense>}
      <Lightbox />
      {showAdmin && <React.Suspense fallback={null}><AdminPanel user={user} onClose={() => { setShowAdmin(false); if (shouldResetPath('admin', location.pathname)) history.pushState({}, '', '/'); }} /></React.Suspense>}
      {showPlayground && <React.Suspense fallback={null}><Playground onClose={() => { setShowPlayground(false); if (shouldResetPath('playground', location.pathname)) history.pushState({}, '', '/'); }} /></React.Suspense>}
      {showSpaces && <SpacesPanel user={user} onClose={() => { setShowSpaces(false); refreshSpacesPending(); if (shouldResetPath('spaces', location.pathname)) history.pushState({}, '', '/'); }} />}
      {showProjects && <ProjectsPanel openId={projectOpenId} composerProps={composerProps}
        startCreate={projectCreate} onCreateHandled={() => setProjectCreate(false)}
        onClose={() => { setShowProjects(false); setProjectOpenId(null); if (shouldResetPath('projects', location.pathname)) history.pushState({}, '', '/'); }}
        onOpenChat={openProjectChat} onStartChat={startProjectChat}
        onOpenProject={(id) => { setProjectOpenId(id); history.replaceState({}, '', pathForProject(id)); loadProjects(); }} />}
      {showCredits && <DocModal title={t("Credits")} name="credits" serif onClose={() => setShowCredits(false)} />}
      {showLicense && <DocModal title={t("Licensing")} name="license" onClose={() => setShowLicense(false)} />}
      {showChangelog && <DocModal title={t("Changelog")} name="changelog" onClose={() => setShowChangelog(false)} />}
      {cmdkOpen && <CommandPalette commands={commands} onClose={() => setCmdkOpen(false)} />}
    </div>
    {user?.isAdmin && <React.Suspense fallback={null}><BuildMode /></React.Suspense>}
    </ThemeProvider>
  );
}
