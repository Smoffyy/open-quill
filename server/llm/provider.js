import { resolveProvider, providerSpec } from '../lib/providers.js';

export function modelProvider(model) {
  return providerSpec(resolveProvider(model?.provider_id));
}
export function endpoint(base, p) { return base.replace(/\/$/, '') + p; }
export function authHeaders(key) {
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}