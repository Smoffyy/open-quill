import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../api.js';
import { SECTIONS, LEGACY_SECTION_IDS } from './nav.jsx';
import { t } from '../../i18n.jsx';

const AdminCtx = createContext(null);

export const useAdmin = () => useContext(AdminCtx);

export const DEFAULT_SETTINGS = {
  apiBaseUrl: '', apiKey: '', uploadLimitAdminMb: 8, uploadLimitUserMb: 8, sandboxLimitAdminMb: 1024, sandboxLimitUserMb: 256,
  modelQueue: false, membankEnabled: false, membankHideTools: false, membankPrompt: '',
  budgetUser: 0, budgetAdmin: 0, budgetWarnFraction: 0.8, budgetEnforce: false, sessionTtlDays: 30, maxSessions: 0,
  voiceMicEnabled: false, voiceCallEnabled: false, voiceSttEngine: 'browser', voiceSttUrl: '', voiceSttKey: '', voiceSttModel: 'whisper-1',
  voiceTtsEngine: 'browser', voiceTtsUrl: '', voiceTtsKey: '', voiceTtsModel: 'tts-1', voiceTtsVoice: 'alloy', voiceTtsSpeed: 1,
  safetyEnabled: false, safetyModelMode: 'current', safetyModelId: '', safetyPrompt: '', safetyVerbose: true, safetyReasonEnabled: false,
  memoryEnabled: false, memoryPrompt: '', chatSearchEnabled: false
};

export const DEFAULT_CFG = { appName: '', disclaimer: '', greetings: [''], appIcon: '', quickPrompts: [], appFont: 'serif', uiPreset: 'anthropic', allowSignups: true, localOnly: true, egressLocalOnly: true, egressAllowWebSearch: true, egressAllowlist: [] };

function initialSection() {
  try {
    const raw = localStorage.getItem('oq-admin-tab');
    const mapped = LEGACY_SECTION_IDS[raw] || raw;
    if (mapped && SECTIONS.some(s => s.id === mapped)) return mapped;
  } catch {}
  return 'dashboard';
}

