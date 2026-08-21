const MATH_ENVIRONMENTS = new Set([
  'equation', 'equation*', 'align', 'align*', 'aligned', 'alignat', 'alignat*', 'alignedat',
  'gather', 'gather*', 'gathered', 'multline', 'multline*', 'split', 'flalign', 'flalign*',
  'cases', 'dcases', 'rcases', 'darray', 'subarray', 'array',
  'matrix', 'matrix*', 'pmatrix', 'pmatrix*', 'bmatrix', 'bmatrix*', 'Bmatrix', 'Bmatrix*',
  'vmatrix', 'vmatrix*', 'Vmatrix', 'Vmatrix*', 'smallmatrix', 'CD',
  'cases*', 'dcases*', 'rcases*', 'multlined', 'subequations',
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

export const CODE_SPLIT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|``[^`]*``|`[^`\n]*`)/;

function splitCode(text) {
  return text.split(CODE_SPLIT);
}

function isCode(seg) {
  return seg.startsWith('`') || seg.startsWith('~~~');
}

export function wrapMathEnvironments(text) {
  if (typeof text !== 'string' || text.indexOf('\\begin{') === -1) return text;
  const parts = splitCode(text);
  for (let p = 0; p < parts.length; p++) {
    const seg = parts[p];
    if (!seg || isCode(seg) || seg.indexOf('\\begin{') === -1) continue;
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
              // Blank lines are meaningless inside math but they are exactly what
              // blockify splits on, which would tear the wrapped body in half and
              // leave both sides with an unbalanced $$.
              const body = seg.slice(i, end + endTag.length).replace(/\n[ \t]*\n[ \t\n]*/g, '\n');
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
        // A lone `$` — a price, a shell variable — used to latch the depth open for
        // the rest of the segment, so every later \begin{align} went unwrapped. Only
        // enter math when a closing delimiter actually exists ahead.
        if (mathDepth === 0) { if (seg.indexOf(len === 2 ? '$$' : '$', i + len) !== -1) mathDepth = len; }
        else if (mathDepth === len) mathDepth = 0;
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

// `remarkBreaks` keeps single newlines inside one paragraph, so a display block the
// model put on its own line still lands *inside* a paragraph and remark-math reads
// it as inline math. KaTeX then refuses `align`, `gather` and friends with "can be
// used only in display mode". Giving the line blank lines of its own is what makes
// it a block, and therefore display.
export function isolateDisplayMath(text) {
  if (typeof text !== 'string' || text.indexOf('$$') === -1) return text;
  const parts = splitCode(text);
  for (let p = 0; p < parts.length; p++) {
    const seg = parts[p];
    if (!seg || isCode(seg) || seg.indexOf('$$') === -1) continue;
    const lines = seg.split('\n');
    const out = [];
    let open = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const count = (trimmed.match(/\$\$/g) || []).length;
      const whole = !open && count >= 2 && trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4;
      const opens = !open && count === 1 && trimmed.startsWith('$$');
      const closes = open && count === 1 && trimmed.endsWith('$$');
      if (whole || opens) { if (out.length && out[out.length - 1].trim() !== '') out.push(''); }
      // `$$x$$` all on one line is inline math to remark-math, which is why KaTeX
      // answered `align` with "can be used only in display mode". Broken over three
      // lines it becomes flow math, and therefore display.
      if (whole) {
        const inner = trimmed.slice(2, -2).trim();
        if (inner) { out.push('$$', inner, '$$'); } else out.push(line);
      } else out.push(line);
      if (opens) open = true;
      else if (closes) open = false;
      if (whole || closes) { if (i + 1 < lines.length && lines[i + 1].trim() !== '') out.push(''); }
    }
    parts[p] = out.join('\n');
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
