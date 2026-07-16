import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { Cube, Sliders, Plus, Trash, Users, Sparkles, Chevron, Shield, Globe, FileText, Pencil, Clock, Download, Brain, Copy, Panel, Chat, Mic, Bulb, Star, Refresh, ThumbUp, ThumbDown, Plug } from './icons.jsx';
import { QpIconPicker, Grip, IconSlot, SystemPromptEditor, Toggle, Card, AutosaveNote } from './admin/widgets.jsx';
import ModelEditor from './admin/ModelEditor.jsx';

const TAB_IDS = ['overview', 'models', 'providers', 'branding', 'home', 'members', 'websearch', 'membank', 'voice', 'safety', 'memory', 'skills', 'mcp', 'feedback', 'limits', 'audit', 'analytics'];

export default function AdminPanel({ user, onClose }) {
  const [tab, setTab] = useState(() => {
    try { const t = localStorage.getItem('oq-admin-tab'); if (t && TAB_IDS.includes(t)) return t; } catch {}
    return 'overview';
  });
  const [navQ, setNavQ] = useState('');
  const [models, setModels] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [cfg, setCfg] = useState({ appName: '', disclaimer: '', greetings: [''], appIcon: '', quickPrompts: [], appFont: 'serif', uiPreset: 'anthropic' });
  const [settings, setSettings] = useState({ apiBaseUrl: '', apiKey: '', uploadLimitAdminMb: 8, uploadLimitUserMb: 8, sandboxLimitAdminMb: 1024, sandboxLimitUserMb: 256, modelQueue: false, membankEnabled: false, membankHideTools: false, membankPrompt: '', budgetUser: 0, budgetAdmin: 0, budgetWarnFraction: 0.8, budgetEnforce: false, sessionTtlDays: 30, maxSessions: 0, voiceMicEnabled: false, voiceCallEnabled: false, voiceSttEngine: 'browser', voiceSttUrl: '', voiceSttKey: '', voiceSttModel: 'whisper-1', voiceTtsEngine: 'browser', voiceTtsUrl: '', voiceTtsKey: '', voiceTtsModel: 'tts-1', voiceTtsVoice: 'alloy', voiceTtsSpeed: 1, safetyEnabled: false, safetyModelMode: 'current', safetyModelId: '', safetyPrompt: '', safetyVerbose: true, safetyReasonEnabled: false, memoryEnabled: false, memoryPrompt: '', chatSearchEnabled: false });
  const [providers, setProviders] = useState([]);
  const [membankFiles, setMembankFiles] = useState([]);
  const membankRef = useRef(null);
  const [mbEdit, setMbEdit] = useState(null);
  const [mbEditName, setMbEditName] = useState('');
  const [mbErr, setMbErr] = useState('');
  const [mbDrag, setMbDrag] = useState(null);
  const [memberQ, setMemberQ] = useState('');
  const [memberRole, setMemberRole] = useState('all');
  const [modelView, setModelView] = useState('all');
  const [meSection, setMeSection] = useState('general');
  const [multiSel, setMultiSel] = useState(() => new Set());
  const selAnchor = useRef(null);
  const [provTest, setProvTest] = useState({});
  const [recentAudit, setRecentAudit] = useState(null);
  async function saveMbRename(oldName) {
    const name = mbEditName.trim();
    setMbErr('');
    if (!name || name === oldName) { setMbEdit(null); return; }
    try { const r = await api.patch('/api/admin/membank/' + encodeURIComponent(oldName), { name }); setMembankFiles(r.files || []); setMbEdit(null); }
    catch (e) { setMbErr(e?.message || 'Could not rename file.'); }
  }
  async function setMbFolder(name, folder) {
    setMembankFiles(fs => fs.map(f => f.name === name ? { ...f, folder } : f));
    try { const r = await api.patch('/api/admin/membank/' + encodeURIComponent(name), { folder }); setMembankFiles(r.files || []); } catch {}
  }
  async function commitMbOrder(ordered) {
    setMembankFiles(ordered);
    try { const r = await api.put('/api/admin/membank/order', { items: ordered.map(f => ({ name: f.name, folder: f.folder || '' })) }); if (r.files) setMembankFiles(r.files); } catch {}
  }
  function onMbDrop(target) {
    if (!mbDrag || mbDrag === target.name) { setMbDrag(null); return; }
    const arr = membankFiles.slice();
    const from = arr.findIndex(f => f.name === mbDrag);
    const to = arr.findIndex(f => f.name === target.name);
    if (from < 0 || to < 0) { setMbDrag(null); return; }
    const [moved] = arr.splice(from, 1);
    moved.folder = target.folder || '';
    arr.splice(to, 0, moved);
    setMbDrag(null);
    commitMbOrder(arr);
  }
  async function loadMembank() { try { const d = await api.get('/api/admin/membank'); setMembankFiles(d.files || []); } catch {} }
  async function onMembankPick(e) { const files = [...(e.target.files || [])]; e.target.value = ''; if (!files.length) return; try { const r = await api.uploadMembank(files); setMembankFiles(r.files || []); } catch {} }
  async function removeMembank(name) { try { const r = await api.del('/api/admin/membank/' + encodeURIComponent(name)); setMembankFiles(r.files || []); } catch {} }
  const [skills, setSkills] = useState([]);
  const [skillEdit, setSkillEdit] = useState(null);
  async function loadSkills() { try { const d = await api.get('/api/admin/skills'); setSkills(d.skills || []); } catch {} }
  async function saveSkill(sk) {
    try {
      if (sk.id) { const r = await api.patch('/api/admin/skills/' + sk.id, sk); setSkills(list => list.map(x => x.id === sk.id ? r.skill : x)); }
      else { const r = await api.post('/api/admin/skills', sk); setSkills(list => [...list, r.skill]); }
      setSkillEdit(null);
    } catch (e) { alert(e.message || 'Could not save skill.'); }
  }
  async function deleteSkill(id) { try { await api.del('/api/admin/skills/' + id); setSkills(list => list.filter(x => x.id !== id)); } catch {} }
  async function toggleSkill(sk) { try { const r = await api.patch('/api/admin/skills/' + sk.id, { enabled: !sk.enabled }); setSkills(list => list.map(x => x.id === sk.id ? r.skill : x)); } catch {} }
  const [mcpServers, setMcpServers] = useState([]);
  const [mcpEdit, setMcpEdit] = useState(null);
  const [mcpBusy, setMcpBusy] = useState('');
  async function loadMcp() { try { const d = await api.get('/api/admin/mcp'); setMcpServers(d.servers || []); } catch {} }
  async function saveMcp(sv) {
    try {
      if (sv.id) { const r = await api.patch('/api/admin/mcp/' + sv.id, sv); setMcpServers(list => list.map(x => x.id === sv.id ? r.server : x)); }
      else { const r = await api.post('/api/admin/mcp', sv); setMcpServers(list => [...list, r.server]); if (r.warning) alert('Server saved, but connecting failed: ' + r.warning); }
      setMcpEdit(null);
    } catch (e) { alert(e.message || 'Could not save server.'); }
  }
  async function deleteMcp(id) { try { await api.del('/api/admin/mcp/' + id); setMcpServers(list => list.filter(x => x.id !== id)); } catch {} }
  async function toggleMcp(sv) { try { const r = await api.patch('/api/admin/mcp/' + sv.id, { enabled: !sv.enabled }); setMcpServers(list => list.map(x => x.id === sv.id ? r.server : x)); } catch {} }
  async function refreshMcp(id) {
    setMcpBusy(id);
    try { const r = await api.post('/api/admin/mcp/' + id + '/refresh'); setMcpServers(list => list.map(x => x.id === id ? r.server : x)); }
    catch {}
    setMcpBusy('');
  }
  const [fbRows, setFbRows] = useState(null);
  const [fbCounts, setFbCounts] = useState({ up: 0, down: 0 });
  const [fbOffset, setFbOffset] = useState(0);
  async function loadFeedback(offset = 0) {
    try { const d = await api.get('/api/admin/feedback?offset=' + offset); setFbRows(d.feedback || []); setFbCounts(d.counts || { up: 0, down: 0 }); setFbOffset(offset); } catch {}
  }
  const [safetyLog, setSafetyLog] = useState(null);
  const [safetyLogTotal, setSafetyLogTotal] = useState(0);
  async function loadSafetyLog() {
    try { const d = await api.get('/api/admin/safety-log'); setSafetyLog(d.entries || []); setSafetyLogTotal(d.total || 0); } catch {}
  }
  async function clearSafetyLog() {
    if (!confirm('Clear the entire safety log?')) return;
    try { await api.del('/api/admin/safety-log'); setSafetyLog([]); setSafetyLogTotal(0); } catch {}
  }
  const [audit, setAudit] = useState({ entries: [], total: 0, offset: 0, hasMore: false, loading: false, actions: [] });
  const [auditFilter, setAuditFilter] = useState({ action: '', actor: '', days: '' });
  const [adminUsage, setAdminUsage] = useState(null);
  const [adminUsageDays, setAdminUsageDays] = useState('30');
  const [customPresets, setCustomPresetsState] = useState([]);
  const [presetForm, setPresetForm] = useState({ match: '', label: '', in: '', out: '' });
  const [presetErr, setPresetErr] = useState('');
  async function loadAdminUsage(days) {
    const d = days || adminUsageDays;
    try { setAdminUsage(await api.get('/api/admin/usage?days=' + d)); } catch {}
  }
  async function loadPresets() { try { const r = await api.get('/api/admin/pricing/presets'); setCustomPresetsState(r.custom || []); } catch {} }
  async function addPreset() {
    setPresetErr('');
    try { const r = await api.post('/api/admin/pricing/presets', { match: presetForm.match, label: presetForm.label, in: Number(presetForm.in), out: Number(presetForm.out) }); setCustomPresetsState(r.custom || []); setPresetForm({ match: '', label: '', in: '', out: '' }); }
    catch (e) { setPresetErr(e?.message || 'Could not save preset.'); }
  }
  async function delPreset(match) { try { const r = await api.del('/api/admin/pricing/presets/' + encodeURIComponent(match)); setCustomPresetsState(r.custom || []); } catch {} }
  async function loadAudit(offset = 0, filterOverride) {
    const f = filterOverride || auditFilter;
    setAudit(a => ({ ...a, loading: true }));
    try {
      const params = new URLSearchParams({ limit: '60', offset: String(offset) });
      if (f.action) params.set('action', f.action);
      if (f.actor) params.set('actor', f.actor);
      if (f.days) params.set('days', f.days);
      const d = await api.get('/api/admin/audit?' + params.toString());
      setAudit(a => ({ entries: offset ? [...a.entries, ...d.entries] : d.entries, total: d.total, offset, hasMore: d.hasMore, loading: false, actions: d.actions || a.actions }));
    } catch { setAudit(a => ({ ...a, loading: false })); }
  }
  async function loadRecentAudit() {
    try { const d = await api.get('/api/admin/audit?limit=6&offset=0'); setRecentAudit(d.entries || []); } catch { setRecentAudit([]); }
  }
  const [providerTypes, setProviderTypes] = useState({});
  const [selModel, setSelModel] = useState(null);
  const [modelFilter, setModelFilter] = useState('');
  const [dragOver, setDragOver] = useState(null);
  const [ask, setAsk] = useState(null);
  const [autosave, setAutosave] = useState('idle');
  const [pub, setPub] = useState({ dirty: false, publishedAt: null });
  const [publishing, setPublishing] = useState(false);
  const [pubFlash, setPubFlash] = useState(false);
  const saveTimers = useRef({});
  const pendingIds = useRef(new Set());
  const readyRef = useRef(false);
  const setSaveTimer = useRef(null);
  const cfgSaveTimer = useRef(null);
  const [setAutoStatus, setSetAutoStatus] = useState('idle');
  const selModelRef = useRef(null);
  const dragIndex = useRef(null);
  const modelsRef = useRef([]);
  useEffect(() => { modelsRef.current = models; }, [models]);
  useEffect(() => { selModelRef.current = selModel; }, [selModel]);
  useEffect(() => { try { localStorage.setItem('oq-admin-tab', tab); } catch {} }, [tab]);

  useEffect(() => {
    async function onConfig() {
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
        clearTimeout(onConfig._t);
        onConfig._t = setTimeout(onConfig, 2500);
        return;
      }
      try {
        const fresh = await api.get('/api/admin/models');
        setModels(cur => fresh.map(fm => {
          if (pendingIds.current.has(fm.id)) return cur.find(c => c.id === fm.id) || fm;
          if (saveTimers.current[fm.id]) return cur.find(c => c.id === fm.id) || fm;
          return fm;
        }));
        refreshPubState();
      } catch {}
    }
    window.addEventListener('oq-config', onConfig);
    return () => window.removeEventListener('oq-config', onConfig);
  }, []);

  async function load() {
    setModels(await api.get('/api/admin/models'));
    setSettings(await api.get('/api/admin/settings'));
    try { const p = await api.get('/api/admin/providers'); setProviders(p.providers || []); setProviderTypes(p.types || {}); } catch {}
    try {
      const c = await api.get('/api/app-config');
      setCfg({ appName: c.appName || '', disclaimer: c.disclaimer || '', greetings: c.greetings?.length ? c.greetings : [''], appIcon: c.appIcon || '', quickPrompts: Array.isArray(c.quickPrompts) ? c.quickPrompts : [], appFont: c.appFont === 'sans' ? 'sans' : 'serif', uiPreset: c.uiPreset === 'openai' ? 'openai' : 'anthropic' });
    } catch {}
    loadUsers();
  }
  async function loadUsers() { try { setUsersList(await api.get('/api/admin/users')); } catch {} }
  async function refreshPubState() { try { setPub(await api.get('/api/admin/models/publish-state')); } catch {} }
  useEffect(() => { load().then(() => { readyRef.current = true; }); refreshPubState(); }, []);

  useEffect(() => {
    if (tab === 'overview') { if (!adminUsage) loadAdminUsage('30'); if (!recentAudit) loadRecentAudit(); }
    else if (tab === 'membank') loadMembank();
    else if (tab === 'skills') loadSkills();
    else if (tab === 'safety') loadSafetyLog();
    else if (tab === 'mcp') loadMcp();
    else if (tab === 'feedback') loadFeedback(0);
    else if (tab === 'audit') loadAudit(0);
    else if (tab === 'analytics') { loadAdminUsage(); loadPresets(); }
  }, [tab]);

  useEffect(() => {
    if (!readyRef.current) return;
    if (setSaveTimer.current) clearTimeout(setSaveTimer.current);
    setSetAutoStatus('saving');
    setSaveTimer.current = setTimeout(async () => {
      try { await api.patch('/api/admin/settings', settings); setPub(p => ({ ...p, dirty: true })); setSetAutoStatus('saved'); }
      catch { setSetAutoStatus('idle'); }
    }, 500);
  }, [settings]);

  useEffect(() => {
    if (!readyRef.current) return;
    if (cfgSaveTimer.current) clearTimeout(cfgSaveTimer.current);
    setSetAutoStatus('saving');
    cfgSaveTimer.current = setTimeout(async () => {
      try { await api.patch('/api/admin/app-config', { ...cfg, greetings: cfg.greetings.map(g => g.trim()).filter(Boolean), quickPrompts: (cfg.quickPrompts || []).filter(q => (q.label || '').trim() && (q.prompt || '').trim()) }); setPub(p => ({ ...p, dirty: true })); setSetAutoStatus('saved'); }
      catch { setSetAutoStatus('idle'); }
    }, 500);
  }, [cfg]);

  async function setRole(id, isAdmin) {
    await api.patch('/api/admin/users/' + id, { isAdmin });
    setUsersList(us => us.map(u => u.id === id ? { ...u, isAdmin } : u));
  }
  async function saveBudget(id, value) {
    const budget = value === '' || value == null ? null : Math.max(0, Number(value) || 0);
    try { await api.patch('/api/admin/users/' + id + '/budget', { budget }); setUsersList(us => us.map(u => u.id === id ? { ...u, budget } : u)); } catch {}
  }
  function removeUser(id) {
    setAsk({
      message: 'Remove this user and all their chats? This cannot be undone.', danger: 'Remove user',
      onConfirm: async () => { await api.del('/api/admin/users/' + id); setUsersList(us => us.filter(u => u.id !== id)); }
    });
  }

  function change(updated) {
    setModels(ms => ms.map(m => {
      if (m.id === updated.id) return updated;
      if (updated.is_default && m.is_default) return { ...m, is_default: 0 };
      return m;
    }));
    setAutosave('saving');
    pendingIds.current.add(updated.id);
    clearTimeout(saveTimers.current[updated.id]);
    saveTimers.current[updated.id] = setTimeout(async () => {
      try {
        await api.patch('/api/admin/models/' + updated.id, updated);
        setAutosave('saved');
        setPub(p => ({ ...p, dirty: true }));
        setTimeout(() => setAutosave(s => s === 'saved' ? 'idle' : s), 1600);
      } catch { setAutosave('idle'); }
      finally { setTimeout(() => pendingIds.current.delete(updated.id), 1200); delete saveTimers.current[updated.id]; }
    }, 500);
  }
  async function add() {
    const { id } = await api.post('/api/admin/models', { display_name: 'New model', internal_name: 'local-model' });
    await load(); setSelModel(id); setPub(p => ({ ...p, dirty: true }));
  }
  const [discover, setDiscover] = useState(null);
  async function openDiscover(providerId) {
    const pid = (typeof providerId === 'string' && providerId) ? providerId : (providers[0]?.id || '');
    setDiscover({ loading: true, error: '', list: [], providerId: pid });
    try {
      const r = await api.get('/api/admin/discover-models?provider=' + encodeURIComponent(pid));
      setDiscover({ loading: false, error: '', list: r.models || [], providerId: pid });
    } catch (e) { setDiscover({ loading: false, error: e?.message || 'Could not reach the backend.', list: [], providerId: pid }); }
  }
  async function addDiscovered(id) {
    setDiscover(d => d ? { ...d, list: d.list.map(x => x.id === id ? { ...x, busy: true } : x) } : d);
    await api.post('/api/admin/models', { display_name: id, internal_name: id, provider_id: discover?.providerId || (providers[0]?.id || undefined) });
    await load();
    setDiscover(d => d ? { ...d, list: d.list.map(x => x.id === id ? { ...x, added: true, busy: false } : x) } : d);
    setPub(p => ({ ...p, dirty: true }));
  }
  async function publish() {
    setPublishing(true);
    try {
      const r = await api.post('/api/admin/models/publish', {});
      setPub({ dirty: false, published: true, publishedAt: r.publishedAt });
      setPubFlash(true); setTimeout(() => setPubFlash(false), 2200);
    } finally { setPublishing(false); }
  }
  async function duplicate(id) {
    const src = modelsRef.current.find(m => m.id === id);
    if (!src) return;
    const body = { ...src, display_name: (src.display_name || 'Model') + ' copy', is_default: false };
    const { id: newId } = await api.post('/api/admin/models', body);
    await api.patch('/api/admin/models/' + newId, body);
    await load();
    setSelModel(newId);
    setPub(p => ({ ...p, dirty: true }));
  }
  async function bulkDuplicate(ids) {
    for (const id of ids) {
      const src = modelsRef.current.find(m => m.id === id);
      if (!src) continue;
      const body = { ...src, display_name: (src.display_name || 'Model') + ' copy', is_default: false };
      const { id: newId } = await api.post('/api/admin/models', body);
      await api.patch('/api/admin/models/' + newId, body);
    }
    await load();
    setMultiSel(new Set());
    setPub(p => ({ ...p, dirty: true }));
  }
  async function bulkSetEnabled(ids, enabled) {
    for (const id of ids) await api.patch('/api/admin/models/' + id, { enabled: enabled ? 1 : 0 });
    setModels(ms => ms.map(m => ids.includes(m.id) ? { ...m, enabled: enabled ? 1 : 0 } : m));
    setPub(p => ({ ...p, dirty: true }));
  }
  function bulkDelete(ids) {
    setAsk({
      message: `Delete ${ids.length} model${ids.length === 1 ? '' : 's'}? This cannot be undone.`, danger: `Delete ${ids.length} model${ids.length === 1 ? '' : 's'}`,
      onConfirm: async () => {
        for (const id of ids) await api.del('/api/admin/models/' + id);
        setModels(ms => ms.filter(m => !ids.includes(m.id)));
        setMultiSel(new Set());
        setSelModel(s => ids.includes(s) ? null : s);
        setPub(p => ({ ...p, dirty: true }));
      }
    });
  }
  function del(id) {
    setAsk({
      message: 'Delete this model? This cannot be undone.', danger: 'Delete model',
      onConfirm: async () => { await api.del('/api/admin/models/' + id); setModels(ms => ms.filter(m => m.id !== id)); setSelModel(s => s === id ? null : s); setPub(p => ({ ...p, dirty: true })); }
    });
  }
  async function reloadProviders() {
    try { const p = await api.get('/api/admin/providers'); setProviders(p.providers || []); setProviderTypes(p.types || {}); } catch {}
  }
  async function addProvider() {
    await api.post('/api/admin/providers', { type: 'lmstudio' });
    await reloadProviders();
  }
  async function patchProvider(id, patch) {
    setProviders(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
    await api.patch('/api/admin/providers/' + id, patch);
  }
  async function deleteProvider(id) {
    try { await api.del('/api/admin/providers/' + id); await reloadProviders(); await load(); }
    catch (e) { setAsk({ message: e?.message || 'Could not delete provider.', onConfirm: () => setAsk(null) }); }
  }
  async function testProvider(id) {
    setProvTest(t => ({ ...t, [id]: { busy: true } }));
    try {
      const r = await api.get('/api/admin/discover-models?provider=' + encodeURIComponent(id));
      setProvTest(t => ({ ...t, [id]: { ok: true, count: (r.models || []).length } }));
    } catch (e) {
      setProvTest(t => ({ ...t, [id]: { ok: false, err: e?.message || 'Unreachable' } }));
    }
  }

  const drag = {
    dragging: dragIndex.current, over: dragOver,
    onStart: (i) => { dragIndex.current = i; },
    onOver: (i) => setDragOver(i),
    onEnd: () => { dragIndex.current = null; setDragOver(null); },
    onDrop: (to) => {
      const from = dragIndex.current; dragIndex.current = null; setDragOver(null);
      if (from == null || from === to) return;
      const arr = modelsRef.current.slice();
      const [item] = arr.splice(from, 1); arr.splice(to, 0, item);
      setModels(arr);
      api.post('/api/admin/models/reorder', { ids: arr.map(m => m.id) }).catch(() => {});
      setPub(p => ({ ...p, dirty: true }));
    }
  };

  const NAV = [
    { group: '', items: [
      { id: 'overview', label: 'Overview', desc: 'A live snapshot of your workspace, catalog, people, spend, and recent activity.', Icon: Panel }
    ] },
    { group: 'Catalog', items: [
      { id: 'models', label: 'Models', desc: 'The catalog users pick from, prompts, capabilities, look and pricing per model.', Icon: Cube },
      { id: 'providers', label: 'Providers', desc: 'The LLM backends your models run through.', Icon: Sliders }
    ] },
    { group: 'Workspace', items: [
      { id: 'branding', label: 'Branding', desc: 'Name, icon, and typography. Changes save to a draft and push to every connected client.', Icon: Sparkles },
      { id: 'home', label: 'Home Screen', desc: 'The greetings and quick prompts users see when they start a new chat.', Icon: Chat },
      { id: 'members', label: 'Members', desc: 'Everyone who has signed in, roles, budgets, and account removal.', Icon: Users }
    ] },
    { group: 'Intelligence', items: [
      { id: 'websearch', label: 'Web Search', desc: 'Give models a web search tool backed by your own SearXNG instance.', Icon: Globe },
      { id: 'membank', label: 'Memory Bank', desc: 'Reference files every model can read on demand.', Icon: FileText },
      { id: 'voice', label: 'Voice', desc: 'Dictation and voice calls, speech-to-text and text-to-speech engines.', Icon: Mic },
      { id: 'safety', label: 'Safety Model', desc: 'Screen user prompts with a model before they reach the assistant.', Icon: Shield },
      { id: 'memory', label: 'User Memory', desc: 'Per-user long-term memory and searching past chats as a tool.', Icon: Brain },
      { id: 'skills', label: 'Skills', desc: 'Reusable instruction files models load on demand for specific tasks.', Icon: Bulb },
      { id: 'mcp', label: 'MCP Connectors', desc: 'Connect local MCP servers and expose their tools to every model.', Icon: Plug }
    ] },
    { group: 'Governance', items: [
      { id: 'limits', label: 'Limits & Budgets', desc: 'Guardrails applied across the app. These take effect immediately.', Icon: Shield },
      { id: 'feedback', label: 'Feedback', desc: 'Thumbs up/down users left on responses, for reviewing model quality.', Icon: Star },
      { id: 'audit', label: 'Audit Log', desc: 'A record of sensitive admin actions. Pruned after 120 days.', Icon: Clock },
      { id: 'analytics', label: 'Analytics', desc: 'Account-wide token use, estimated cost, and price presets.', Icon: Brain }
    ] }
  ];
  const flatNav = NAV.flatMap(g => g.items.map(it => ({ ...it, group: g.group })));
  const activeMeta = flatNav.find(t => t.id === tab) || flatNav[0];
  const nq = navQ.trim().toLowerCase();
  const navMatches = nq ? flatNav.filter(t => t.label.toLowerCase().includes(nq) || (t.group || '').toLowerCase().includes(nq)) : null;

  const visibleModels = models.filter(m => m.enabled && !m.unavailable).length;
  const hiddenModels = models.filter(m => !m.enabled).length;
  const unavailModels = models.filter(m => !!m.unavailable).length;
  const adminCount = usersList.filter(u => u.isAdmin || u.isOwner).length;

  const fmtWhen = (ts) => {
    if (!ts) return '';
    const d = new Date(ts); const diff = Date.now() - (typeof ts === 'number' ? ts : d.getTime());
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString();
  };

  return (
    <div className="admin-page">
      <nav className="admin-rail">
        <div className="ar-brand">
          <img className="ar-brand-icon" src={cfg.appIcon || '/starburst.svg'} alt="" />
          <div className="ar-brand-text">
            <span className="ar-brand-name">{cfg.appName || 'open-quill'}</span>
            <span className="ar-brand-sub">Control Center</span>
          </div>
        </div>
        <div className="ar-filter">
          <input value={navQ} onChange={(e) => setNavQ(e.target.value)} placeholder="Jump to a section…"
            onKeyDown={(e) => { if (e.key === 'Enter' && navMatches?.length) { setTab(navMatches[0].id); setNavQ(''); } if (e.key === 'Escape') setNavQ(''); }} />
        </div>
        <div className="ar-scroll">
          {navMatches ? (
            <div className="ar-group">
              <div className="ar-group-label">{navMatches.length ? 'Matches' : 'No matches'}</div>
              {navMatches.map(({ id, label, Icon, group }) => (
                <button key={id} className={'ar-tab' + (tab === id ? ' active' : '')} onClick={() => { setTab(id); setNavQ(''); }}>
                  <Icon /> <span>{label}</span>{group && <span className="ar-tab-hint">{group}</span>}
                </button>
              ))}
            </div>
          ) : NAV.map((g, gi) => (
            <div className="ar-group" key={g.group || gi}>
              {g.group && <div className="ar-group-label">{g.group}</div>}
              {g.items.map(({ id, label, Icon }) => (
                <button key={id} className={'ar-tab' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
                  <Icon /> <span>{label}</span>
                  {id === 'models' && models.length > 0 && <span className="ar-tab-count">{models.length}</span>}
                  {id === 'members' && usersList.length > 0 && <span className="ar-tab-count">{usersList.length}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
        <button className="ar-back" onClick={onClose}><Chevron style={{ transform: 'rotate(90deg)', width: 16 }} /> Back to chat</button>
      </nav>
      <div className="admin-content">
        <header className="admin-topbar">
          <div className="atb-title">
            {activeMeta.group && <span className="atb-crumb">{activeMeta.group}</span>}
            <h1>{activeMeta.label}</h1>
            <span className="atb-desc">{activeMeta.desc}</span>
          </div>
          {tab !== 'overview' && (
            <div className="atb-status">
              {pubFlash
                ? <span className="saved-flash">Pushed to all clients ✓</span>
                : pub.dirty
                  ? <span className="pub-note dirty">Unpublished draft changes</span>
                  : <span className="pub-note">{pub.published ? 'Clients are up to date' : 'Nothing published yet'}</span>}
            </div>
          )}
          {tab !== 'overview' && (
            <button className={'btn primary push-btn' + (pub.dirty ? ' dirty' : '')} onClick={publish} disabled={publishing || (!pub.dirty && pub.published)}>
              {publishing ? 'Pushing…' : 'Push to all clients'}
            </button>
          )}
        </header>
        <div className={'admin-body' + (tab === 'models' && models.length ? ' wide' : '')}>
          {tab === 'overview' && (
            <div className="ov-wrap">
              <div className="ov-stats">
                {[
                  ['Models', String(models.length), `${visibleModels} visible · ${hiddenModels} hidden${unavailModels ? ` · ${unavailModels} unavailable` : ''}`, Cube, 'models'],
                  ['Providers', String(providers.length), Object.keys(providerTypes).length ? 'LLM backends connected' : 'LLM backends', Sliders, 'providers'],
                  ['Members', String(usersList.length), `${adminCount} admin${adminCount === 1 ? '' : 's'}`, Users, 'members'],
                  ['30-day spend', adminUsage ? '$' + (adminUsage.totals?.cost || 0).toFixed(2) : ', ', adminUsage ? `${(adminUsage.totals?.total || 0).toLocaleString()} tokens · ${(adminUsage.totals?.generations || 0).toLocaleString()} generations` : 'Loading…', Brain, 'analytics']
                ].map(([l, v, s, Icon, dest]) => (
                  <button key={l} className="ov-stat" onClick={() => setTab(dest)}>
                    <span className="ov-stat-icon"><Icon /></span>
                    <span className="ov-stat-main">
                      <span className="ov-stat-v">{v}</span>
                      <span className="ov-stat-l">{l}</span>
                      <span className="ov-stat-s">{s}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="ov-cols">
                <Card title="Publishing" sub="Drafts stay private to admins until pushed.">
                  <div className={'ov-pub' + (pub.dirty ? ' dirty' : '')}>
                    <span className="ov-pub-dot" />
                    <div className="ov-pub-text">
                      <div className="ov-pub-title">{pub.dirty ? 'You have unpublished draft changes' : pub.published ? 'All clients are up to date' : 'Nothing published yet'}</div>
                      <div className="muted-note">{pub.publishedAt ? 'Last pushed ' + new Date(pub.publishedAt).toLocaleString() : 'Model, branding, and home screen edits collect in a draft until you push them.'}</div>
                    </div>
                    <button className="btn primary" onClick={publish} disabled={publishing || (!pub.dirty && pub.published)}>{publishing ? 'Pushing…' : 'Push now'}</button>
                  </div>
                </Card>
                <Card title="Quick actions" sub="Common tasks, one click away.">
                  <div className="ov-actions">
                    <button className="ov-action" onClick={() => { setTab('models'); add(); }}><Plus /> <span>New model</span></button>
                    <button className="ov-action" onClick={() => { setTab('models'); openDiscover(providers[0]?.id); }}><Cube /> <span>Discover models</span></button>
                    <button className="ov-action" onClick={() => { setTab('providers'); }}><Sliders /> <span>Manage providers</span></button>
                    <button className="ov-action" onClick={() => { setTab('branding'); }}><Sparkles /> <span>Edit branding</span></button>
                    <button className="ov-action" onClick={() => { setTab('limits'); }}><Shield /> <span>Review limits</span></button>
                    <button className="ov-action" onClick={() => { setTab('audit'); }}><Clock /> <span>Open audit log</span></button>
                  </div>
                </Card>
              </div>
              <Card title="Recent activity" sub="The latest sensitive admin actions."
                right={<button className="linklike" onClick={() => setTab('audit')}>View full log</button>}>
                {!recentAudit && <div className="muted-note">Loading…</div>}
                {recentAudit && recentAudit.length === 0 && <div className="muted-note">No admin activity recorded yet.</div>}
                {recentAudit && recentAudit.length > 0 && (
                  <div className="ov-activity">
                    {recentAudit.map(e => (
                      <div key={e.id} className="ov-act-row">
                        <span className="au-action">{e.action}</span>
                        <span className="ov-act-meta">{e.actorEmail}</span>
                        <span className="ov-act-when">{fmtWhen(e.ts)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}
          {tab === 'models' && (() => {
            const sel = models.find(x => x.id === selModel) || models[0] || null;
            if (!models.length) return (
              <div className="admin-empty">
                <div className="ae-icon"><Cube style={{ width: 30 }} /></div>
                <h2>Add your first model</h2>
                <p>Models are what users pick in the chat. Each one points at a provider (your LLM backend) and carries its own prompt, sampling, and capabilities.</p>
                <div className="ae-actions">
                  <button className="btn primary" onClick={add}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> Add model</button>
                  <button className="btn ghost" onClick={() => openDiscover(providers[0]?.id)}><Cube style={{ width: 14, verticalAlign: '-2px' }} /> Discover from a provider</button>
                </div>
                <div className="ae-hint">No provider set up yet? Head to the <button className="linklike" onClick={() => setTab('providers')}>Providers</button> section first.</div>
              </div>
            );
            const q = modelFilter.trim().toLowerCase();
            const inView = (m) => modelView === 'visible' ? (!!m.enabled && !m.unavailable) : modelView === 'hidden' ? !m.enabled : modelView === 'unavailable' ? !!m.unavailable : true;
            const shown = models.filter(m => inView(m) && (!q || (m.display_name || '').toLowerCase().includes(q) || (m.internal_name || '').toLowerCase().includes(q)));
            const canDrag = !q && modelView === 'all' && multiSel.size <= 1;
            const selectedIds = [...multiSel].filter(id => models.some(m => m.id === id));
            const bulk = selectedIds.length > 1;
            function rowClick(e, m) {
              if (e.shiftKey && selAnchor.current) {
                const order = shown.map(x => x.id);
                let a = order.indexOf(selAnchor.current), b = order.indexOf(m.id);
                if (a < 0) a = b;
                const [lo, hi] = a < b ? [a, b] : [b, a];
                setMultiSel(new Set(order.slice(lo, hi + 1)));
                setSelModel(m.id);
                return;
              }
              if (e.ctrlKey || e.metaKey) {
                setMultiSel(prev => {
                  const n = new Set(prev);
                  if (!n.size && sel) n.add(sel.id);
                  if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
                  return n;
                });
                selAnchor.current = m.id;
                setSelModel(m.id);
                return;
              }
              setMultiSel(new Set());
              selAnchor.current = m.id;
              setSelModel(m.id);
            }
            return (
              <>
                <div className="mg-wrap">
                  <div className="mg-rail">
                    <div className="mg-rail-head">
                      <span className="mg-rail-title">Models <span className="mg-count">{models.length}</span></span>
                      <button className="mg-add-btn" onClick={add} title="Add model"><Plus style={{ width: 16 }} /></button>
                    </div>
                    <div className="mg-search">
                      <input value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} placeholder="Search models…" />
                    </div>
                    <div className="mg-filters">
                      {[['all', 'All', models.length], ['visible', 'Visible', visibleModels], ['hidden', 'Hidden', hiddenModels], ['unavailable', 'Down', unavailModels]].map(([v, l, n]) => (
                        <button key={v} className={'mg-chip' + (modelView === v ? ' on' : '')} onClick={() => setModelView(v)}>{l}{n > 0 && <em>{n}</em>}</button>
                      ))}
                    </div>
                    <div className="mg-list">
                      {shown.map((m) => {
                        const i = models.indexOf(m);
                        return (
                          <div key={m.id}
                            className={'mg-row' + (sel && sel.id === m.id && !bulk ? ' active' : '') + (multiSel.has(m.id) ? ' checked' : '') + (canDrag && drag.dragging === i ? ' dragging' : '') + (canDrag && drag.over === i ? ' drag-over' : '')}
                            draggable={canDrag} onDragStart={() => canDrag && drag.onStart(i)} onDragEnd={drag.onEnd}
                            onDragOver={(e) => { if (!canDrag) return; e.preventDefault(); drag.onOver(i); }}
                            onDrop={(e) => { if (!canDrag) return; e.preventDefault(); drag.onDrop(i); }}
                            onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                            onClick={(e) => rowClick(e, m)}>
                            {canDrag && <span className="mg-grip"><Grip /></span>}
                            {m.static_icon ? <img className="mg-row-icon" src={m.static_icon} alt="" /> : <span className="mg-row-icon noicon">{(m.display_name || '?').trim().charAt(0).toUpperCase()}</span>}
                            <div className="mg-row-meta">
                              <span className="mg-row-name">
                                {m.display_name || 'Untitled model'}
                                {!!m.is_default && <span className="mg-star" title="Default">★</span>}
                              </span>
                              <span className="mg-row-sub">{m.internal_name || 'no id'}</span>
                            </div>
                            <span className="mg-dots">
                              {!m.enabled && <span className="mg-dot dim" title="Hidden" />}
                              {!!m.unavailable && <span className="mg-dot warn" title="Unavailable" />}
                              {!!m.in_more_models && <span className="mg-dot" title="Grouped" />}
                            </span>
                          </div>
                        );
                      })}
                      {shown.length === 0 && <div className="mg-empty">{q ? `No models match “${modelFilter}”.` : 'Nothing here with this filter.'}</div>}
                    </div>
                    <div className="mg-rail-foot">
                      <button className="btn add-model" onClick={add}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> Add model</button>
                      <button className="btn ghost discover-btn" onClick={openDiscover}><Cube style={{ width: 14, verticalAlign: '-2px' }} /> Discover</button>
                    </div>
                  </div>
                  <div className="mg-detail">
                    {bulk ? (
                      <div className="me2 bulk-panel">
                        <div className="me2-head">
                          <span className="me2-icon noicon">{selectedIds.length}</span>
                          <div className="me2-id">
                            <div className="me2-name">{selectedIds.length} models selected</div>
                            <div className="me2-sub"><span className="me2-sub-text">Shift-click selects a range · Ctrl-click toggles one</span></div>
                          </div>
                        </div>
                        <div className="me2-body">
                          <div className="me2-pane">
                            <div className="bulk-chips">
                              {selectedIds.map(id => {
                                const m = models.find(x => x.id === id);
                                return m ? <span key={id} className="bulk-chip">{m.display_name || 'Untitled'}</span> : null;
                              })}
                            </div>
                            <div className="bulk-actions">
                              <button className="btn" onClick={() => bulkDuplicate(selectedIds)}><Copy style={{ width: 14, verticalAlign: '-2px' }} /> Duplicate</button>
                              <button className="btn" onClick={() => bulkSetEnabled(selectedIds, true)}>Show</button>
                              <button className="btn" onClick={() => bulkSetEnabled(selectedIds, false)}>Hide</button>
                              <button className="btn danger" onClick={() => bulkDelete(selectedIds)}><Trash style={{ width: 14, verticalAlign: '-2px' }} /> Delete</button>
                              <button className="btn ghost" onClick={() => setMultiSel(new Set())}>Clear selection</button>
                            </div>
                            <div className="muted-note" style={{ marginTop: 12 }}>Duplicating copies every setting except the default flag. Show and Hide flip picker visibility. Deleting cannot be undone.</div>
                          </div>
                        </div>
                      </div>
                    ) : sel
                      ? <ModelEditor key={sel.id} m={sel} onChange={change} onDelete={del} onDuplicate={duplicate} autosaveState={autosave} providers={providers} providerTypes={providerTypes} section={meSection} onSection={setMeSection} />
                      : <div className="muted-note" style={{ padding: 20 }}>No models yet, add one to get started.</div>}
                  </div>
                </div>
              </>
            );
          })()}
          {tab === 'branding' && (
            <>
              <Card title="Identity" sub="How the app introduces itself across every client.">
                <div className="field"><label>App name</label>
                  <input value={cfg.appName} onChange={(e) => setCfg(c => ({ ...c, appName: e.target.value }))} placeholder="open-quill" /></div>
                <div className="field"><label>App icon <span className="muted-note" style={{ display: 'inline' }}>(browser tab + greeting)</span></label>
                  <div className="icon-grid" style={{ gridTemplateColumns: '1fr' }}>
                    <IconSlot label="Click to upload (png, svg, jpeg, gif)" value={cfg.appIcon} def="/starburst.svg" anim="" onChange={(v) => setCfg(c => ({ ...c, appIcon: v }))} />
                  </div>
                </div>
              </Card>
              <Card title="Interface preset" sub="Switches the entire UI between the two looks instantly, for every connected client.">
                <div className="field">
                  <div className="seg" style={{ width: 'fit-content' }}>
                    <button className={(cfg.uiPreset || 'anthropic') === 'anthropic' ? 'on' : ''} onClick={() => setCfg(c => ({ ...c, uiPreset: 'anthropic', appFont: 'serif' }))}>Anthropic</button>
                    <button className={cfg.uiPreset === 'openai' ? 'on' : ''} onClick={() => setCfg(c => ({ ...c, uiPreset: 'openai', appFont: 'sans' }))}>OpenAI</button>
                  </div>
                  <div className="muted-note">Anthropic keeps the classic open-quill layout. OpenAI restyles everything after ChatGPT: pitch-black palette, Open Sans, pill composer, the model picker in the top-left, persistent 28px model logos beside every reply, and no logo motion. New models created while OpenAI is active default to those icon settings.</div>
                </div>
              </Card>
              <Card title="Typography & footer" sub="The overall voice of the interface.">
                <div className="field"><label>Interface font</label>
                  <div className="seg" style={{ width: 'fit-content' }}>
                    <button className={(cfg.appFont || 'serif') === 'serif' ? 'on' : ''} onClick={() => setCfg(c => ({ ...c, appFont: 'serif' }))}>Source Serif (default)</button>
                    <button className={cfg.appFont === 'sans' ? 'on' : ''} onClick={() => setCfg(c => ({ ...c, appFont: 'sans' }))}>Open Sans</button>
                  </div>
                  <div className="muted-note">The display font used for headings, greetings, and assistant text across the entire UI. Open Sans gives a cleaner, sans-serif look everywhere.</div>
                </div>
                <div className="field"><label>Bottom disclaimer</label>
                  <input value={cfg.disclaimer} onChange={(e) => setCfg(c => ({ ...c, disclaimer: e.target.value }))} placeholder="Assistants can make mistakes, double-check responses." /></div>
              </Card>
              <AutosaveNote status={setAutoStatus} />
            </>
          )}
          {tab === 'home' && (
            <>
              <Card title="Greetings" sub="One is shown at random each visit.">
                {cfg.greetings.map((g, i) => (
                  <div key={i} className="greeting-row">
                    <input value={g} onChange={(e) => setCfg(c => ({ ...c, greetings: c.greetings.map((x, j) => j === i ? e.target.value : x) }))} placeholder="How can I help you?" />
                    <button className="btn danger" onClick={() => setCfg(c => ({ ...c, greetings: c.greetings.filter((_, j) => j !== i).length ? c.greetings.filter((_, j) => j !== i) : [''] }))}><Trash style={{ width: 14 }} /></button>
                  </div>
                ))}
                <button className="btn" style={{ marginTop: 8 }} onClick={() => setCfg(c => ({ ...c, greetings: [...c.greetings, ''] }))}><Plus style={{ width: 14, verticalAlign: '-2px' }} /> Add greeting</button>
              </Card>
              <Card title="Quick prompt buttons" sub="Shown under the input on the home screen; clicking sends the prompt. Up to 8.">
                {(cfg.quickPrompts || []).map((q, i) => (
                  <div key={i} className="qp-row">
                    <QpIconPicker value={q.icon || 'none'} onPick={(name) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, icon: name } : x) }))} />
                    <input className="qp-label" value={q.label || ''} placeholder="Button label" onChange={(e) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                    <input className="qp-prompt" value={q.prompt || ''} placeholder="Prompt sent when clicked" onChange={(e) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, prompt: e.target.value } : x) }))} />
                    <button className="btn danger" onClick={() => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.filter((_, j) => j !== i) }))}><Trash style={{ width: 14 }} /></button>
                  </div>
                ))}
                {(cfg.quickPrompts || []).length === 0 && <div className="muted-note" style={{ marginBottom: 6 }}>No quick prompts yet, add one below.</div>}
                {(cfg.quickPrompts || []).length < 8 && <button className="btn" style={{ marginTop: 8 }} onClick={() => setCfg(c => ({ ...c, quickPrompts: [...(c.quickPrompts || []), { icon: 'none', label: '', prompt: '' }] }))}><Plus style={{ width: 14, verticalAlign: '-2px' }} /> Add button</button>}
              </Card>
              <AutosaveNote status={setAutoStatus} />
            </>
          )}
          {tab === 'members' && (() => {
            const mq = memberQ.trim().toLowerCase();
            const shownUsers = usersList.filter(u => {
              const isAdm = !!(u.isAdmin || u.isOwner);
              if (memberRole === 'admins' && !isAdm) return false;
              if (memberRole === 'users' && isAdm) return false;
              if (mq && !((u.displayName || '').toLowerCase().includes(mq) || (u.email || '').toLowerCase().includes(mq))) return false;
              return true;
            });
            return (
              <>
                <div className="mem-toolbar">
                  <input className="mem-search" value={memberQ} onChange={(e) => setMemberQ(e.target.value)} placeholder="Search by name or email…" />
                  <div className="seg">
                    {[['all', `All (${usersList.length})`], ['admins', `Admins (${adminCount})`], ['users', `Users (${usersList.length - adminCount})`]].map(([v, l]) => (
                      <button key={v} className={memberRole === v ? 'on' : ''} onClick={() => setMemberRole(v)}>{l}</button>
                    ))}
                  </div>
                </div>
                {shownUsers.length === 0 && <div className="muted-note">No members match.</div>}
                {shownUsers.map(u => (
                  <div className="user-row" key={u.id}>
                    <div className="avatar">{(u.displayName || u.email)[0].toUpperCase()}</div>
                    <div className="u-main">
                      <div className="u-name">{u.displayName}{u.isOwner && <span className="badge">Top admin</span>}{u.twoFactor && <span className="badge" title="Two-factor enabled">2FA</span>}{u.id === user?.id && !u.isOwner && <span className="you-tag">you</span>}</div>
                      <div className="u-email">{u.email}{typeof u.monthSpend === 'number' && u.monthSpend > 0 ? ` · $${u.monthSpend.toFixed(u.monthSpend < 0.01 ? 4 : 2)} this month` : ''}</div>
                    </div>
                    <div className="u-budget" title="Monthly budget override ($). Blank uses the role default.">
                      <span className="u-budget-prefix">$</span>
                      <input type="number" min="0" step="any" placeholder="role default"
                        value={u.budget == null ? '' : u.budget}
                        onChange={(e) => setUsersList(us => us.map(x => x.id === u.id ? { ...x, budget: e.target.value === '' ? null : e.target.value } : x))}
                        onBlur={(e) => saveBudget(u.id, e.target.value)} />
                    </div>
                    {!u.isOwner && (
                      <div className="seg">
                        <button className={u.isAdmin ? '' : 'on'} onClick={() => setRole(u.id, false)}>User</button>
                        <button className={u.isAdmin ? 'on' : ''} onClick={() => setRole(u.id, true)}>Admin</button>
                      </div>
                    )}
                    {!u.isOwner && u.id !== user?.id && (
                      <button className="btn danger" onClick={() => removeUser(u.id)}><Trash style={{ width: 15 }} /></button>
                    )}
                  </div>
                ))}
              </>
            );
          })()}
          {tab === 'providers' && (
            <>
              <div className="provider-list">
                {providers.map((p, idx) => {
                  const t = providerTypes[p.type] || {};
                  const test = provTest[p.id];
                  return (
                    <Card key={p.id} className="provider-card2"
                      title={p.name || 'Provider ' + (idx + 1)}
                      sub={t.label || p.type}
                      right={test && !test.busy && (
                        test.ok
                          ? <span className="pv-status ok">Reachable · {test.count} model{test.count === 1 ? '' : 's'}</span>
                          : <span className="pv-status err">{test.err}</span>
                      )}>
                      <div className="two-col">
                        <div className="field"><label>Name</label>
                          <input value={p.name || ''} onChange={(e) => patchProvider(p.id, { name: e.target.value })} placeholder="My provider" /></div>
                        <div className="field"><label>Provider type</label>
                          <select value={p.type} onChange={(e) => patchProvider(p.id, { type: e.target.value })}>
                            {Object.entries(providerTypes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select></div>
                      </div>
                      <div className="field"><label>API base URL</label>
                        <input value={p.base_url || ''} onChange={(e) => patchProvider(p.id, { base_url: e.target.value })} placeholder={t.defaultBaseUrl || ''} /></div>
                      <div className="field"><label>API key {t.keyOptional && <span className="muted-note" style={{ display: 'inline' }}>(optional)</span>}</label>
                        <input value={p.api_key || ''} onChange={(e) => patchProvider(p.id, { api_key: e.target.value })} placeholder={t.keyOptional ? 'Not required for local servers' : 'Required'} /></div>
                      <div className="btn-row">
                        <button className="btn ghost" onClick={() => testProvider(p.id)} disabled={test?.busy}>{test?.busy ? 'Testing…' : 'Test connection'}</button>
                        <button className="btn ghost" onClick={() => openDiscover(p.id)}><Cube style={{ width: 13, verticalAlign: '-2px' }} /> Discover models</button>
                        <button className="btn danger" disabled={providers.length <= 1} onClick={() => deleteProvider(p.id)}><Trash style={{ width: 13 }} /></button>
                      </div>
                    </Card>
                  );
                })}
                <button className="btn add-model" onClick={addProvider}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> Add provider</button>
              </div>
            </>
          )}
          {tab === 'voice' && (
            <>
              <Card title="Features" sub="Both buttons disappear from the composer entirely when turned off.">
                <div className="field row">
                  <div><label>Microphone (dictation)</label><div className="muted-note">Adds a mic button to the input bar. Speech is transcribed into the message box, nothing sends until the user hits enter.</div></div>
                  <div className={'switch' + (settings.voiceMicEnabled ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, voiceMicEnabled: !s.voiceMicEnabled }))} />
                </div>
                <div className="field row" style={{ borderBottom: 0, marginBottom: 0 }}>
                  <div><label>Voice calls</label><div className="muted-note">Adds a call button that opens a hands-free voice conversation panel. Spoken turns are saved to the chat like typed messages, and replies are read aloud.</div></div>
                  <div className={'switch' + (settings.voiceCallEnabled ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, voiceCallEnabled: !s.voiceCallEnabled, voiceMicEnabled: !s.voiceCallEnabled ? true : s.voiceMicEnabled }))} />
                </div>
              </Card>
              {(settings.voiceMicEnabled || settings.voiceCallEnabled) && (
                <Card title="Speech-to-text" sub="How spoken audio becomes text.">
                  <div className="field"><label>Engine</label>
                    <div className="seg" style={{ width: 'fit-content' }}>
                      <button className={(settings.voiceSttEngine || 'browser') === 'browser' ? 'on' : ''} onClick={() => setSettings(s => ({ ...s, voiceSttEngine: 'browser' }))}>Browser built-in</button>
                      <button className={settings.voiceSttEngine === 'server' ? 'on' : ''} onClick={() => setSettings(s => ({ ...s, voiceSttEngine: 'server' }))}>Server (Whisper)</button>
                    </div>
                    <div className="muted-note">Browser uses Chrome's built-in speech recognition, zero setup, no audio leaves the machine beyond what the browser does. Server sends recorded audio to any OpenAI-compatible transcription endpoint: whisper.cpp's server, faster-whisper-server, Speaches, or OpenAI itself.</div>
                  </div>
                  {settings.voiceSttEngine === 'server' && <>
                    <div className="field"><label>Base URL</label>
                      <input value={settings.voiceSttUrl || ''} onChange={(e) => setSettings(s => ({ ...s, voiceSttUrl: e.target.value }))} placeholder="http://localhost:8000/v1" />
                      <div className="muted-note">The server calls <code>{'{base}'}/audio/transcriptions</code>. Keys never reach the browser.</div>
                    </div>
                    <div className="two-col">
                      <div className="field"><label>API key <span className="muted-note" style={{ display: 'inline' }}>(optional for local)</span></label>
                        <input value={settings.voiceSttKey || ''} onChange={(e) => setSettings(s => ({ ...s, voiceSttKey: e.target.value }))} placeholder="Not required for whisper.cpp" /></div>
                      <div className="field"><label>Model</label>
                        <input value={settings.voiceSttModel || ''} onChange={(e) => setSettings(s => ({ ...s, voiceSttModel: e.target.value }))} placeholder="whisper-1" /></div>
                    </div>
                  </>}
                </Card>
              )}
              {settings.voiceCallEnabled && (
                <Card title="Text-to-speech" sub="How replies are read aloud during calls.">
                  <div className="field"><label>Engine</label>
                    <div className="seg" style={{ width: 'fit-content' }}>
                      <button className={(settings.voiceTtsEngine || 'browser') === 'browser' ? 'on' : ''} onClick={() => setSettings(s => ({ ...s, voiceTtsEngine: 'browser' }))}>Browser built-in</button>
                      <button className={settings.voiceTtsEngine === 'server' ? 'on' : ''} onClick={() => setSettings(s => ({ ...s, voiceTtsEngine: 'server' }))}>Server (OpenAI-compatible)</button>
                    </div>
                    <div className="muted-note">Browser uses the operating system voices via Chrome, fully local, zero setup. Server sends text to any OpenAI-compatible <code>/audio/speech</code> endpoint: openedai-speech, Kokoro-FastAPI, Piper wrappers, or OpenAI.</div>
                  </div>
                  {settings.voiceTtsEngine === 'server' && <>
                    <div className="field"><label>Base URL</label>
                      <input value={settings.voiceTtsUrl || ''} onChange={(e) => setSettings(s => ({ ...s, voiceTtsUrl: e.target.value }))} placeholder="http://localhost:8880/v1" /></div>
                    <div className="two-col">
                      <div className="field"><label>API key <span className="muted-note" style={{ display: 'inline' }}>(optional for local)</span></label>
                        <input value={settings.voiceTtsKey || ''} onChange={(e) => setSettings(s => ({ ...s, voiceTtsKey: e.target.value }))} placeholder="Not required for local servers" /></div>
                      <div className="field"><label>Model</label>
                        <input value={settings.voiceTtsModel || ''} onChange={(e) => setSettings(s => ({ ...s, voiceTtsModel: e.target.value }))} placeholder="tts-1" /></div>
                    </div>
                  </>}
                  <div className="two-col">
                    <div className="field"><label>Voice</label>
                      <input value={settings.voiceTtsVoice || ''} onChange={(e) => setSettings(s => ({ ...s, voiceTtsVoice: e.target.value }))} placeholder={settings.voiceTtsEngine === 'server' ? 'alloy' : 'e.g. Google US English'} />
                      <div className="muted-note">{settings.voiceTtsEngine === 'server' ? 'The voice name sent to the endpoint (e.g. alloy, af_bella for Kokoro).' : 'Matched against the browser\u2019s installed voice names. Leave blank for the system default.'}</div>
                    </div>
                    <div className="field"><label>Speed</label>
                      <input type="number" min="0.25" max="4" step="0.05" value={settings.voiceTtsSpeed ?? 1} onChange={(e) => setSettings(s => ({ ...s, voiceTtsSpeed: e.target.value }))} placeholder="1" /></div>
                  </div>
                </Card>
              )}
              <AutosaveNote status={setAutoStatus} live />
            </>
          )}
          {tab === 'safety' && (
            <>
              <Card title="Safety model" sub="Every prompt is screened by a model before it reaches the assistant. Flagged prompts are blocked and the user is asked to revise them.">
                <div className="field row" style={settings.safetyEnabled ? {} : { borderBottom: 0, marginBottom: 0 }}>
                  <div><label>Enable safety checks</label><div className="muted-note">When on, user prompts are sent to the safety model first. If it answers No, the prompt never reaches the assistant and a banner appears in the input bar.</div></div>
                  <div className={'switch' + (settings.safetyEnabled ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, safetyEnabled: !s.safetyEnabled }))} />
                </div>
                {settings.safetyEnabled && (
                  <div className="field row">
                    <div><label>Verbose</label><div className="muted-note">Shows a "Safety check…" status in the input bar while the prompt is being screened. When off, the check runs silently in the background.</div></div>
                    <div className={'switch' + (settings.safetyVerbose ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, safetyVerbose: !s.safetyVerbose }))} />
                  </div>
                )}
                {settings.safetyEnabled && (
                  <div className="field row" style={{ borderBottom: 0, marginBottom: 0 }}>
                    <div><label>Show a reason</label><div className="muted-note">Lets the safety model include a short explanation of why a prompt was blocked, shown in the banner instead of the generic message. The reason instruction is appended to the system prompt below, so your edits are kept.</div></div>
                    <div className={'switch' + (settings.safetyReasonEnabled ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, safetyReasonEnabled: !s.safetyReasonEnabled }))} />
                  </div>
                )}
              </Card>
              {settings.safetyEnabled && (
                <Card title="Model" sub="Which model performs the screening.">
                  <div className="field"><label>Checked by</label>
                    <div className="seg" style={{ width: 'fit-content' }}>
                      <button className={(settings.safetyModelMode || 'current') === 'current' ? 'on' : ''} onClick={() => setSettings(s => ({ ...s, safetyModelMode: 'current' }))}>Currently loaded model</button>
                      <button className={settings.safetyModelMode === 'specific' ? 'on' : ''} onClick={() => setSettings(s => ({ ...s, safetyModelMode: 'specific' }))}>Specific model</button>
                    </div>
                    <div className="muted-note">Currently loaded uses whatever model the user is chatting with. Specific always routes the check through one dedicated model.</div>
                  </div>
                  {settings.safetyModelMode === 'specific' && (
                    <div className="field"><label>Safety model</label>
                      <select value={settings.safetyModelId || ''} onChange={(e) => setSettings(s => ({ ...s, safetyModelId: e.target.value }))}>
                        <option value="">Select a model…</option>
                        {models.map(m => <option key={m.id} value={m.id}>{m.display_name || m.internal_name}</option>)}
                      </select>
                      <div className="muted-note">If the selected model is removed, checks fall back to the currently loaded model.</div>
                    </div>
                  )}
                </Card>
              )}
              <Card title="Safety log" sub={`Prompts the safety model blocked${safetyLogTotal ? `, ${safetyLogTotal} total` : ''}. Use these to tune the system prompt and catch false positives.`}
                right={safetyLog && safetyLog.length ? <button className="btn ghost danger" onClick={clearSafetyLog}>Clear log</button> : null}>
                {safetyLog == null && <div className="muted-note">Loading…</div>}
                {safetyLog != null && safetyLog.length === 0 && <div className="muted-note">Nothing has been flagged yet.</div>}
                {(safetyLog || []).map(e => (
                  <div key={e.id} className="fn-card fb-card" style={{ marginBottom: 8 }}>
                    <div className="fb-rating down"><Shield style={{ width: 15 }} /></div>
                    <div className="fn-card-main">
                      <div className="fn-card-title">{e.user} <span className="muted-note" style={{ display: 'inline' }}>· {e.model} · {new Date(e.ts).toLocaleString()}</span></div>
                      <div className="fn-card-desc">{e.snippet || '(empty prompt)'}</div>
                      {e.reason && <div className="fn-card-desc" style={{ fontStyle: 'italic' }}>Reason: {e.reason}</div>}
                    </div>
                  </div>
                ))}
              </Card>
              {settings.safetyEnabled && (
                <Card title="System prompt" sub="The instructions sent to the safety model along with the user's prompt.">
                  <div className="field"><label>Prompt</label>
                    <textarea rows={7} value={settings.safetyPrompt ?? ''} onChange={(e) => setSettings(s => ({ ...s, safetyPrompt: e.target.value }))} />
                    <div className="muted-note">The model must reply with JSON only, e.g. <code>{'{"verdict":"Yes"}'}</code> to allow or <code>{'{"verdict":"No"}'}</code> to block. Clearing the field restores the default prompt.{settings.safetyReasonEnabled ? <> With reasons on, an instruction asking for <code>{'{"verdict":"No","reason":"…"}'}</code> is appended on a new line automatically.</> : null}</div>
                  </div>
                </Card>
              )}
              <AutosaveNote status={setAutoStatus} live />
            </>
          )}
          {tab === 'memory' && (
            <>
              <Card title="User memory" sub="Each user gets a compact long-term memory built from their own chats. Users can view, edit, disable, or clear it in Settings → Memory.">
                <div className="field row">
                  <div><label>Enable user memory</label><div className="muted-note">When on, memory is injected into the system prompt for users who keep it enabled, and refreshed in the background at most every few hours using the model they are chatting with.</div></div>
                  <div className={'switch' + (settings.memoryEnabled ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, memoryEnabled: !s.memoryEnabled }))} />
                </div>
                {settings.memoryEnabled && (
                  <div className="field" style={{ borderBottom: 0, marginBottom: 0 }}><label>Memory update prompt</label>
                    <textarea rows={6} value={settings.memoryPrompt ?? ''} onChange={(e) => setSettings(s => ({ ...s, memoryPrompt: e.target.value }))} />
                    <div className="muted-note">The instructions used when the model rewrites a user's memory from recent conversations. Clearing the field restores the default.</div>
                  </div>
                )}
              </Card>
              <Card title="Past-chat search" sub="Gives models chat_search and chat_view tools to look things up in the user's own previous conversations.">
                <div className="field row" style={{ borderBottom: 0, marginBottom: 0 }}>
                  <div><label>Enable chat history search</label><div className="muted-note">Only the requesting user's chats are searchable, and never the conversation currently in progress. Requires a model with tool calling.</div></div>
                  <div className={'switch' + (settings.chatSearchEnabled ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, chatSearchEnabled: !s.chatSearchEnabled }))} />
                </div>
              </Card>
              <AutosaveNote status={setAutoStatus} live />
            </>
          )}
          {tab === 'skills' && (
            <>
              <div className="admin-section-head">
                <div><div className="muted-note">Skills are markdown instruction files listed in the system prompt. When a task matches a skill's description, the model loads it with <code>skill_view</code> and follows it. Offered to any model with tool calling.</div></div>
                <button className="btn primary" onClick={() => setSkillEdit({ name: '', description: '', content: '', enabled: true })}><Plus style={{ width: 15 }} /> New skill</button>
              </div>
              {skillEdit && (
                <div className="fn-editor">
                  <div className="field"><label>Skill name</label>
                    <input value={skillEdit.name} onChange={(e) => setSkillEdit(x => ({ ...x, name: e.target.value }))} placeholder="brand-voice" />
                    <div className="muted-note">Lowercase letters, digits, hyphens. This is the name the model loads.</div>
                  </div>
                  <div className="field"><label>Description</label>
                    <input value={skillEdit.description} onChange={(e) => setSkillEdit(x => ({ ...x, description: e.target.value }))} placeholder="How to write copy in our brand voice. Load before writing any marketing text." />
                    <div className="muted-note">Shown in the system prompt, tell the model exactly WHEN to load this skill.</div>
                  </div>
                  <div className="field"><label>Content</label>
                    <textarea className="code-area" rows={14} value={skillEdit.content} onChange={(e) => setSkillEdit(x => ({ ...x, content: e.target.value }))} spellCheck={false} placeholder={'# Brand voice\n\nAlways…'} />
                    <div className="muted-note">Markdown works well. The full content is returned to the model when it loads the skill.</div>
                  </div>
                  <div className="me2-toggle-card">
                    <label className="inline-toggle"><span>Enabled</span><div className={'switch' + (skillEdit.enabled ? ' on' : '')} onClick={() => setSkillEdit(x => ({ ...x, enabled: !x.enabled }))} /></label>
                  </div>
                  <div className="editor-actions">
                    <button className="btn" onClick={() => setSkillEdit(null)}>Cancel</button>
                    <button className="btn primary" onClick={() => saveSkill(skillEdit)}>Save skill</button>
                  </div>
                </div>
              )}
              <div className="fn-list">
                {skills.length === 0 && !skillEdit && <div className="muted-note">No skills yet.</div>}
                {skills.map(sk => (
                  <div key={sk.id} className="fn-card">
                    <div className="fn-card-main">
                      <div className="fn-card-title"><Bulb style={{ width: 15 }} /> <code>{sk.name}</code> <span className="muted-note" style={{ display: 'inline' }}>{(sk.content || '').split('\n').length} lines</span></div>
                      <div className="fn-card-desc">{sk.description || 'No description.'}</div>
                    </div>
                    <div className="fn-card-actions">
                      <div className={'switch' + (sk.enabled ? ' on' : '')} title="Enabled" onClick={() => toggleSkill(sk)} />
                      <button className="icon-btn" onClick={() => setSkillEdit({ ...sk })}><Pencil style={{ width: 15 }} /></button>
                      <button className="icon-btn" onClick={() => deleteSkill(sk.id)}><Trash style={{ width: 15 }} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === 'mcp' && (
            <>
              <div className="admin-section-head">
                <div><div className="muted-note">Connect MCP (Model Context Protocol) servers running on this machine or your network. Their tools are exposed to every model with tool calling, prefixed <code>mcp_</code>. Everything stays local, no cloud relay is involved.</div></div>
                <button className="btn primary" onClick={() => setMcpEdit({ name: '', transport: 'stdio', command: '', args: '', url: '', headers: '', enabled: true })}><Plus style={{ width: 15 }} /> Add server</button>
              </div>
              {mcpEdit && (
                <div className="fn-editor">
                  <div className="field"><label>Server name</label>
                    <input value={mcpEdit.name} onChange={(e) => setMcpEdit(x => ({ ...x, name: e.target.value }))} placeholder="Filesystem" />
                  </div>
                  <div className="field"><label>Transport</label>
                    <div className="seg" style={{ width: 'fit-content' }}>
                      <button className={mcpEdit.transport !== 'http' ? 'on' : ''} onClick={() => setMcpEdit(x => ({ ...x, transport: 'stdio' }))}>stdio (local command)</button>
                      <button className={mcpEdit.transport === 'http' ? 'on' : ''} onClick={() => setMcpEdit(x => ({ ...x, transport: 'http' }))}>HTTP</button>
                    </div>
                  </div>
                  {mcpEdit.transport !== 'http' && (
                    <>
                      <div className="field"><label>Command</label>
                        <input value={mcpEdit.command} onChange={(e) => setMcpEdit(x => ({ ...x, command: e.target.value }))} placeholder="npx" />
                      </div>
                      <div className="field"><label>Arguments</label>
                        <input value={mcpEdit.args} onChange={(e) => setMcpEdit(x => ({ ...x, args: e.target.value }))} placeholder="-y @modelcontextprotocol/server-filesystem /home/me/docs" />
                        <div className="muted-note">The command is spawned by this server and speaks MCP over stdio.</div>
                      </div>
                    </>
                  )}
                  {mcpEdit.transport === 'http' && (
                    <>
                      <div className="field"><label>URL</label>
                        <input value={mcpEdit.url} onChange={(e) => setMcpEdit(x => ({ ...x, url: e.target.value }))} placeholder="http://localhost:8931/mcp" />
                      </div>
                      <div className="field"><label>Headers</label>
                        <textarea rows={2} value={mcpEdit.headers} onChange={(e) => setMcpEdit(x => ({ ...x, headers: e.target.value }))} placeholder={'Authorization: Bearer …'} />
                        <div className="muted-note">Optional, one <code>Name: value</code> per line.</div>
                      </div>
                    </>
                  )}
                  <div className="me2-toggle-card">
                    <label className="inline-toggle"><span>Enabled</span><div className={'switch' + (mcpEdit.enabled ? ' on' : '')} onClick={() => setMcpEdit(x => ({ ...x, enabled: !x.enabled }))} /></label>
                  </div>
                  <div className="editor-actions">
                    <button className="btn" onClick={() => setMcpEdit(null)}>Cancel</button>
                    <button className="btn primary" onClick={() => saveMcp(mcpEdit)}>Save server</button>
                  </div>
                </div>
              )}
              <div className="fn-list">
                {mcpServers.length === 0 && !mcpEdit && <div className="muted-note">No MCP servers yet.</div>}
                {mcpServers.map(sv => (
                  <div key={sv.id} className="fn-card">
                    <div className="fn-card-main">
                      <div className="fn-card-title">
                        <Plug style={{ width: 15 }} /> {sv.name}
                        <span className={'mcp-status ' + (sv.status || 'new')}>{sv.status === 'connected' ? `${(sv.tools || []).length} tool${(sv.tools || []).length === 1 ? '' : 's'}` : sv.status === 'error' ? 'error' : 'not connected'}</span>
                      </div>
                      <div className="fn-card-desc">
                        {sv.transport === 'http' ? sv.url : `${sv.command} ${sv.args || ''}`.trim()}
                        {sv.status === 'error' && sv.error ? `, ${sv.error}` : ''}
                        {sv.status === 'connected' && (sv.tools || []).length ? `, ${(sv.tools || []).map(t => t.name).slice(0, 6).join(', ')}${(sv.tools || []).length > 6 ? '…' : ''}` : ''}
                      </div>
                    </div>
                    <div className="fn-card-actions">
                      <button className="icon-btn" title="Reconnect and refresh tools" disabled={mcpBusy === sv.id} onClick={() => refreshMcp(sv.id)}><Refresh style={{ width: 15, opacity: mcpBusy === sv.id ? .4 : 1 }} /></button>
                      <div className={'switch' + (sv.enabled ? ' on' : '')} title="Enabled" onClick={() => toggleMcp(sv)} />
                      <button className="icon-btn" onClick={() => setMcpEdit({ ...sv })}><Pencil style={{ width: 15 }} /></button>
                      <button className="icon-btn" onClick={() => deleteMcp(sv.id)}><Trash style={{ width: 15 }} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === 'feedback' && (
            <>
              <div className="admin-section-head">
                <div><div className="muted-note">Ratings users left on assistant responses. Use them to spot weak prompts, tune the safety model, or compare models.</div></div>
                <div className="fb-totals">
                  <span className="fb-total up"><ThumbUp style={{ width: 14 }} /> {fbCounts.up}</span>
                  <span className="fb-total down"><ThumbDown style={{ width: 14 }} /> {fbCounts.down}</span>
                </div>
              </div>
              <div className="fn-list">
                {fbRows == null && <div className="muted-note">Loading…</div>}
                {fbRows != null && fbRows.length === 0 && <div className="muted-note">No feedback yet.</div>}
                {(fbRows || []).map(f => (
                  <div key={f.id} className="fn-card fb-card">
                    <div className={'fb-rating ' + (f.rating === 1 ? 'up' : 'down')}>{f.rating === 1 ? <ThumbUp style={{ width: 15 }} /> : <ThumbDown style={{ width: 15 }} />}</div>
                    <div className="fn-card-main">
                      <div className="fn-card-title">{f.user} <span className="muted-note" style={{ display: 'inline' }}>· {f.model} · {new Date(f.ts).toLocaleString()}</span></div>
                      <div className="fn-card-desc">{f.snippet || '(empty response)'}</div>
                      {f.comment && <div className="fn-card-desc" style={{ fontStyle: 'italic' }}>“{f.comment}”</div>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="editor-actions" style={{ justifyContent: 'flex-start' }}>
                <button className="btn" disabled={fbOffset === 0} onClick={() => loadFeedback(Math.max(0, fbOffset - 50))}>Newer</button>
                <button className="btn" disabled={(fbRows || []).length < 50} onClick={() => loadFeedback(fbOffset + 50)}>Older</button>
              </div>
            </>
          )}
          {tab === 'limits' && (
            <>
              <Card title="Attachments & storage" sub="Per-role ceilings for what people can upload and keep. 0 = unlimited.">
                <div className="field"><label>Upload size limit (MB)</label>
                  <div className="muted-note">Max size for files attached to messages, per role.</div>
                  <div className="two-col">
                    <div className="field"><label className="sub">Admins</label>
                      <input type="number" min="0" step="1" value={settings.uploadLimitAdminMb ?? 8} onChange={(e) => setSettings(s => ({ ...s, uploadLimitAdminMb: e.target.value }))} placeholder="8" /></div>
                    <div className="field"><label className="sub">Users</label>
                      <input type="number" min="0" step="1" value={settings.uploadLimitUserMb ?? 8} onChange={(e) => setSettings(s => ({ ...s, uploadLimitUserMb: e.target.value }))} placeholder="8" /></div>
                  </div></div>
                <div className="field" style={{ marginBottom: 0 }}><label>Sandbox storage limit (MB)</label>
                  <div className="muted-note">Max total size of a chat's sandbox files, per role. Writes beyond it are rejected.</div>
                  <div className="two-col">
                    <div className="field"><label className="sub">Admins</label>
                      <input type="number" min="0" step="1" value={settings.sandboxLimitAdminMb ?? 1024} onChange={(e) => setSettings(s => ({ ...s, sandboxLimitAdminMb: e.target.value }))} placeholder="1024" /></div>
                    <div className="field"><label className="sub">Users</label>
                      <input type="number" min="0" step="1" value={settings.sandboxLimitUserMb ?? 256} onChange={(e) => setSettings(s => ({ ...s, sandboxLimitUserMb: e.target.value }))} placeholder="256" /></div>
                  </div></div>
              </Card>
              <Card title="Request queue" sub="Keep small local servers from thrashing between models.">
                <div className="field row" style={{ borderBottom: 0, marginBottom: 0 }}>
                  <div><label>Model queue</label><div className="muted-note">Only one model runs at a time. Requests for the same model run together; a request for a different model waits until the current one finishes, instead of swapping it out mid-response.</div></div>
                  <div className={'switch' + (settings.modelQueue ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, modelQueue: !s.modelQueue }))} /></div>
              </Card>
              <Card title="Usage budgets" sub="Monthly spend caps based on per-model pricing. Per-member overrides live in the Members section. Set 0 for no limit.">
                <div className="two-col">
                  <div className="field"><label className="sub">Default user budget ($ / month)</label>
                    <input type="number" min="0" step="any" value={settings.budgetUser ?? 0} onChange={(e) => setSettings(s => ({ ...s, budgetUser: e.target.value }))} placeholder="0" /></div>
                  <div className="field"><label className="sub">Default admin budget ($ / month)</label>
                    <input type="number" min="0" step="any" value={settings.budgetAdmin ?? 0} onChange={(e) => setSettings(s => ({ ...s, budgetAdmin: e.target.value }))} placeholder="0" /></div>
                </div>
                <div className="field"><label className="sub">Warn at</label>
                  <div className="muted-note">Show the warning banner once this fraction of the budget is used.</div>
                  <input type="number" min="0.1" max="0.99" step="0.05" value={settings.budgetWarnFraction ?? 0.8} onChange={(e) => setSettings(s => ({ ...s, budgetWarnFraction: e.target.value }))} placeholder="0.8" /></div>
                <div className="field row" style={{ borderBottom: 0, marginBottom: 0 }}>
                  <div><label>Enforce budget</label><div className="muted-note">When on, users at or over their cap cannot send new messages until next month. When off, the banner is informational only. Admins are never blocked.</div></div>
                  <div className={'switch' + (settings.budgetEnforce ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, budgetEnforce: !s.budgetEnforce }))} /></div>
              </Card>
              <Card title="Sessions" sub="How long sign-ins live and how many each person may hold.">
                <div className="two-col">
                  <div className="field"><label className="sub">Session lifetime (days)</label>
                    <div className="muted-note">Sessions expire after this many days of inactivity. Activity resets the timer.</div>
                    <input type="number" min="1" max="365" step="1" value={settings.sessionTtlDays ?? 30} onChange={(e) => setSettings(s => ({ ...s, sessionTtlDays: e.target.value }))} placeholder="30" /></div>
                  <div className="field"><label className="sub">Max sessions per user</label>
                    <div className="muted-note">Oldest sessions are signed out beyond this. 0 = unlimited.</div>
                    <input type="number" min="0" max="50" step="1" value={settings.maxSessions ?? 0} onChange={(e) => setSettings(s => ({ ...s, maxSessions: e.target.value }))} placeholder="0" /></div>
                </div>
              </Card>
              <AutosaveNote status={setAutoStatus} live />
            </>
          )}
          {tab === 'websearch' && (
            <>
              <Card title="Engine" sub="Turn the tool on and point it at your search backend.">
                <div className="field row">
                  <div><label>Enable web search</label><div className="muted-note">When on, users get a Web Search toggle in the + menu. The model can call the tool whenever it's enabled for a chat.</div></div>
                  <div className={'switch' + (settings.webSearchEnabled ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, webSearchEnabled: !s.webSearchEnabled }))} />
                </div>
                {settings.webSearchEnabled && <>
                  <div className="field"><label>Search engine</label>
                    <select value={settings.webSearchEngine || 'searxng'} onChange={(e) => setSettings(s => ({ ...s, webSearchEngine: e.target.value }))}>
                      <option value="searxng">SearXNG</option>
                    </select>
                  </div>
                  {(settings.webSearchEngine || 'searxng') === 'searxng' && (
                    <div className="field" style={{ marginBottom: 0 }}><label>SearXNG query URL</label>
                      <input value={settings.searxngUrl || ''} onChange={(e) => setSettings(s => ({ ...s, searxngUrl: e.target.value }))} placeholder="http://localhost:8888" />
                      <div className="muted-note">Base URL of your SearXNG instance. The server calls <code>/search?q=…&amp;format=json</code>, so JSON output must be enabled in your SearXNG settings.</div>
                    </div>
                  )}
                </>}
              </Card>
              {settings.webSearchEnabled && <>
                <Card title="Results & scope" sub="How much the assistant reads, and from where.">
                  <div className="field"><label>Result count limit</label>
                    <input type="number" min="1" max="20" value={settings.webSearchCount ?? 5} onChange={(e) => setSettings(s => ({ ...s, webSearchCount: e.target.value }))} style={{ maxWidth: 140 }} />
                    <div className="muted-note">How many result pages to fetch and read per search (1–20). Higher means more context but slower and heavier.</div>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}><label>Allowed domains</label>
                    <textarea rows={3} value={settings.webSearchDomains || ''} onChange={(e) => setSettings(s => ({ ...s, webSearchDomains: e.target.value }))} placeholder={'wikipedia.org\narxiv.org'} />
                    <div className="muted-note">One domain per line (or comma-separated). When set, the assistant can only read results from these domains and their subdomains, everything else is dropped. Leave empty to allow any site.</div>
                  </div>
                </Card>
                <Card title="Search prompt" sub="Guidance the model receives whenever web search is on.">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <textarea rows={6} value={settings.webSearchPrompt ?? ''} onChange={(e) => setSettings(s => ({ ...s, webSearchPrompt: e.target.value }))} />
                    <div className="muted-note">Appended to a model's system prompt only when web search is enabled for the chat. Use it to tell the model to search only when asked or when information is missing or outdated.</div>
                  </div>
                </Card>
              </>}
              <AutosaveNote status={setAutoStatus} live />
            </>
          )}
          {tab === 'membank' && (
            <>
              <Card title="Behavior" sub="How and when models reach for these files.">
                <div className="field row">
                  <div><label>Enable memory bank</label><div className="muted-note">When on, all models receive a system-prompt section listing these files plus the <code>mb_view</code> and <code>mb_search</code> tools.</div></div>
                  <div className={'switch' + (settings.membankEnabled ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, membankEnabled: !s.membankEnabled }))} />
                </div>
                <div className="field row">
                  <div><label>Hide tool calls from users</label><div className="muted-note">When on, file reads stay behind the scenes, the model still uses the files, but users won't see the <code>mb_view</code> / <code>mb_search</code> steps in the reply.</div></div>
                  <div className={'switch' + (settings.membankHideTools ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, membankHideTools: !s.membankHideTools }))} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>System prompt</label>
                  <textarea rows={5} value={settings.membankPrompt ?? ''} onChange={(e) => setSettings(s => ({ ...s, membankPrompt: e.target.value }))} />
                  <div className="muted-note">Intro text added above the file list when the memory bank is enabled. The file names and tool instructions are appended automatically.</div>
                </div>
              </Card>
              <Card title="Files" sub="Text and PDF files work best (.md, .txt, .json, .pdf, code, etc.). PDFs are read as extracted text. Up to 25 MB each."
                right={<button className="btn" onClick={() => membankRef.current?.click()}>Upload files</button>}>
                <input ref={membankRef} type="file" multiple hidden onChange={onMembankPick} />
                <div className="muted-note">Drag the handle to reorder or move files between folders. Type a folder name to group files; clear it to leave a file ungrouped.</div>
                <datalist id="mb-folders">{[...new Set(membankFiles.map(f => f.folder).filter(Boolean))].map(fo => <option key={fo} value={fo} />)}</datalist>
                <div style={{ marginTop: 12 }}>
                  {membankFiles.length === 0 ? <div className="muted-note">No files yet.</div> : (() => {
                    const groups = []; const seen = new Map();
                    for (const f of membankFiles) { const k = f.folder || ''; if (!seen.has(k)) { seen.set(k, { folder: k, files: [] }); groups.push(seen.get(k)); } seen.get(k).files.push(f); }
                    return groups.map(g => (
                      <div key={g.folder || '__none'} className="mb-group">
                        <div className="mb-group-head">{g.folder ? g.folder : 'Ungrouped'}</div>
                        {g.files.map(f => {
                          const editing = mbEdit === f.name;
                          return (
                            <div key={f.name} className={'mb-file-row' + (mbDrag === f.name ? ' dragging' : '')}
                              onDragOver={(e) => e.preventDefault()} onDrop={() => onMbDrop(f)}>
                              <span className="mb-drag" draggable onDragStart={() => setMbDrag(f.name)} onDragEnd={() => setMbDrag(null)} title="Drag to reorder / move">⋮⋮</span>
                              <FileText style={{ width: 16, flexShrink: 0, opacity: 0.7 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                {editing ? (
                                  <input autoFocus value={mbEditName} onChange={(e) => setMbEditName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') saveMbRename(f.name); if (e.key === 'Escape') { setMbEdit(null); setMbErr(''); } }}
                                    style={{ width: '100%' }} />
                                ) : (
                                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                                )}
                                <div className="muted-note">{f.readable ? `${(f.lines || 0).toLocaleString()} lines · ${(f.size || 0).toLocaleString()} bytes` : `${(f.size || 0).toLocaleString()} bytes · not readable as text`}</div>
                                {editing && mbErr && <div className="dz-err" style={{ marginTop: 4 }}>{mbErr}</div>}
                              </div>
                              {editing ? (
                                <>
                                  <button className="btn" style={{ flexShrink: 0 }} onClick={() => saveMbRename(f.name)}>Save</button>
                                  <button className="btn ghost" style={{ flexShrink: 0 }} onClick={() => { setMbEdit(null); setMbErr(''); }}>Cancel</button>
                                </>
                              ) : (
                                <>
                                  <input className="mb-folder-input" list="mb-folders" placeholder="folder" defaultValue={f.folder || ''}
                                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (f.folder || '')) setMbFolder(f.name, v); }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
                                  <button className="btn ghost" title="Rename" style={{ flexShrink: 0 }} onClick={() => { setMbEdit(f.name); setMbEditName(f.name); setMbErr(''); }}><Pencil style={{ width: 14 }} /></button>
                                  <button className="btn danger" title="Remove" style={{ flexShrink: 0 }} onClick={() => removeMembank(f.name)}><Trash style={{ width: 15 }} /></button>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </div>
              </Card>
              <AutosaveNote status={setAutoStatus} live />
            </>
          )}
          {tab === 'audit' && (
            <>
              <div className="hint">{audit.total > 0 ? `Showing ${audit.entries.length} of ${audit.total} entries.` : ''}</div>
              <div className="audit-filters">
                <select value={auditFilter.action} onChange={(e) => { const action = e.target.value; setAuditFilter(f => ({ ...f, action })); loadAudit(0, { ...auditFilter, action }); }}>
                  <option value="">All actions</option>
                  {(audit.actions || []).map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <input placeholder="Filter by actor email" value={auditFilter.actor}
                  onChange={(e) => setAuditFilter(f => ({ ...f, actor: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadAudit(0); }} />
                <select value={auditFilter.days} onChange={(e) => { const days = e.target.value; setAuditFilter(f => ({ ...f, days })); loadAudit(0, { ...auditFilter, days }); }}>
                  <option value="">Any time</option>
                  <option value="1">Last 24h</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                </select>
                <button className="btn ghost" onClick={() => loadAudit(0)}>Apply</button>
                <button className="btn ghost" onClick={() => { window.location.href = '/api/admin/audit/export'; }}><Download style={{ width: 14, verticalAlign: '-2px' }} /> Export CSV</button>
              </div>
              {audit.entries.length === 0 && !audit.loading && <div className="muted-note">No audit entries match.</div>}
              {audit.entries.length > 0 && (
                <div className="audit-list">
                  {audit.entries.map(e => (
                    <div key={e.id} className="audit-row">
                      <span className="au-ts">{new Date(e.ts).toLocaleString()}</span>
                      <span className="au-action">{e.action}</span>
                      <span className="au-meta">
                        {e.actorEmail}{e.meta ? ' · ' + (typeof e.meta === 'object' ? Object.entries(e.meta).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') : v}`).join(', ') : String(e.meta)) : ''}
                      </span>
                      {e.ip && <span className="au-ip">{e.ip}</span>}
                    </div>
                  ))}
                  {audit.hasMore && <button className="btn ghost audit-more" disabled={audit.loading} onClick={() => loadAudit(audit.offset + 60)}>{audit.loading ? 'Loading…' : 'Load more'}</button>}
                </div>
              )}
            </>
          )}
          {tab === 'analytics' && (
            <>
              <div className="seg" style={{ width: 'fit-content', marginBottom: 14 }}>
                {[['7', '7 days'], ['30', '30 days'], ['90', '90 days']].map(([v, l]) => (
                  <button key={v} className={adminUsageDays === v ? 'on' : ''} onClick={() => { setAdminUsageDays(v); loadAdminUsage(v); }}>{l}</button>
                ))}
              </div>
              {!adminUsage && <div className="muted-note">Loading…</div>}
              {adminUsage && (
                <>
                  <div className="stat-grid">
                    {[['Total tokens', adminUsage.totals.total.toLocaleString()], ['Est. cost', '$' + adminUsage.totals.cost.toFixed(2)], ['Generations', adminUsage.totals.generations.toLocaleString()], ['Active users', String(adminUsage.totals.users)]].map(([l, v]) => (
                      <div key={l} className="stat-card">
                        <div className="sc-v">{v}</div>
                        <div className="sc-l">{l}</div>
                      </div>
                    ))}
                  </div>
                  {adminUsage.users.length > 0 && (
                    <Card title="By user">
                      <table className="admin-table">
                        <thead><tr><th>User</th><th className="num">Tokens</th><th className="num">Cost</th></tr></thead>
                        <tbody>{adminUsage.users.slice(0, 30).map(u => (
                          <tr key={u.userId}>
                            <td>{u.name}</td>
                            <td className="num">{(u.prompt + u.completion).toLocaleString()}</td>
                            <td className="num">{u.cost ? '$' + u.cost.toFixed(u.cost < 0.01 ? 4 : 2) : ', '}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </Card>
                  )}
                  {adminUsage.models.length > 0 && (
                    <Card title="By model">
                      <table className="admin-table">
                        <thead><tr><th>Model</th><th className="num">Tokens</th><th className="num">Cost</th></tr></thead>
                        <tbody>{adminUsage.models.slice(0, 30).map(m => (
                          <tr key={m.modelId}>
                            <td>{m.name}</td>
                            <td className="num">{(m.prompt + m.completion).toLocaleString()}</td>
                            <td className="num">{m.cost ? '$' + m.cost.toFixed(m.cost < 0.01 ? 4 : 2) : ', '}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </Card>
                  )}
                </>
              )}
              <Card title="Custom price presets" sub={'Add house models or override built-in prices. When a model\u2019s ID contains one of these fragments, its price is suggested automatically. Built-in presets (GPT, Claude, Gemini, and so on) always apply unless overridden here.'}>
                {customPresets.length > 0 && customPresets.map(p => (
                  <div key={p.match} className="field row" style={{ alignItems: 'center' }}>
                    <div><label>{p.label}</label><div className="muted-note">matches "{p.match}" · ${p.in} in / ${p.out} out per 1M</div></div>
                    <button className="btn danger" onClick={() => delPreset(p.match)}><Trash style={{ width: 14 }} /></button>
                  </div>
                ))}
                <div className="preset-form">
                  <input placeholder="my-model" value={presetForm.match} onChange={(e) => setPresetForm(f => ({ ...f, match: e.target.value }))} />
                  <input placeholder="Label" value={presetForm.label} onChange={(e) => setPresetForm(f => ({ ...f, label: e.target.value }))} />
                  <input type="number" step="any" min="0" placeholder="$ in" value={presetForm.in} onChange={(e) => setPresetForm(f => ({ ...f, in: e.target.value }))} />
                  <input type="number" step="any" min="0" placeholder="$ out" value={presetForm.out} onChange={(e) => setPresetForm(f => ({ ...f, out: e.target.value }))} />
                  <button className="btn" onClick={addPreset}><Plus style={{ width: 14, verticalAlign: '-2px' }} /> Add</button>
                </div>
                {presetErr && <div className="dz-err" style={{ marginTop: 8 }}>{presetErr}</div>}
              </Card>
            </>
          )}
        </div>
      </div>
      {discover && (
        <div className="overlay sp-overlay" onMouseDown={(e) => e.target.classList.contains('sp-overlay') && setDiscover(null)}>
          <div className="sp-modal" style={{ maxHeight: '80vh' }}>
            <div className="sp-head">
              <div>
                <h3>Discover models</h3>
                <div className="muted-note">Models your backend currently exposes. Add the ones you want, added models can be hidden or deleted like any other.</div>
              </div>
              <button className="modal-close" style={{ position: 'static' }} onClick={() => setDiscover(null)}>✕</button>
            </div>
            <div className="discover-list">
              {discover.loading && <div className="muted-note" style={{ padding: 14 }}>Reaching the backend…</div>}
              {discover.error && <div className="dz-err">{discover.error}</div>}
              {!discover.loading && !discover.error && discover.list.length === 0 && <div className="muted-note" style={{ padding: 14 }}>No models returned by the backend.</div>}
              {discover.list.map(x => (
                <div key={x.id} className="discover-row">
                  <span className="discover-id">{x.id}</span>
                  {x.added
                    ? <span className="discover-added">Added ✓</span>
                    : <button className="btn" disabled={x.busy} onClick={() => addDiscovered(x.id)}>{x.busy ? 'Adding…' : 'Add'}</button>}
                </div>
              ))}
            </div>
            <div className="sp-foot">
              <button className="btn ghost" onClick={() => openDiscover(discover.providerId)} disabled={discover.loading}>Refresh</button>
              <button className="btn primary" onClick={() => setDiscover(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {ask && (
        <div className="confirm-overlay" onMouseDown={(e) => e.target.classList.contains('confirm-overlay') && setAsk(null)}>
          <div className="confirm-box">
            <div className="confirm-msg">{ask.message}</div>
            <div className="confirm-actions">
              <button className="btn" onClick={() => setAsk(null)}>Cancel</button>
              <button className="btn danger-solid" onClick={async () => { const fn = ask.onConfirm; setAsk(null); await fn(); }}>{ask.danger || 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
