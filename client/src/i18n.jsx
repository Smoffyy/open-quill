import { useSyncExternalStore } from 'react';

const meta = import.meta.glob('./locales/*.json', { eager: true, import: '_meta' });
const loaders = import.meta.glob('./locales/*.json');

const packs = Object.entries(meta)
  .map(([path, m]) => (m && m.code ? { path, ...m } : null))
  .filter(Boolean)
  .sort((a, b) => (a.code === 'en' ? -1 : b.code === 'en' ? 1 : a.name.localeCompare(b.name)));

const byPath = {};
for (const p of packs) byPath[p.code] = p.path;

const byCode = {};
for (const m of Object.values(import.meta.glob('./locales/en.json', { eager: true }))) {
  const pack = m.default || m;
  if (pack && pack._meta) byCode[pack._meta.code] = pack;
}

export const LANGS = packs.map(p => ({ code: p.code, name: p.name, dir: p.dir || 'ltr' }));

export function loadLang(code) {
  const path = byPath[code];
  if (!path || byCode[code]) return Promise.resolve(byCode[code] || null);
  const load = loaders[path];
  if (!load) return Promise.resolve(null);
  return load()
    .then(mod => {
      const pack = mod.default || mod;
      if (pack && pack._meta) byCode[code] = pack;
      return byCode[code] || null;
    })
    .catch(() => null);
}

function detect() {
  try {
    const saved = localStorage.getItem('oq-lang');
    if (saved && byPath[saved]) return saved;
  } catch {}
  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en').slice(0, 2).toLowerCase();
  return byPath[nav] ? nav : 'en';
}

let lang = detect();
const subs = new Set();

function applyDocument() {
  if (typeof document === 'undefined') return;
  const info = packs.find(p => p.code === lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = (info && info.dir) || 'ltr';
}
applyDocument();

export function getLang() {
  return lang;
}

export function setLang(code) {
  if (!byPath[code] || code === lang) return;
  const commit = () => {
    lang = code;
    try { localStorage.setItem('oq-lang', code); } catch {}
    applyDocument();
    subs.forEach(f => f());
  };
  if (byCode[code]) commit();
  else loadLang(code).then(commit);
}

export const tk = (s) => s;

export function t(key, vars) {
  const dict = byCode[lang];
  let s = dict && typeof dict[key] === 'string' ? dict[key] : key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

export function fmtDate(value, opts) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString(lang, opts);
}

export function fmtDateTime(value, opts) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString(lang, opts);
}

export function useI18n() {
  const current = useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => lang
  );
  return { t, lang: current, setLang, langs: LANGS, fmtDate, fmtDateTime };
}
