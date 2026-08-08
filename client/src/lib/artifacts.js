export const PREVIEW_HTML = new Set(['html', 'htm', 'svg']);
export const PREVIEW_MD = new Set(['md', 'markdown']);
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);

export const EXT_LANG = { __proto__: null, rs: 'rust', py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', html: 'xml', htm: 'xml', css: 'css', scss: 'scss', json: 'json', md: 'markdown', markdown: 'markdown', sh: 'bash', bash: 'bash', c: 'c', cpp: 'cpp', h: 'cpp', java: 'java', rb: 'ruby', go: 'go', php: 'php', sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', lua: 'lua', glsl: 'glsl', vert: 'glsl', frag: 'glsl', xml: 'xml', svg: 'xml', kt: 'kotlin', swift: 'swift', vue: 'xml' };
export const EXT_COLOR = { __proto__: null, py: '#4b8bf4', js: '#e6b73a', jsx: '#e6b73a', mjs: '#e6b73a', ts: '#3a8ddb', tsx: '#3a8ddb', html: '#e3683c', htm: '#e3683c', css: '#3f7ff0', scss: '#cd6799', json: '#9aa0a6', md: '#8a93a0', markdown: '#8a93a0', sh: '#5bbd6a', bash: '#5bbd6a', rs: '#d6a07a', c: '#6b78c4', cpp: '#6b78c4', h: '#6b78c4', java: '#c0824a', rb: '#c5413b', go: '#39c0d4', php: '#8a8fd0', sql: '#d99440', yml: '#cb4b3e', yaml: '#cb4b3e', toml: '#b08b54', lua: '#5b8df0', svg: '#e3683c', xml: '#e3683c', txt: '#9aa0a6', csv: '#5bbd6a', zip: '#b48ad6' };

export function baseName(p) { return p.split('/').pop(); }
export function extOf(p) { return (p.split('.').pop() || '').toLowerCase(); }

export function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

// The one HTML escaper in the client. Everything that hands a string to
// dangerouslySetInnerHTML goes through here, so there is a single place to audit.
// Quotes are deliberately left alone: the output is only ever element text, never an
// attribute value, and escaping them would show &quot; inside code blocks.
const HTML_ESC = { __proto__: null, '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export function escHtml(s) { return String(s).replace(/[&<>]/g, c => HTML_ESC[c]); }

// rough line diff (LCS); bails out if the file is too big
export function diffLines(a, b) {
  const n = a.length, m = b.length;
  if (n * m > 4000000) return null;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'ctx', text: a[i], key: 'c' + i + '_' + j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i], key: 'd' + i }); i++; }
    else { out.push({ type: 'add', text: b[j], key: 'a' + j }); j++; }
  }
  while (i < n) out.push({ type: 'del', text: a[i++], key: 'd' + i });
  while (j < m) out.push({ type: 'add', text: b[j++], key: 'a' + j });
  return out;
}

export function stableLineDiff(a, b) {
  const n = a.length, m = b.length;
  let lead = 0;
  while (lead < n && lead < m && a[lead] === b[lead]) lead++;
  let trail = 0;
  while (trail < n - lead && trail < m - lead && a[n - 1 - trail] === b[m - 1 - trail]) trail++;
  const rows = [];
  for (let i = 0; i < lead; i++) rows.push({ key: 'b' + i, type: 'ctx', text: a[i] });
  for (let i = lead; i < n - trail; i++) rows.push({ key: 'd' + (i - lead), type: 'del', text: a[i] });
  for (let i = lead; i < m - trail; i++) rows.push({ key: 'a' + (i - lead), type: 'add', text: b[i] });
  for (let i = 0; i < trail; i++) rows.push({ key: 'f' + i, type: 'ctx', text: b[m - trail + i] });
  return rows;
}

export function collapseRuns(rows, keep, expanded) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== 'ctx') { out.push(rows[i]); i++; continue; }
    let j = i; while (j < rows.length && rows[j].type === 'ctx') j++;
    const runLen = j - i;
    const foldKey = 'fold-' + (rows[i].key != null ? rows[i].key : i);
    if (runLen > keep * 2 + 2 && !(expanded && expanded.has(foldKey))) {
      const headEnd = (i === 0) ? i : i + keep;
      const tailStart = (j === rows.length) ? j : j - keep;
      for (let k = i; k < headEnd; k++) out.push(rows[k]);
      out.push({ fold: true, key: foldKey, count: tailStart - headEnd });
      for (let k = tailStart; k < j; k++) out.push(rows[k]);
    } else { for (let k = i; k < j; k++) out.push(rows[k]); }
    i = j;
  }
  return out;
}

export function splitHighlightedLines(html) {
  const lines = [];
  let cur = '';
  const open = [];
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '\n') { cur += '</span>'.repeat(open.length); lines.push(cur); cur = open.join(''); i++; }
    else if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) { cur += html.slice(i); break; }
      const tag = html.slice(i, end + 1);
      cur += tag;
      if (tag[1] === '/') open.pop();
      else if (tag[end - i - 1] !== '/') open.push(tag);
      i = end + 1;
    } else { cur += ch; i++; }
  }
  lines.push(cur);
  return lines;
}

export function markLine(text, matches, activeGid) {
  let out = '', last = 0;
  for (const mch of matches) {
    if (mch.start < last) continue;
    out += escHtml(text.slice(last, mch.start));
    out += `<mark class="art-mark${mch.gid === activeGid ? ' active' : ''}">` + escHtml(text.slice(mch.start, mch.end)) + '</mark>';
    last = mch.end;
  }
  out += escHtml(text.slice(last));
  return out;
}

export function buildTree(files) {
  const root = { dirs: {}, files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) { node.dirs[parts[i]] ||= { dirs: {}, files: [] }; node = node.dirs[parts[i]]; }
    node.files.push(f);
  }
  return root;
}

export function findMatches(lines, query) {
  if (!query) return [];
  const q = query.toLowerCase();
  const out = [];
  for (let li = 0; li < lines.length; li++) {
    const low = lines[li].toLowerCase();
    let from = 0, idx;
    while ((idx = low.indexOf(q, from)) !== -1) { out.push({ line: li, start: idx, end: idx + q.length, gid: out.length }); from = idx + q.length; }
  }
  return out;
}
