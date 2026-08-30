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

// Both of these are staged: the PATCH writes a draft the panel reads back, and
// publish promotes it. Admins preview their own app-config draft; members keep
// reading the published one until then.
export function useWorkspace() {
  const [settings, setSettings] = useState(SETTINGS_DEFAULTS);
  const [config, setConfig] = useState(CONFIG_DEFAULTS);
  const [lanes, setLanes] = useState({ settings: 'idle', config: 'idle' });

  const ready = useRef(false);
  const settingsTimer = useRef(null);
  const configTimer = useRef(null);
  const settled = useRef({});

  const mark = useCallback((lane, state) => {
    setLanes(v => (v[lane] === state ? v : { ...v, [lane]: state }));
    clearTimeout(settled.current[lane]);
    if (state !== 'saved') return;
    settled.current[lane] = setTimeout(
      () => setLanes(v => (v[lane] === 'saved' ? { ...v, [lane]: 'idle' } : v)), 1800);
  }, []);

  useEffect(() => () => { for (const id of Object.values(settled.current)) clearTimeout(id); }, []);

  const saveState = lanes.settings === 'error' || lanes.config === 'error' ? 'error'
    : lanes.settings === 'saving' || lanes.config === 'saving' ? 'saving'
      : lanes.settings === 'saved' || lanes.config === 'saved' ? 'saved' : 'idle';

  const load = useCallback(async () => {
    try { setSettings({ ...SETTINGS_DEFAULTS, ...(await api.get('/api/admin/settings')) }); } catch {}
    try {
      const c = await api.get('/api/app-config');
      setConfig({
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
      });
    } catch {}
  }, []);

  useEffect(() => { load().then(() => { ready.current = true; }); }, [load]);

  useEffect(() => {
    if (!ready.current) return;
    clearTimeout(settingsTimer.current);
    mark('settings', 'saving');
    settingsTimer.current = setTimeout(async () => {
      try { await api.patch('/api/admin/settings', settings); mark('settings', 'saved'); }
      catch { mark('settings', 'error'); }
    }, 450);
  }, [settings, mark]);

  useEffect(() => {
    if (!ready.current) return;
    clearTimeout(configTimer.current);
    mark('config', 'saving');
    configTimer.current = setTimeout(async () => {
      try {
        await api.patch('/api/admin/app-config', {
          ...config,
          greetings: config.greetings.map(g => g.trim()).filter(Boolean),
          quickPrompts: (config.quickPrompts || []).filter(q => (q.label || '').trim() && (q.prompt || '').trim())
        });
        mark('config', 'saved');
      } catch { mark('config', 'error'); }
    }, 450);
  }, [config, mark]);

  const set = useCallback((key, value) => setSettings(s => ({ ...s, [key]: value })), []);
  const setCfg = useCallback((key, value) => setConfig(c => ({ ...c, [key]: value })), []);

  return { settings, setSettings, set, config, setConfig, setCfg, saveState, reload: load };
}
