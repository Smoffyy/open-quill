let common = null;
let full = null;
let commonLoad = null;
let fullLoad = null;
let version = 0;
const subs = new Set();
const wanted = new Set();

export function subscribeHljs(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function hljsVersion() {
  return version;
}

function bump() {
  version++;
  subs.forEach(fn => fn());
}

function engine() {
  return full || common;
}

export function ensureCommon() {
  if (full || common) return Promise.resolve(engine());
  if (commonLoad) return commonLoad;
  commonLoad = import('highlight.js/lib/common')
    .then(mod => {
      common = mod.default || mod;
      bump();
      for (const l of wanted) if (!common.getLanguage(l)) ensureLanguage(l);
      return common;
    })
    .catch(() => { commonLoad = null; return null; });
  return commonLoad;
}

const EXTRA = {
  glsl: () => import('highlight.js/lib/languages/glsl'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  apache: () => import('highlight.js/lib/languages/apache'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  dart: () => import('highlight.js/lib/languages/dart'),
  elixir: () => import('highlight.js/lib/languages/elixir'),
  erlang: () => import('highlight.js/lib/languages/erlang'),
  haskell: () => import('highlight.js/lib/languages/haskell'),
  scala: () => import('highlight.js/lib/languages/scala'),
  clojure: () => import('highlight.js/lib/languages/clojure'),
  julia: () => import('highlight.js/lib/languages/julia'),
  matlab: () => import('highlight.js/lib/languages/matlab'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  cmake: () => import('highlight.js/lib/languages/cmake'),
  latex: () => import('highlight.js/lib/languages/latex'),
  nix: () => import('highlight.js/lib/languages/nix'),
  pgsql: () => import('highlight.js/lib/languages/pgsql'),
  scheme: () => import('highlight.js/lib/languages/scheme'),
  fsharp: () => import('highlight.js/lib/languages/fsharp'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  ocaml: () => import('highlight.js/lib/languages/ocaml'),
  fortran: () => import('highlight.js/lib/languages/fortran'),
  prolog: () => import('highlight.js/lib/languages/prolog'),
  tcl: () => import('highlight.js/lib/languages/tcl'),
  vim: () => import('highlight.js/lib/languages/vim'),
  x86asm: () => import('highlight.js/lib/languages/x86asm'),
  verilog: () => import('highlight.js/lib/languages/verilog'),
  vhdl: () => import('highlight.js/lib/languages/vhdl'),
  awk: () => import('highlight.js/lib/languages/awk'),
  http: () => import('highlight.js/lib/languages/http'),
  handlebars: () => import('highlight.js/lib/languages/handlebars'),
  twig: () => import('highlight.js/lib/languages/twig'),
  stylus: () => import('highlight.js/lib/languages/stylus'),
  coffeescript: () => import('highlight.js/lib/languages/coffeescript'),
  crystal: () => import('highlight.js/lib/languages/crystal'),
  elm: () => import('highlight.js/lib/languages/elm'),
  reasonml: () => import('highlight.js/lib/languages/reasonml'),
  zephir: () => import('highlight.js/lib/languages/zephir'),
};

const loadingLang = new Set();

function loadExtra(lang) {
  const get = EXTRA[lang];
  if (!get || loadingLang.has(lang)) return true;
  loadingLang.add(lang);
  Promise.resolve()
    .then(() => ensureCommon())
    .then(() => get())
    .then(mod => {
      const hl = engine();
      if (!hl) return;
      hl.registerLanguage(lang, mod.default || mod);
      bump();
    })
    .catch(() => { loadingLang.delete(lang); ensureFull(); });
  return true;
}

export function ensureFull() {
  if (full) return Promise.resolve(full);
  if (fullLoad) return fullLoad;
  fullLoad = import('highlight.js')
    .then(mod => { full = mod.default || mod; bump(); return full; })
    .catch(() => { fullLoad = null; return null; });
  return fullLoad;
}

export function knowsLanguage(lang) {
  const hl = engine();
  return !!lang && !!hl && !!hl.getLanguage(lang);
}

export function ensureLanguage(lang) {
  if (!lang || knowsLanguage(lang)) return;
  wanted.add(lang);
  if (!common && !full) { ensureCommon(); return; }
  if (EXTRA[lang]) { loadExtra(lang); return; }
  ensureFull();
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlight(code, lang, opts = {}) {
  const hl = engine();
  if (!hl) { ensureCommon(); if (lang) wanted.add(lang); return escapeHtml(code); }
  const auto = opts.auto !== false;
  const maxAuto = opts.maxAuto ?? 12000;
  const maxTotal = opts.maxTotal ?? 60000;
  try {
    if (code.length > maxTotal) return escapeHtml(code);
    if (lang) {
      if (hl.getLanguage(lang)) return hl.highlight(code, { language: lang, ignoreIllegals: true }).value;
      ensureLanguage(lang);
    }
    if (!auto || code.length > maxAuto) return escapeHtml(code);
    return hl.highlightAuto(code).value;
  } catch { return escapeHtml(code); }
}

export function rawHighlight(code, lang) {
  const hl = engine();
  if (!hl) { ensureCommon(); if (lang) wanted.add(lang); throw new Error('hljs not ready'); }
  if (lang && hl.getLanguage(lang)) return hl.highlight(code, { language: lang, ignoreIllegals: true }).value;
  return hl.highlightAuto(code).value;
}