export function AdminProvider({ user, onClose, children, modelId = null }) {
  const [section, setSection] = useState(initialSection);
  const [models, setModels] = useState([]);
  const [providers, setProviders] = useState([]);
  const [providerTypes, setProviderTypes] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [users, setUsers] = useState([]);
  const [pub, setPub] = useState({ dirty: false, publishedAt: null });
  const [publishing, setPublishing] = useState(false);
  const [pubFlash, setPubFlash] = useState(false);
  const [modelSave, setModelSave] = useState('idle');
  const [settingsSave, setSettingsSave] = useState('idle');
  const [usage, setUsage] = useState(null);
  const [usageDays, setUsageDays] = useState('30');
  const [recentAudit, setRecentAudit] = useState(null);
  const [selModel, setSelModel] = useState(null);
  const [ask, setAsk] = useState(null);
  const [discover, setDiscover] = useState(null);
  const [provTest, setProvTest] = useState({});

  const saveTimers = useRef({});
  const pendingIds = useRef(new Set());
  const readyRef = useRef(false);
  const settingsTimer = useRef(null);
  const cfgTimer = useRef(null);
  const modelsRef = useRef([]);
  const providersRef = useRef([]);
  useEffect(() => { modelsRef.current = models; }, [models]);
  // Open on whatever model the user currently has equipped rather than on the top
  // of the list. Seeded once, and only while nothing has been picked, so it cannot
  // yank the selection back after the admin clicks something else.
  const seededSel = useRef(false);
  useEffect(() => {
    if (seededSel.current || !modelId || !models.length) return;
    seededSel.current = true;
    if (models.some(m => m.id === modelId)) setSelModel(s => s ?? modelId);
  }, [models, modelId]);
  useEffect(() => { providersRef.current = providers; }, [providers]);
  useEffect(() => { try { localStorage.setItem('oq-admin-tab', section); } catch {} }, [section]);

  const markDirty = useCallback(() => setPub(p => ({ ...p, dirty: true })), []);

  const refreshPubState = useCallback(async () => {
    try { setPub(await api.get('/api/admin/models/publish-state')); } catch {}
  }, []);

  const loadUsers = useCallback(async () => { try { setUsers(await api.get('/api/admin/users')); } catch {} }, []);

  const reloadProviders = useCallback(async () => {
    try { const p = await api.get('/api/admin/providers'); setProviders(p.providers || []); setProviderTypes(p.types || {}); } catch {}
  }, []);

  const loadAll = useCallback(async () => {
    try { setModels(await api.get('/api/admin/models')); } catch {}
    try { setSettings(await api.get('/api/admin/settings')); } catch {}
    await reloadProviders();
    try {
      const c = await api.get('/api/app-config');
      setCfg({
        appName: c.appName || '', disclaimer: c.disclaimer || '',
        greetings: c.greetings?.length ? c.greetings : [''], appIcon: c.appIcon || '',
        quickPrompts: Array.isArray(c.quickPrompts) ? c.quickPrompts : [],
        appFont: c.appFont === 'sans' ? 'sans' : 'serif',
        uiPreset: c.uiPreset === 'openai' ? 'openai' : 'anthropic'
      });
    } catch {}
    loadUsers();
  }, [reloadProviders, loadUsers]);

  useEffect(() => { loadAll().then(() => { readyRef.current = true; }); refreshPubState(); }, [loadAll, refreshPubState]);

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
  }, [refreshPubState]);

  useEffect(() => {
    if (!readyRef.current) return;
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    setSettingsSave('saving');
    settingsTimer.current = setTimeout(async () => {
      try { await api.patch('/api/admin/settings', settings); markDirty(); setSettingsSave('saved'); }
      catch { setSettingsSave('idle'); }
    }, 500);
  }, [settings, markDirty]);

  useEffect(() => {
    if (!readyRef.current) return;
    if (cfgTimer.current) clearTimeout(cfgTimer.current);
    setSettingsSave('saving');
    cfgTimer.current = setTimeout(async () => {
      try {
        await api.patch('/api/admin/app-config', {
          ...cfg,
          greetings: cfg.greetings.map(g => g.trim()).filter(Boolean),
          quickPrompts: (cfg.quickPrompts || []).filter(q => (q.label || '').trim() && (q.prompt || '').trim())
        });
        markDirty();
        setSettingsSave('saved');
      } catch { setSettingsSave('idle'); }
    }, 500);
  }, [cfg, markDirty]);

  const changeModel = useCallback((updated) => {
    setModels(ms => ms.map(m => {
      if (m.id === updated.id) return updated;
      if (updated.is_default && m.is_default) return { ...m, is_default: 0 };
      return m;
    }));
    setModelSave('saving');
    pendingIds.current.add(updated.id);
    clearTimeout(saveTimers.current[updated.id]);
    saveTimers.current[updated.id] = setTimeout(async () => {
      try {
        await api.patch('/api/admin/models/' + updated.id, updated);
        setModelSave('saved');
        markDirty();
        setTimeout(() => setModelSave(s => s === 'saved' ? 'idle' : s), 1600);
      } catch { setModelSave('idle'); }
      finally { setTimeout(() => pendingIds.current.delete(updated.id), 1200); delete saveTimers.current[updated.id]; }
    }, 500);
  }, [markDirty]);

  const addModel = useCallback(async () => {
    const { id } = await api.post('/api/admin/models', { display_name: 'New model', internal_name: 'local-model' });
    await loadAll();
    setSelModel(id);
    setSection('models');
    markDirty();
    return id;
  }, [loadAll, markDirty]);

  const duplicateModel = useCallback(async (id) => {
    const src = modelsRef.current.find(m => m.id === id);
    if (!src) return;
    const body = { ...src, display_name: (src.display_name || 'Model') + ' copy', is_default: false };
    const { id: newId } = await api.post('/api/admin/models', body);
    await api.patch('/api/admin/models/' + newId, body);
    await loadAll();
    setSelModel(newId);
    markDirty();
  }, [loadAll, markDirty]);

  const duplicateModels = useCallback(async (ids) => {
    for (const id of ids) {
      const src = modelsRef.current.find(m => m.id === id);
      if (!src) continue;
      const body = { ...src, display_name: (src.display_name || 'Model') + ' copy', is_default: false };
      const { id: newId } = await api.post('/api/admin/models', body);
      await api.patch('/api/admin/models/' + newId, body);
    }
    await loadAll();
    markDirty();
  }, [loadAll, markDirty]);

  const setModelsEnabled = useCallback(async (ids, enabled) => {
    for (const id of ids) await api.patch('/api/admin/models/' + id, { enabled: enabled ? 1 : 0 });
    setModels(ms => ms.map(m => ids.includes(m.id) ? { ...m, enabled: enabled ? 1 : 0 } : m));
    markDirty();
  }, [markDirty]);

  const setModelsProvider = useCallback(async (ids, providerId) => {
    for (const id of ids) await api.patch('/api/admin/models/' + id, { provider_id: providerId });
    setModels(ms => ms.map(m => ids.includes(m.id) ? { ...m, provider_id: providerId } : m));
    markDirty();
  }, [markDirty]);

  const setModelsGroup = useCallback(async (ids, label) => {
    const patch = label == null ? { in_more_models: 0, more_models_label: '' } : { in_more_models: 1, more_models_label: label };
    for (const id of ids) await api.patch('/api/admin/models/' + id, patch);
    setModels(ms => ms.map(m => ids.includes(m.id) ? { ...m, ...patch } : m));
    markDirty();
  }, [markDirty]);

  const renameModelGroup = useCallback(async (oldLabel, newLabel) => {
    const ids = modelsRef.current.filter(m => m.in_more_models && (m.more_models_label || '') === oldLabel).map(m => m.id);
    for (const id of ids) await api.patch('/api/admin/models/' + id, { more_models_label: newLabel });
    setModels(ms => ms.map(m => ids.includes(m.id) ? { ...m, more_models_label: newLabel } : m));
    markDirty();
  }, [markDirty]);

  const deleteModels = useCallback((ids, onDone) => {
    const n = ids.length;
    setAsk({
      message: n === 1 ? t('Delete this model? This cannot be undone.') : t('Delete {n} models? This cannot be undone.', { n }),
      danger: n === 1 ? t('Delete model') : t('Delete {n} models', { n }),
      onConfirm: async () => {
        for (const id of ids) await api.del('/api/admin/models/' + id);
        setModels(ms => ms.filter(m => !ids.includes(m.id)));
        setSelModel(s => ids.includes(s) ? null : s);
        markDirty();
        if (onDone) onDone();
      }
    });
  }, [markDirty]);

  const commitModelOrder = useCallback((arr) => {
    setModels(arr);
    api.post('/api/admin/models/reorder', { ids: arr.map(m => m.id) }).catch(() => {});
    markDirty();
  }, [markDirty]);

  const publish = useCallback(async () => {
    setPublishing(true);
    try {
      const r = await api.post('/api/admin/models/publish', {});
      setPub({ dirty: false, published: true, publishedAt: r.publishedAt });
      setPubFlash(true);
      setTimeout(() => setPubFlash(false), 2200);
    } finally { setPublishing(false); }
  }, []);

  const openDiscover = useCallback(async (providerId) => {
    const pid = (typeof providerId === 'string' && providerId) ? providerId : (providersRef.current[0]?.id || '');
    setDiscover({ loading: true, error: '', list: [], providerId: pid });
    try {
      const r = await api.get('/api/admin/discover-models?provider=' + encodeURIComponent(pid));
      setDiscover({ loading: false, error: '', list: r.models || [], providerId: pid });
    } catch (e) { setDiscover({ loading: false, error: e?.message || t('Could not reach the backend.'), list: [], providerId: pid }); }
  }, []);

  const addDiscovered = useCallback(async (id) => {
    setDiscover(d => d ? { ...d, list: d.list.map(x => x.id === id ? { ...x, busy: true } : x) } : d);
    await api.post('/api/admin/models', { display_name: id, internal_name: id, provider_id: (discover?.providerId) || (providersRef.current[0]?.id || undefined) });
    await loadAll();
    setDiscover(d => d ? { ...d, list: d.list.map(x => x.id === id ? { ...x, added: true, busy: false } : x) } : d);
    markDirty();
  }, [discover, loadAll, markDirty]);

  const addProvider = useCallback(async () => {
    await api.post('/api/admin/providers', { type: 'lmstudio' });
    await reloadProviders();
  }, [reloadProviders]);

  const patchProvider = useCallback(async (id, patch) => {
    setProviders(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
    await api.patch('/api/admin/providers/' + id, patch);
  }, []);

  const deleteProvider = useCallback(async (id) => {
    try { await api.del('/api/admin/providers/' + id); await reloadProviders(); await loadAll(); }
    catch (e) { setAsk({ message: e?.message || t('Could not delete provider.'), onConfirm: () => {} }); }
  }, [reloadProviders, loadAll]);

  const testProvider = useCallback(async (id) => {
    setProvTest(t => ({ ...t, [id]: { busy: true } }));
    const prov = providersRef.current.find(p => p.id === id);
    try {
      const r = await api.get('/api/admin/discover-models?provider=' + encodeURIComponent(id));
      let engine = null;
      if (prov && prov.type === 'llamacpp') {
        try { engine = await api.get('/api/admin/providers/' + encodeURIComponent(id) + '/engine'); } catch {}
      }
      setProvTest(t => ({ ...t, [id]: { ok: true, count: (r.models || []).length, engine } }));
    } catch (e) {
      setProvTest(t => ({ ...t, [id]: { ok: false, err: e?.message || 'Unreachable' } }));
    }
  }, []);

  const loadUsage = useCallback(async (days) => {
    const d = days || usageDays;
    try { setUsage(await api.get('/api/admin/usage?days=' + d)); } catch {}
  }, [usageDays]);

  const loadRecentAudit = useCallback(async () => {
    try { const d = await api.get('/api/admin/audit?limit=6&offset=0'); setRecentAudit(d.entries || []); } catch { setRecentAudit([]); }
  }, []);

  const setRole = useCallback(async (id, isAdmin) => {
    await api.patch('/api/admin/users/' + id, { isAdmin });
    setUsers(us => us.map(u => u.id === id ? { ...u, isAdmin } : u));
  }, []);

  const saveBudget = useCallback(async (id, value) => {
    const budget = value === '' || value == null ? null : Math.max(0, Number(value) || 0);
    try { await api.patch('/api/admin/users/' + id + '/budget', { budget }); setUsers(us => us.map(u => u.id === id ? { ...u, budget } : u)); } catch {}
  }, []);

  const removeUser = useCallback((id) => {
    setAsk({
      message: t('Remove this user and all their chats? This cannot be undone.'), danger: t('Remove user'),
      onConfirm: async () => { await api.del('/api/admin/users/' + id); setUsers(us => us.filter(u => u.id !== id)); }
    });
  }, []);

  const value = {
    user, onClose,
    section, setSection,
    models, setModels, providers, providerTypes, settings, setSettings, cfg, setCfg, users, setUsers,
    pub, publishing, pubFlash, publish, markDirty,
    modelSave, settingsSave,
    selModel, setSelModel,
    ask, setAsk,
    discover, setDiscover, openDiscover, addDiscovered,
    provTest, addProvider, patchProvider, deleteProvider, testProvider, reloadProviders,
    usage, usageDays, setUsageDays, loadUsage,
    recentAudit, loadRecentAudit,
    changeModel, addModel, duplicateModel, duplicateModels, setModelsEnabled, setModelsProvider, setModelsGroup, renameModelGroup, deleteModels, commitModelOrder,
    setRole, saveBudget, removeUser, loadUsers, loadAll
  };

  return <AdminCtx.Provider value={value}>{children}</AdminCtx.Provider>;
}
