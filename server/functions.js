import { getSetting, setSetting, uid } from './db.js';

const LOCATIONS = new Set(['composer', 'message']);
const ICONS = new Set(['none', 'sparkles', 'bulb', 'pencil', 'code', 'wrench', 'wand', 'bolt', 'filter', 'search', 'star', 'chat']);

export function list() {
  const raw = getSetting('custom_functions', []);
  return Array.isArray(raw) ? raw : [];
}
function save(arr) { setSetting('custom_functions', arr); }

export function publicList() {
  return list().filter(f => f.enabled).map(f => ({ id: f.id, label: f.label, icon: f.icon || 'none', location: f.location || 'composer', code: f.code || '' }));
}

function validate(b) {
  const label = String(b.label || '').trim().slice(0, 40);
  if (!label) return { error: 'A button label is required.' };
  if (!String(b.code || '').trim()) return { error: 'Function code is required.' };
  return {
    label,
    name: String(b.name || label).trim().slice(0, 60),
    icon: ICONS.has(String(b.icon)) ? b.icon : 'none',
    location: LOCATIONS.has(String(b.location)) ? b.location : 'composer',
    code: String(b.code).slice(0, 20000),
    enabled: b.enabled !== false
  };
}

export function create(b) {
  const v = validate(b);
  if (v.error) return v;
  const fn = { id: uid(), ...v, created_at: Date.now() };
  save([...list(), fn]);
  return { ok: true, fn };
}
export function update(id, b) {
  const arr = list();
  const i = arr.findIndex(f => f.id === id);
  if (i === -1) return { error: 'Function not found.' };
  if ('enabled' in b && Object.keys(b).length === 1) { arr[i] = { ...arr[i], enabled: !!b.enabled }; save(arr); return { ok: true, fn: arr[i] }; }
  const v = validate({ ...arr[i], ...b });
  if (v.error) return v;
  arr[i] = { ...arr[i], ...v };
  save(arr);
  return { ok: true, fn: arr[i] };
}
export function remove(id) { save(list().filter(f => f.id !== id)); return { ok: true }; }
