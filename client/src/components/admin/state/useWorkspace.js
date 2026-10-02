import { useState, useEffect, useRef, useCallback } from 'react';
import { api, TAB_ID } from '../../../lib/api.js';
import { appFontId } from '../../../lib/prefs.js';
import { toast } from '../../../lib/toast.js';
import { t } from '../../../i18n.jsx';
import { changedKeys, pick } from './history.js';

export const SETTINGS_DEFAULTS = {
  uploadLimitAdminMb: 8, uploadLimitUserMb: 8, sandboxLimitAdminMb: 1024, sandboxLimitUserMb: 256,
  modelQueue: false,
  webSearchEnabled: false, webSearchEngine: 'searxng', searxngUrl: '', webSearchCount: 5,
  webSearchDomains: '',
  membankEnabled: false, membankHideTools: false,
  budgetUser: 0, budgetAdmin: 0, budgetWarnFraction: 0.8, budgetEnforce: false,
  sessionTtlDays: 30, maxSessions: 0,
  voiceMicEnabled: false, voiceCallEnabled: false,
  voiceSttEngine: 'browser', voiceSttUrl: '', voiceSttKey: '', voiceSttModel: 'whisper-1',
  voiceTtsEngine: 'browser', voiceTtsUrl: '', voiceTtsKey: '', voiceTtsModel: 'tts-1',
  voiceTtsVoice: 'alloy', voiceTtsSpeed: 1,
  safetyEnabled: false, safetyModelMode: 'current', safetyModelId: '', safetyPrompt: '',
  safetyVerbose: true, safetyReasonEnabled: false,
  chatSearchEnabled: false
};

export function promptFeaturesOf(settings) {
  return {
    webSearch: !!settings?.webSearchEnabled,
    chatSearch: !!settings?.chatSearchEnabled,
    referenceFiles: !!settings?.membankEnabled
  };
}

export const CONFIG_DEFAULTS = {
  appName: '', disclaimer: '', greetings: [''], appIcon: '', quickPrompts: [],
  appFont: 'literata', uiPreset: 'anthropic', modelDocs: true, modelDocsConfig: null,
  allowSignups: true, localOnly: true, egressLocalOnly: true, egressAllowWebSearch: true, egressAllowlist: []
};

const SAVE_DELAY = 450;

const URLS = { settings: '/api/admin/settings', config: '/api/admin/app-config' };

function configFrom(c) {
  return {
    ...CONFIG_DEFAULTS,
    appName: c.appName || '',
    disclaimer: c.disclaimer || '',
    greetings: c.greetings?.length ? c.greetings : [''],
    appIcon: c.appIcon || '',
    quickPrompts: Array.isArray(c.quickPrompts) ? c.quickPrompts : [],
    appFont: appFontId(c.appFont),
    uiPreset: c.uiPreset === 'openai' ? 'openai' : 'anthropic',
    modelDocs: c.modelDocs !== false,
    modelDocsConfig: c.modelDocsConfig || null,
    allowSignups: c.allowSignups !== false,
    localOnly: c.localOnly !== false,
    egressLocalOnly: c.egressLocalOnly !== false,
    egressAllowWebSearch: c.egressAllowWebSearch !== false,
    egressAllowlist: Array.isArray(c.egressAllowlist) ? c.egressAllowlist : []
  };
}

function wire(lane, patch) {
  if (lane !== 'config') return patch;
  const out = { ...patch };
  if ('greetings' in out) out.greetings = (out.greetings || []).map(g => g.trim()).filter(Boolean);
  if ('quickPrompts' in out) out.quickPrompts = (out.quickPrompts || []).filter(q => (q.label || '').trim() && (q.prompt || '').trim());
  return out;
}

