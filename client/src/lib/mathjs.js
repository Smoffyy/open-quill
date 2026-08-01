const MATH_ENVIRONMENTS = new Set([
  'equation', 'equation*', 'align', 'align*', 'aligned', 'alignat', 'alignat*', 'alignedat',
  'gather', 'gather*', 'gathered', 'multline', 'multline*', 'split', 'flalign', 'flalign*',
  'cases', 'dcases', 'rcases', 'darray', 'subarray', 'array',
  'matrix', 'matrix*', 'pmatrix', 'pmatrix*', 'bmatrix', 'bmatrix*', 'Bmatrix', 'Bmatrix*',
  'vmatrix', 'vmatrix*', 'Vmatrix', 'Vmatrix*', 'smallmatrix', 'CD',
]);

export const BASE_MACROS = {
  '\\mdollar': '\\$',
  '\\RR': '\\mathbb{R}',
  '\\NN': '\\mathbb{N}',
  '\\ZZ': '\\mathbb{Z}',
  '\\QQ': '\\mathbb{Q}',
  '\\CC': '\\mathbb{C}',
  '\\eps': '\\varepsilon',
  '\\dd': '\\mathrm{d}',
  '\\abs': '\\left|#1\\right|',
  '\\norm': '\\left\\|#1\\right\\|',
  '\\set': '\\left\\{#1\\right\\}',
  '\\argmin': '\\operatorname*{arg\\,min}',
  '\\argmax': '\\operatorname*{arg\\,max}',
};

export const KATEX_OPTIONS = {
  strict: false,
  throwOnError: false,
  errorColor: 'var(--danger, #e5635b)',
  trust: false,
  output: 'htmlAndMathml',
  maxSize: 200,
  maxExpand: 1000,
};

export function hasMath(text) {
  if (typeof text !== 'string' || !text) return false;
  return text.indexOf('$') !== -1
    || text.indexOf('\\(') !== -1
    || text.indexOf('\\[') !== -1
    || text.indexOf('\\begin{') !== -1
    || text.indexOf('\\ce{') !== -1
    || text.indexOf('\\pu{') !== -1;
}

function splitCode(text) {
  return text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
}

export function wrapMathEnvironments(text) {
  if (typeof text !== 'string' || text.indexOf('\\begin{') === -1) return text;
  const parts = splitCode(text);
  for (let p = 0; p < parts.length; p++) {
    const seg = parts[p];
    if (!seg || seg.startsWith('`') || seg.indexOf('\\begin{') === -1) continue;
    let out = '';
    let i = 0;
    let mathDepth = 0;
    while (i < seg.length) {
      const ch = seg[i];
      if (ch === '\\') {
        if (seg.startsWith('\\begin{', i) && mathDepth === 0) {
          const close = seg.indexOf('}', i + 7);
          const env = close === -1 ? '' : seg.slice(i + 7, close);
          if (env && MATH_ENVIRONMENTS.has(env)) {
            const endTag = '\\end{' + env + '}';
            const end = seg.indexOf(endTag, close);
            if (end !== -1) {
              const body = seg.slice(i, end + endTag.length);
              const before = out.length && !/\n[ \t]*\n[ \t]*$/.test(out) ? '\n\n' : '';
              const rest = seg.slice(end + endTag.length);
              const after = /^[ \t]*$/.test(rest) || /^[ \t]*\n[ \t]*\n/.test(rest) ? '' : '\n\n';
              out += before + '$$\n' + body + '\n$$' + after;
              i = end + endTag.length;
              continue;
            }
          }
        }
        out += seg.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '$') {
        const len = seg[i + 1] === '$' ? 2 : 1;
        mathDepth = mathDepth === 0 ? len : mathDepth === len ? 0 : mathDepth;
        out += seg.slice(i, i + len);
        i += len;
        continue;
      }
      out += ch;
      i++;
    }
    parts[p] = out;
  }
  return parts.join('');
}

let plugin = null;
let loading = null;
let version = 0;
const subs = new Set();

export function katexPlugin() {
  return plugin;
}

export function ensureKatex() {
  if (plugin) return Promise.resolve(plugin);
  if (loading) return loading;
  loading = import('./katexbundle.js')
    .then(mod => {
      plugin = mod.default || mod;
      version++;
      subs.forEach(fn => fn());
      return plugin;
    })
    .catch(() => { loading = null; return null; });
  return loading;
}

export function subscribeKatex(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function katexVersion() {
  return version;
}
