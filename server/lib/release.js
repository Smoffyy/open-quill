import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { APP_VERSION } from './appconfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.join(__dirname, '..', '..', 'release');

// Only these keys mean anything in release.json. Anything else is a typo the author
// should hear about at boot rather than discover as a blank panel months later.
const FIELDS = new Set(['codename', 'released', 'icon']);

const text = (v, cap) => String(v ?? '').slice(0, cap).trim();

// A release folder is looked up from most to least specific: 27.1.0, then 27.1, then 27.
// One folder per major line is the common case — the panel describes the line, while
// per-patch detail belongs in the changelog — but a minor can claim its own when it earns one.
export function releaseCandidates(version) {
  const base = String(version || '').trim().split('-')[0];
  if (!/^\d+(\.\d+)*$/.test(base)) return [];
  const parts = base.split('.');
  const out = [];
  for (let n = parts.length; n >= 1; n--) out.push(parts.slice(0, n).join('.'));
  return out;
}

// An icon is named, not discovered, and the name may only ever be a plain filename —
// the manifest is a file on disk, but treating its contents as trusted is how a path
// traversal gets written by accident.
const SAFE_ICON = /^[a-zA-Z0-9._-]+\.(png|svg|jpe?g|gif|webp)$/;

export function parseManifest(raw, onWarn) {
  const warn = typeof onWarn === 'function' ? onWarn : () => {};
  let obj;
  try { obj = JSON.parse(raw); }
  catch (e) { warn(`release.json is not valid JSON (${e.message})`); return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { warn('release.json must contain a JSON object'); return null; }

  for (const k of Object.keys(obj)) if (!FIELDS.has(k)) warn(`release.json: unknown field "${k}" (expected ${[...FIELDS].join(', ')})`);

  const released = text(obj.released, 40);
  if (released && !/^\d{4}-\d{2}-\d{2}$/.test(released)) { warn(`release.json: "released" must be YYYY-MM-DD, got "${released}"`); }

  const icon = text(obj.icon, 120);
  if (icon && !SAFE_ICON.test(icon)) { warn(`release.json: "icon" must be a plain image filename in the release folder, got "${icon}"`); }

  return {
    codename: text(obj.codename, 80),
    released: /^\d{4}-\d{2}-\d{2}$/.test(released) ? released : '',
    icon: SAFE_ICON.test(icon) ? icon : ''
  };
}

function locate(version) {
  for (const name of releaseCandidates(version)) {
    const dir = path.join(RELEASE_DIR, name);
    try { if (fs.statSync(path.join(dir, 'release.json')).isFile()) return { dir, name }; } catch {}
  }
  return null;
}

const stamp = (f) => { try { return String(fs.statSync(f).mtimeMs); } catch { return '-'; } };

let cache = null;

// Re-read when a watched file changes. Release content is edited by hand while the server
// is running, and needing a restart to see an edit is exactly the friction being removed here.
function load() {
  const found = locate(APP_VERSION);
  if (!found) return { key: 'none', value: { codename: '', released: '', notes: '', icon: '', iconPath: '' } };

  const manifestFile = path.join(found.dir, 'release.json');
  const notesFile = path.join(found.dir, 'notes.md');
  const key = `${found.name}:${stamp(manifestFile)}:${stamp(notesFile)}`;

  let raw = '';
  try { raw = fs.readFileSync(manifestFile, 'utf8'); } catch { }
  const seen = [];
  const parsed = parseManifest(raw, (m) => seen.push(m)) || { codename: '', released: '', icon: '' };
  for (const m of seen) console.warn(`[release] ${found.name}: ${m}`);

  let notes = '';
  try { notes = fs.readFileSync(notesFile, 'utf8').trim(); } catch { }

  let iconPath = '';
  if (parsed.icon) {
    const p = path.join(found.dir, parsed.icon);
    try { if (fs.statSync(p).isFile()) iconPath = p; else console.warn(`[release] ${found.name}: icon "${parsed.icon}" not found`); }
    catch { console.warn(`[release] ${found.name}: icon "${parsed.icon}" not found`); }
  }

  return { key, value: { ...parsed, notes, iconPath } };
}

function current() {
  const found = locate(APP_VERSION);
  const key = found
    ? `${found.name}:${stamp(path.join(found.dir, 'release.json'))}:${stamp(path.join(found.dir, 'notes.md'))}`
    : 'none';
  if (!cache || cache.key !== key) cache = load();
  return cache.value;
}

// What the Version panel renders. iconPath stays server-side; the client asks for the
// image by route so the file never has to live in the client's static tree.
export function releaseInfo() {
  const r = current();
  return {
    version: APP_VERSION,
    codename: r.codename,
    released: r.released,
    notes: r.notes,
    hasIcon: !!r.iconPath
  };
}

export function releaseIconPath() {
  return current().iconPath;
}
