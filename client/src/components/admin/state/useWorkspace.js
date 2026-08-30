import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../../api.js';
import { appFontId } from '../../../prefs.js';

export const SETTINGS_DEFAULTS = {
  uploadLimitAdminMb: 8, uploadLimitUserMb: 8, sandboxLimitAdminMb: 1024, sandboxLimitUserMb: 256,
  modelQueue: false,
  webSearchEnabled: false, webSearchEngine: 'searxng', searxngUrl: '', webSearchCount: 5,
  webSearchDomains: '', webSearchPrompt: '',
  membankEnabled: false, membankHideTools: false, membankPrompt: '',
  budgetUser: 0, budgetAdmin: 0, budgetWarnFraction: 0.8, budgetEnforce: false,
  sessionTtlDays: 30, maxSessions: 0,
  voiceMicEnabled: false, voiceCallEnabled: false,
  voiceSttEngine: 'browser', voiceSttUrl: '', voiceSttKey: '', voiceSttModel: 'whisper-1',
  voiceTtsEngine: 'browser', voiceTtsUrl: '', voiceTtsKey: '', voiceTtsModel: 'tts-1',
  voiceTtsVoice: 'alloy', voiceTtsSpeed: 1,
  safetyEnabled: false, safetyModelMode: 'current', safetyModelId: '', safetyPrompt: '',
  safetyVerbose: true, safetyReasonEnabled: false,
  memoryEnabled: false, memoryPrompt: '', chatSearchEnabled: false
};

export const CONFIG_DEFAULTS = {
  appName: '', disclaimer: '', greetings: [''], appIcon: '', quickPrompts: [],
  appFont: 'newsreader', uiPreset: 'anthropic', modelDocs: true,
  allowSignups: true, localOnly: true, egressLocalOnly: true, egressAllowWebSearch: true, egressAllowlist: []
};

const SAVE_DELAY = 450;
const SAVED_LINGER = 1800;

// Both stores autosave: an edit is PATCHed after a short pause, and the header
// reports the result. Admins preview their own app-config draft; members keep
// reading the published one until publish promotes it.
//
// A save is keyed off the *identity* of the state object rather than a "have we
// loaded yet" flag. Loading replaces both objects, and a flag flipped in a
// promise callback can lose the race with React's render, which used to fire a
// PATCH of freshly-loaded values every single time the panel opened.
export function useWorkspace() {
  const [settings, setSettings] = useState(SETTINGS_DEFAULTS);
  const [config, setConfig] = useState(CONFIG_DEFAULTS);
  const [lanes, setLanes] = useState({ settings: 'idle', config: 'idle' });

  const saved = useRef({ settings: SETTINGS_DEFAULTS, config: CONFIG_DEFAULTS });
  const timers = useRef({});
  const linger = useRef({});

  const mark = useCallback((lane, state) => {
    setLanes(v => (v[lane] === state ? v : { ...v, [lane]: state }));
    clearTimeout(linger.current[lane]);
    if (state !== 'saved') return;
    linger.current[lane] = setTimeout(
      () => setLanes(v => (v[lane] === 'saved' ? { ...v, [lane]: 'idle' } : v)), SAVED_LINGER);
  }, []);

  useEffect(() => () => {
    for (const id of Object.values(linger.current)) clearTimeout(id);
    for (const id of Object.values(timers.current)) clearTimeout(id);
  }, []);

  const saveState = lanes.settings === 'error' || lanes.config === 'error' ? 'error'
    : lanes.settings === 'saving' || lanes.config === 'saving' ? 'saving'
      : lanes.settings === 'saved' || lanes.config === 'saved' ? 'saved' : 'idle';

  const load = useCallback(async () => {
    try {
      const next = { ...SETTINGS_DEFAULTS, ...(await api.get('/api/admin/settings')) };
      saved.current.settings = next;
      setSettings(next);
    } catch {}
    try {
      const c = await api.get('/api/app-config');
      const next = {
        ...CONFIG_DEFAULTS,
        appName: c.appName || '',
        disclaimer: c.disclaimer || '',
        greetings: c.greetings?.length ? c.greetings : [''],
        appIcon: c.appIcon || '',
        quickPrompts: Array.isArray(c.quickPrompts) ? c.quickPrompts : [],
        appFont: appFontId(c.appFont),
        uiPreset: c.uiPreset === 'openai' ? 'openai' : 'anthropic',
        modelDocs: c.modelDocs !== false,
        allowSignups: c.allowSignups !== false,
        localOnly: c.localOnly !== false,
        egressLocalOnly: c.egressLocalOnly !== false,
        egressAllowWebSearch: c.egressAllowWebSearch !== false,
        egressAllowlist: Array.isArray(c.egressAllowlist) ? c.egressAllowlist : []
      };
      saved.current.config = next;
      setConfig(next);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (settings === saved.current.settings) return undefined;
    mark('settings', 'saving');
    clearTimeout(timers.current.settings);
    timers.current.settings = setTimeout(async () => {
      try {
        await api.patch('/api/admin/settings', settings);
        saved.current.settings = settings;
        mark('settings', 'saved');
      } catch { mark('settings', 'error'); }
    }, SAVE_DELAY);
    return undefined;
  }, [settings, mark]);

  useEffect(() => {
    if (config === saved.current.config) return undefined;
    mark('config', 'saving');
    clearTimeout(timers.current.config);
    timers.current.config = setTimeout(async () => {
      try {
        await api.patch('/api/admin/app-config', {
          ...config,
          greetings: config.greetings.map(g => g.trim()).filter(Boolean),
          quickPrompts: (config.quickPrompts || []).filter(q => (q.label || '').trim() && (q.prompt || '').trim())
        });
        saved.current.config = config;
        mark('config', 'saved');
      } catch { mark('config', 'error'); }
    }, SAVE_DELAY);
    return undefined;
  }, [config, mark]);

  const set = useCallback((key, value) => setSettings(s => (s[key] === value ? s : { ...s, [key]: value })), []);
  const setCfg = useCallback((key, value) => setConfig(c => (c[key] === value ? c : { ...c, [key]: value })), []);

  return { settings, setSettings, set, config, setConfig, setCfg, saveState, reload: load };
}
