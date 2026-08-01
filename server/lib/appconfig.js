import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, getSetting } from '../db.js';
import * as websearch from '../websearch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// single source of truth, bump the version in the root package.json
export const APP_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
})();

function detectVersionIcon() {
  const dirs = [path.join(__dirname, '..', '..', 'client', 'public'), path.join(__dirname, '..', '..', 'client', 'dist')];
  for (const d of dirs) {
    try {
      const f = fs.readdirSync(d).find(n => /-ui-version/i.test(n) && /\.(png|svg|jpe?g|gif|webp)$/i.test(n));
      if (f) return '/' + f;
    } catch {}
  }
  return '';
}

function readVersionText() {
  const dirs = [path.join(__dirname, '..', '..', 'client', 'public'), path.join(__dirname, '..', '..', 'client', 'dist')];
  for (const d of dirs) {
    try {
      const files = fs.readdirSync(d);
      const f = files.find(n => /^ui-version(-text)?\.md$/i.test(n)) || files.find(n => /^ui-version-text\.txt$/i.test(n));
      if (f) { const t = fs.readFileSync(path.join(d, f), 'utf8'); if (t.trim()) return t; }
    } catch {}
  }
  return '';
}

function safeParse(v, fallback) { try { const p = JSON.parse(v); return p == null ? fallback : p; } catch { return fallback; } }

export function appConfig() {
  return {
    appName: getSetting('app_name', 'open-quill'),
    disclaimer: getSetting('disclaimer', 'Assistants can make mistakes, double-check responses.'),
    greetings: (() => { const g = safeParse(getSetting('greetings', '[]'), []); return Array.isArray(g) && g.length ? g : ['How can I help you?', 'What are we building today?', 'Where should we start?']; })(),
    appIcon: getSetting('app_icon', ''),
    appFont: getSetting('app_font', 'serif'),
    uiPreset: getSetting('ui_preset', '') === 'openai' ? 'openai' : 'anthropic',
    allowSignups: getSetting('allow_signups', '1') === '1',
    localOnly: getSetting('local_only', '1') === '1',
    egressLocalOnly: getSetting('egress_local_only', '1') === '1',
    egressAllowWebSearch: getSetting('egress_allow_websearch', '1') === '1',
    egressAllowlist: (() => { try { const a = JSON.parse(getSetting('egress_allowlist', '[]')); return Array.isArray(a) ? a : []; } catch { return []; } })(),
    firstRun: db.users.count() === 0,
    uiPresetChosen: !!getSetting('ui_preset', ''),
    quickPrompts: (() => { const q = safeParse(getSetting('quick_prompts', '[]'), []); return Array.isArray(q) && q.length ? q : [{ icon: 'sparkles', label: 'Ideas', prompt: 'Give me ideas on what I should do today.' }, { icon: 'pencil', label: 'Write', prompt: 'Write a one paragraph summary about how Large Language Models (LLMs) work.' }, { icon: 'code', label: 'Code', prompt: 'Write a Python function that checks whether a string is a palindrome.' }, { icon: 'learn', label: 'Learn', prompt: 'How far away is the sun from Earth?' }, { icon: 'coffee', label: 'Life stuff', prompt: 'Give me practical advice for a life problem.' }]; })(),
    version: APP_VERSION,
    uiVersion: APP_VERSION,
    webSearchAvailable: websearch.webSearchAvailable(),
    voiceMic: getSetting('voice_mic_enabled', '0') === '1',
    voiceCall: getSetting('voice_call_enabled', '0') === '1',
    safetyCheckEnabled: getSetting('safety_enabled', '0') === '1',
    safetyCheckVerbose: getSetting('safety_verbose', '1') === '1',
    memoryFeature: getSetting('memory_enabled', '0') === '1',
    voiceStt: getSetting('voice_stt_engine', 'browser'),
    voiceTts: getSetting('voice_tts_engine', 'browser'),
    voiceTtsVoice: getSetting('voice_tts_voice', ''),
    voiceTtsSpeed: Number(getSetting('voice_tts_speed', 1)) || 1,
    uiVersionDesc: readVersionText(),
    uiVersionIcon: detectVersionIcon()
  };
}
