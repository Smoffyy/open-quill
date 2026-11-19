import { useSyncExternalStore } from 'react';
import { relativeParts } from './lib/relativetime.js';
import { setErrorTranslator } from './lib/api.js';

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

setErrorTranslator((s) => t(s));

function fill(s, vars) {
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

export function t(key, vars) {
  const dict = byCode[lang];
  return fill(dict && typeof dict[key] === 'string' ? dict[key] : key, vars);
}

const pluralRules = new Map();

export function pluralForm(n, code = lang) {
  if (!pluralRules.has(code)) {
    try { pluralRules.set(code, new Intl.PluralRules(code)); }
    catch { pluralRules.set(code, new Intl.PluralRules('en')); }
  }
  return pluralRules.get(code).select(Number(n) || 0);
}

export function tp(n, one, other, vars) {
  const all = { n: fmtNumber(n), ...vars };
  const entry = byCode[lang]?.[other];
  if (entry && typeof entry === 'object') return fill(entry[pluralForm(n)] ?? entry.other ?? other, all);
  return t(pluralForm(n, 'en') === 'one' ? one : other, all);
}

export function fmtDate(value, opts) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString(lang, opts);
}

export function fmtDateTime(value, opts) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString(lang, opts);
}

export function fmtNumber(value, opts) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  try { return n.toLocaleString(lang, opts); }
  catch { return String(n); }
}

export function fmtCurrency(value, currency = 'USD', opts = {}) {
  const n = Number(value) || 0;
  const digits = n && Math.abs(n) < 0.01 ? 4 : 2;
  try { return new Intl.NumberFormat(lang, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits, ...opts }).format(n); }
  catch { return '$' + n.toFixed(digits); }
}

export function fmtUnit(value, unit, display = 'narrow') {
  try { return new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: display }).format(value); }
  catch { return value + ' ' + unit; }
}

export function fmtRelative(value, now = Date.now()) {
  const parts = relativeParts(value, now);
  if (!parts) return '';
  try { return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(parts.value, parts.unit); }
  catch { return fmtDate(value); }
}

export function useI18n() {
  const current = useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => lang,
    () => lang
  );
  return { t, lang: current, setLang, langs: LANGS, fmtDate, fmtDateTime };
}