// A save is keyed off the *identity* of the state object rather than a "have we
// loaded yet" flag. Loading replaces both objects, and a flag flipped in a
// promise callback can lose the race with React's render, which used to fire a
// PATCH of freshly-loaded values every single time the panel opened.
export function useWorkspace({ history } = {}) {
  const [settings, setSettings] = useState(SETTINGS_DEFAULTS);
  const [config, setConfig] = useState(CONFIG_DEFAULTS);
  const [ready, setReady] = useState(false);

  const saved = useRef({ settings: SETTINGS_DEFAULTS, config: CONFIG_DEFAULTS });
  const timers = useRef({});
  const inflight = useRef(0);
  const shown = useRef({ settings: SETTINGS_DEFAULTS, config: CONFIG_DEFAULTS });
  const quiet = useRef({ settings: SETTINGS_DEFAULTS, config: CONFIG_DEFAULTS });
  const rawConfig = useRef({});

  useEffect(() => () => {
    for (const id of Object.values(timers.current)) clearTimeout(id);
  }, []);

  const adopt = useCallback((lane, next) => {
    saved.current[lane] = next;
    quiet.current[lane] = next;
    (lane === 'settings' ? setSettings : setConfig)(next);
  }, []);

  const load = useCallback(async () => {
    try { adopt('settings', { ...SETTINGS_DEFAULTS, ...(await api.get('/api/admin/settings')) }); } catch {}
    try {
      const c = await api.get('/api/app-config');
      rawConfig.current = c;
      adopt('config', configFrom(c));
    } catch {}
    setReady(true);
  }, [adopt]);

  useEffect(() => { load(); }, [load]);

  const restore = useCallback((lane, values) => {
    const next = { ...shown.current[lane], ...values };
    quiet.current[lane] = next;
    (lane === 'settings' ? setSettings : setConfig)(next);
  }, []);

  const track = useCallback((lane, value) => {
    const before = shown.current[lane];
    shown.current[lane] = value;
    if (before === value || quiet.current[lane] === value) return;
    const keys = changedKeys(before, value);
    if (!keys.length || !history) return;
    const was = pick(before, keys);
    const now = pick(value, keys);
    history.record({ key: lane + ':' + keys.join(','), undo: () => restore(lane, was), redo: () => restore(lane, now) });
  }, [history, restore]);

  useEffect(() => { track('settings', settings); }, [settings, track]);
  useEffect(() => { track('config', config); }, [config, track]);

  const save = useCallback((lane, value) => {
    clearTimeout(timers.current[lane]);
    if (value === saved.current[lane]) return;
    timers.current[lane] = setTimeout(async () => {
      timers.current[lane] = null;
      const keys = changedKeys(saved.current[lane], value);
      if (!keys.length) return;
      const patch = pick(value, keys);
      inflight.current++;
      try {
        await api.patch(URLS[lane], wire(lane, patch));
        saved.current[lane] = { ...saved.current[lane], ...patch };
      } catch (e) {
        toast(e?.message || t('Your last change could not be saved. Edit the field again to retry.'), { kind: 'error', icon: 'info' });
      } finally { inflight.current--; }
    }, SAVE_DELAY);
  }, []);

  useEffect(() => { save('settings', settings); }, [settings, save]);
  useEffect(() => { save('config', config); }, [config, save]);

  useEffect(() => {
    function merge(lane, incoming, own) {
      const cur = shown.current[lane];
      const base = saved.current[lane];
      const nextSaved = { ...base };
      const next = { ...cur };
      let clash = false;
      for (const k of Object.keys(incoming)) {
        nextSaved[k] = incoming[k];
        if (JSON.stringify(cur[k]) !== JSON.stringify(base[k]) && JSON.stringify(cur[k]) !== JSON.stringify(incoming[k])) clash = true;
        else next[k] = incoming[k];
      }
      saved.current[lane] = nextSaved;
      quiet.current[lane] = next;
      (lane === 'settings' ? setSettings : setConfig)(next);
      if (clash && !own) toast(t('Another admin changed a setting you are editing. Your edit is kept.'), { icon: 'info' });
    }
    function onDraft(e) {
      const f = e.detail || {};
      if (f.scope === 'all') { load(); return; }
      if (!f.values || typeof f.values !== 'object') return;
      const own = !!f.tab && f.tab === TAB_ID;
      if (f.scope === 'settings') merge('settings', f.values, own);
      else if (f.scope === 'config') {
        rawConfig.current = { ...rawConfig.current, ...f.values };
        const shaped = configFrom(rawConfig.current);
        merge('config', pick(shaped, Object.keys(f.values).filter(k => k in CONFIG_DEFAULTS)), own);
      }
    }
    window.addEventListener('oq-admin-draft', onDraft);
    return () => window.removeEventListener('oq-admin-draft', onDraft);
  }, [load]);

  const unsaved = useCallback(() => inflight.current > 0 || Object.values(timers.current).some(Boolean), []);

  const set = useCallback((key, value) => setSettings(s => (s[key] === value ? s : { ...s, [key]: value })), []);
  const setCfg = useCallback((key, value) => setConfig(c => (c[key] === value ? c : { ...c, [key]: value })), []);

  return { settings, setSettings, set, config, setConfig, setCfg, ready, reload: load, unsaved };
}