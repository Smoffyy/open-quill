import { useSyncExternalStore } from 'react';

const files = import.meta.glob('./locales/*.json', { eager: true });
const packs = Object.values(files).map(m => m.default || m).filter(d => d && d._meta && d._meta.code);
packs.sort((a, b) => (a._meta.code === 'en' ? -1 : b._meta.code === 'en' ? 1 : a._meta.name.localeCompare(b._meta.name)));
const byCode = {};
for (const p of packs) byCode[p._meta.code] = p;

export const LANGS = packs.map(p => ({ code: p._meta.code, name: p._meta.name, dir: p._meta.dir || 'ltr' }));

function detect() {
  try {
    const saved = localStorage.getItem('oq-lang');
    if (saved && byCode[saved]) return saved;
  } catch {}
  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en').slice(0, 2).toLowerCase();
  return byCode[nav] ? nav : 'en';
}

let lang = detect();
const subs = new Set();

function applyDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = (byCode[lang] && byCode[lang]._meta.dir) || 'ltr';
}
applyDocument();

export function getLang() {
  return lang;
}

export function setLang(code) {
  if (!byCode[code] || code === lang) return;
  lang = code;
  try { localStorage.setItem('oq-lang', code); } catch {}
  applyDocument();
  subs.forEach(f => f());
}

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
