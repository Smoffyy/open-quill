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
  const [saveState, setSaveState] = useState('idle');

  const ready = useRef(false);
  const settingsTimer = useRef(null);
  const configTimer = useRef(null);
  const settledAt = useRef(null);

  const markSaved = useCallback(() => {
    setSaveState('saved');
    clearTimeout(settledAt.current);
    settledAt.current = setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1800);
  }, []);

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
    setSaveState('saving');
    settingsTimer.current = setTimeout(async () => {
      try { await api.patch('/api/admin/settings', settings); markSaved(); }
      catch { setSaveState('error'); }
    }, 450);
  }, [settings, markSaved]);

  useEffect(() => {
    if (!ready.current) return;
    clearTimeout(configTimer.current);
    setSaveState('saving');
    configTimer.current = setTimeout(async () => {
      try {
        await api.patch('/api/admin/app-config', {
          ...config,
          greetings: config.greetings.map(g => g.trim()).filter(Boolean),
          quickPrompts: (config.quickPrompts || []).filter(q => (q.label || '').trim() && (q.prompt || '').trim())
        });
        markSaved();
      } catch { setSaveState('error'); }
    }, 450);
  }, [config, markSaved]);

  const set = useCallback((key, value) => setSettings(s => ({ ...s, [key]: value })), []);
  const setCfg = useCallback((key, value) => setConfig(c => ({ ...c, [key]: value })), []);

  return { settings, setSettings, set, config, setConfig, setCfg, saveState, reload: load };
}
