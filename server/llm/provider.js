import { resolveProvider, providerSpec } from '../providers.js';

export function modelProvider(model) {
  return providerSpec(resolveProvider(model?.provider_id));
}
export function endpoint(base, p) { return base.replace(/\/$/, '') + p; }
export function authHeaders(key) {
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

export function applyPromptVars(text, vars) {
  if (!text) return text || '';
  return text
    .replace(/\{\{\s*currentDateTime\s*\}\}/gi, (vars && vars.currentDateTime) || '')
    .replace(/\{\{\s*currentUser\s*\}\}/gi, (vars && vars.currentUser) || '');
}

// system prompt order: base, summary, sandbox, then the reasoning toggle token last
