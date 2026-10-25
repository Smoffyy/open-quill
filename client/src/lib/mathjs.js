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
      const trimmed = line.trim().split(SENT).join('');
      const count = (trimmed.match(/\$\$/g) || []).length;
      const whole = !open && count === 2 && trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4;
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

export const SENT = '\u0000';

export function normalizeMathDelims(text) {
  if (!text || (text.indexOf('\\[') === -1 && text.indexOf('\\(') === -1)) return text;
  const parts = text.split(CODE_SPLIT);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p.startsWith('`') || p.startsWith('~~~')) continue;
    // `\\` is consumed first and returned untouched, so the row-spacing form
    // `\\[4pt]` inside align/cases/pmatrix keeps its bracket instead of having
    // the second backslash read as the opener of a display-math delimiter.
    parts[i] = p
      .replace(/\\\\|\\\[(\s*)\\\]|\\\((\s*)\\\)/g, (m, sq, rd) => (
        m === '\\\\' ? m : sq !== undefined ? '\\\\[' + sq + '\\\\]' : '\\\\(' + rd + '\\\\)'
      ))
      .replace(/\\\\|\\\[|\\\]|\\\(|\\\)/g, (m) => (
        m === '\\\\' ? m
          : m === '\\[' ? SENT + '$$'
            : m === '\\]' ? '$$' + SENT
              : m === '\\(' ? SENT + '$' : '$' + SENT
      ));
  }
  return parts.join('');
}

const MATH_SPAN = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/;
const BARE_POWER = /(^|[\s(|,;:])([A-Za-z0-9]+\^(?:\d+|[A-Za-z]|\{[^{}\n]+\}))(?=$|[\s).,;:!?|])/gm;

export function wrapBarePowers(text) {
  if (typeof text !== 'string' || text.indexOf('^') === -1) return text;
  const parts = splitCode(text);
  for (let p = 0; p < parts.length; p++) {
    const seg = parts[p];
    if (!seg || isCode(seg) || seg.indexOf('^') === -1) continue;
    const spans = seg.split(MATH_SPAN);
    for (let s = 0; s < spans.length; s += 2) {
      spans[s] = spans[s].replace(BARE_POWER, (m, lead, power) => lead + '$' + power + '$');
    }
    parts[p] = spans.join('');
  }
  return parts.join('');
}

function guardEmptyDisplay(s) {
  const segs = s.split('$$');
  if (segs.length < 3) return s;
  let out = segs[0];
  for (let k = 1; k < segs.length; k++) {
    if (k % 2 === 1 && k + 1 < segs.length && !segs[k].trim()) {
      out += '\\$\\$' + segs[k] + '\\$\\$' + segs[k + 1];
      k++;
      continue;
    }
    out += '$$' + segs[k];
  }
  return out;
}

function closedOnLine(s, i) {
  for (let j = i + 1; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\n') return false;
    if (ch === '\\') { j++; continue; }
    if (ch !== '$') continue;
    return s[j + 1] !== '$' && !/\s/.test(s[j - 1]) && !/\d/.test(s[j + 1] || '');
  }
  return false;
}

function guardDollars(s) {
  if (s.indexOf('$') === -1) return s;
  const singles = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c !== '$') continue;
    if (s[i + 1] === '$') { i++; continue; }
    if (s[i - 1] === SENT || s[i + 1] === SENT) continue;
    singles.push(i);
  }
  if (!singles.length) return s;
  const esc = new Set();
  for (const i of singles) {
    // `$PATH`, `$JAVA_HOME` — shell variables, never math. Two of them in one
    // paragraph used to pair up and get typeset.
    if (/^[A-Z][A-Z0-9_]{1,}\b/.test(s.slice(i + 1, i + 24))) { esc.add(i); continue; }
    const m = /^\d[\d,]*(?:\.\d+)?/.exec(s.slice(i + 1, i + 24));
    if (!m) continue;
    const after = s[i + 1 + m[0].length] || '';
    if (after === '$') continue;
    if (after && '^_{\\'.includes(after)) continue;
    if (closedOnLine(s, i)) continue;
    let mathish = false;
    for (let j = i + 1 + m[0].length; j < Math.min(s.length, i + 260); j++) {
      const ch = s[j];
      if (ch === '\\' || ch === '^' || ch === '_') { mathish = true; break; }
      if (ch === '$' || ch === '\n') break;
    }
    if (!mathish) esc.add(i);
  }
  const rest = singles.filter(i => !esc.has(i));
  const pairs = [];
  for (let k = 0; k + 1 < rest.length; k += 2) {
    const a = rest[k], b = rest[k + 1];
    const inner = s.slice(a + 1, b);
    if (!inner.trim() || inner.includes('**') || inner.includes('\n\n') || inner.length > 300) {
      esc.add(a);
      esc.add(b);
    } else {
      pairs.push([a, b]);
    }
  }
  const needsTrim = pairs.some(([a, b]) => { const c = s[a + 1], d = s[b - 1]; return (c === ' ' || c === '\t') || (d === ' ' || d === '\t'); });
  if (!esc.size && !needsTrim && !pairs.some(([a, b]) => s.slice(a + 1, b).includes('\\$'))) return s;
  let out = '';
  let idx = 0;
  let pi = 0;
  while (idx < s.length) {
    if (pi < pairs.length && idx === pairs[pi][0]) {
      const [a, b] = pairs[pi++];
      let inner = '';
      for (let j = a + 1; j < b; j++) inner += esc.has(j) ? '\\$' : s[j];
      inner = inner.split('\\$').join('\\mdollar ');
      if (/^\s/.test(inner) || /\s$/.test(inner)) inner = inner.trim();
      out += '$' + inner + '$';
      idx = b + 1;
      continue;
    }
    out += esc.has(idx) ? '\\$' : s[idx];
    idx++;
  }
  return out;
}

export function guardBlock(text) {
  if (text.indexOf(SENT) !== -1) {
    text = text.replace(/\u0000(\${1,2})([\s\S]*?)\1\u0000/g, (full, d, inner) => SENT + d + inner.split('\\$').join('\\mdollar ') + d + SENT);
  }
  if (text.indexOf('$') === -1) return text.indexOf(SENT) === -1 ? text : text.split(SENT).join('');
  const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p.startsWith('`')) continue;
    parts[i] = guardDollars(guardEmptyDisplay(p));
  }
  return parts.join('').split(SENT).join('');
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