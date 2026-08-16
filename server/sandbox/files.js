import fs from 'fs';
import path from 'path';
import { dirFor, resolveSafe, relOf } from './paths.js';
import { readMeta, versionOf, bumpVersion, dropVersion, moveVersion, saveSnapshot, forgetMeta, histRoot, metaPath } from './meta.js';
import { extOf, isText, isIgnoredDir, isIgnoredRel, globToRe, gitignoreCacheDrop } from './ignore.js';
import { zipBuffer, unzipBuffer } from './zip.js';
import { compileSearchPattern } from '../lib/sandboxguard.js';
import { runRegexSearch } from './regexsearch.js';

function walkFiles(chatId, { includeIgnored = false, under = '', countHidden = false } = {}) {
  const root = dirFor(chatId);
  const start = under ? resolveSafe(chatId, under) : root;
  const out = [];
  const rels = [];
  let hidden = 0;
  const stack = [[start, under ? relOf(chatId, start) : '']];
  while (stack.length) {
    const [dir, prefix] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!includeIgnored && (isIgnoredDir(e.name) || isIgnoredRel(chatId, rel))) { if (countHidden) hidden += countUnder(abs); continue; }
        stack.push([abs, rel]);
      } else {
        if (!includeIgnored && isIgnoredRel(chatId, rel)) { hidden++; continue; }
        out.push(abs);
        rels.push(rel);
      }
    }
  }
  return { files: out, rels, hidden };
}
function countUnder(dir) {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) { if (e.isDirectory()) stack.push(path.join(cur, e.name)); else n++; }
  }
  return n;
}

export function list(chatId, opts = {}) {
  const includeIgnored = !!(opts.includeIgnored || opts.all);
  const meta = readMeta(chatId).files || {};
  const { files, rels, hidden } = walkFiles(chatId, { includeIgnored, under: opts.under, countHidden: !!opts.withHidden });
  const out = new Array(files.length);
  for (let i = 0; i < files.length; i++) {
    const rel = rels[i];
    let size = 0; try { size = fs.statSync(files[i]).size; } catch {}
    out[i] = { path: rel, ext: extOf(rel), size, v: meta[rel]?.v || 1 };
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return opts.withHidden ? { files: out, hidden } : out;
}

export function dirSize(chatId) {
  let total = 0;
  for (const abs of walkFiles(chatId, { includeIgnored: true }).files) { try { total += fs.statSync(abs).size; } catch {} }
  return total;
}
export function capError(maxBytes) { return { ok: false, error: `Sandbox storage limit reached (${Math.round(maxBytes / 1048576)} MB). Delete files to free space.` }; }
export function overCap(chatId, incomingBytes, maxBytes) { if (!maxBytes || maxBytes <= 0) return false; return dirSize(chatId) + incomingBytes > maxBytes; }

export function remove(chatId) {
  try { fs.rmSync(dirFor(chatId), { recursive: true, force: true }); } catch {}
  try { fs.rmSync(metaPath(chatId), { force: true }); } catch {}
  try { fs.rmSync(histRoot(chatId), { recursive: true, force: true }); } catch {}
  forgetMeta(chatId);
  gitignoreCacheDrop(chatId);
}
export function clearAll(chatId) {
  const root = dirFor(chatId);
  let cleared = 0;
  try { for (const e of fs.readdirSync(root)) { fs.rmSync(path.join(root, e), { recursive: true, force: true }); cleared++; } } catch {}
  try { fs.rmSync(metaPath(chatId), { force: true }); } catch {}
  try { fs.rmSync(histRoot(chatId), { recursive: true, force: true }); } catch {}
  forgetMeta(chatId);
  gitignoreCacheDrop(chatId);
  return { ok: true, cleared };
}

function lineDelta(prev, next) {
  const na = next == null ? [] : String(next).split('\n');
  if (prev == null) return { adds: (na.length === 1 && na[0] === '') ? 0 : na.length, dels: 0 };
  const pa = String(prev).split('\n');
  const count = new Map();
  for (const l of pa) count.set(l, (count.get(l) || 0) - 1);
  for (const l of na) count.set(l, (count.get(l) || 0) + 1);
  let adds = 0, dels = 0;
  for (const v of count.values()) { if (v > 0) adds += v; else if (v < 0) dels += -v; }
  return { adds, dels };
}

export function readText(chatId, rel) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return null;
  return fs.readFileSync(p, 'utf8');
}
export function readBuffer(chatId, rel) { return fs.readFileSync(resolveSafe(chatId, rel)); }

export function createFile(chatId, rel, content) {
  const p = resolveSafe(chatId, rel);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return { ok: false, error: `${rel} is a directory` };
  const prev = (fs.existsSync(p) && isText(rel)) ? fs.readFileSync(p, 'utf8') : null;
  const body = content ?? '';
  if (prev != null && prev === body) return { ok: true, path: rel, bytes: Buffer.byteLength(body), v: versionOf(chatId, rel), adds: 0, dels: 0, unchanged: true };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
  const v = bumpVersion(chatId, rel);
  if (isText(rel)) saveSnapshot(chatId, rel, v, body);
  const { adds, dels } = lineDelta(prev, body);
  return { ok: true, path: rel, bytes: Buffer.byteLength(body), v, adds, dels };
}

function countOccurrences(hay, needle) { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; }

const normEol = (s) => String(s).replace(/\r\n/g, '\n');
const indentOf = (line) => (line.match(/^[ \t]*/) || [''])[0];

function fuzzyWindow(text, oldStr) {
  const fileLines = text.split('\n');
  const oldLines = normEol(oldStr).split('\n');
  while (oldLines.length && !oldLines[0].trim()) oldLines.shift();
  while (oldLines.length && !oldLines[oldLines.length - 1].trim()) oldLines.pop();
  if (!oldLines.length) return null;
  const want = oldLines.map(l => l.trim());
  const at = [];
  for (let i = 0; i + want.length <= fileLines.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length; j++) { if (fileLines[i + j].trim() !== want[j]) { ok = false; break; } }
    if (ok) at.push(i);
  }
  if (at.length !== 1) return { hits: at.length };
  const starts = [];
  let off = 0;
  for (const l of fileLines) { starts.push(off); off += l.length + 1; }
  const i = at[0], last = i + want.length - 1;
  return {
    hits: 1,
    start: starts[i],
    end: starts[last] + fileLines[last].length,
    indent: indentOf(fileLines[i]),
    oldIndent: indentOf(oldLines[0])
  };
}

function reindent(s, from, to) {
  if (from === to) return s;
  return normEol(s).split('\n').map(l => {
    if (!l.trim()) return l;
    if (from && l.startsWith(from)) return to + l.slice(from.length);
    return to + l;
  }).join('\n');
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i + 1 < s.length; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); }
  return out;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0, total = 0;
  for (const n of a.values()) total += n;
  for (const [g, n] of b) { total += n; shared += Math.min(n, a.get(g) || 0); }
  return (2 * shared) / total;
}

function nearestRegion(text, oldStr) {
  const fileLines = text.split('\n');
  const first = normEol(oldStr).split('\n').map(l => l.trim()).find(Boolean);
  if (!first) return null;
  const want = bigrams(first.slice(0, 200));
  let best = -1, score = 0;
  for (let i = 0; i < fileLines.length; i++) {
    const t = fileLines[i].trim();
    if (!t) continue;
    const s = t === first ? 1 : dice(want, bigrams(t.slice(0, 200)));
    if (s > score) { score = s; best = i; }
  }
  if (best < 0 || score < 0.4) return null;
  const from = Math.max(0, best - 2), to = Math.min(fileLines.length - 1, best + 4);
  return fileLines.slice(from, to + 1).map((l, k) => `${from + k + 1}\t${l}`).join('\n');
}

export function strReplace(chatId, rel, oldStr, newStr, replaceAll = false) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `File not found: ${rel}. Create it with create_file first.` };
  if (fs.statSync(p).isDirectory()) return { ok: false, error: `${rel} is a directory` };
  if (oldStr == null || oldStr === '') return { ok: false, error: 'old_str is empty; provide the exact text to replace, or use create_file to write a new file.' };
  const repl = newStr ?? '';
  if (oldStr === repl) return { ok: false, error: 'old_str and new_str are identical; nothing to change.' };
  const text = fs.readFileSync(p, 'utf8');

  const commit = (next, extra) => {
    fs.writeFileSync(p, next, 'utf8');
    const v = bumpVersion(chatId, rel);
    saveSnapshot(chatId, rel, v, next);
    const { adds, dels } = lineDelta(text, next);
    return { ok: true, path: rel, v, adds, dels, ...extra };
  };

  let needle = oldStr;
  let hits = countOccurrences(text, needle);
  let note = null;
  if (hits === 0 && text.includes('\r\n') !== oldStr.includes('\r\n')) {
    const alt = text.includes('\r\n') ? normEol(oldStr).replace(/\n/g, '\r\n') : normEol(oldStr);
    const n = countOccurrences(text, alt);
    if (n > 0) { needle = alt; hits = n; note = 'old_str matched only after line endings were normalized.'; }
  }

  if (hits === 0) {
    const fz = fuzzyWindow(text, oldStr);
    if (fz && fz.hits === 1) {
      const body = reindent(repl, fz.oldIndent, fz.indent);
      return commit(text.slice(0, fz.start) + body + text.slice(fz.end), {
        replaced: 1,
        note: 'old_str did not match exactly; it was matched ignoring indentation and the edit was applied with the file\'s own indentation. Copy text out of view to match exactly.'
      });
    }
    const region = nearestRegion(text, oldStr);
    const amb = fz && fz.hits > 1 ? ` Ignoring indentation it matches ${fz.hits} places, so include more surrounding lines to make it unique.` : '';
    return {
      ok: false,
      error: `old_str was not found in ${rel}. View the file and copy the exact text; whitespace and indentation must match.${amb}`
        + (region ? `\nThe closest text in the file is:\n${region}` : '')
    };
  }

  if (hits > 1 && !replaceAll) return { ok: false, error: `old_str is not unique (${hits} matches). Add surrounding lines to make it unique, or pass replace_all: true to change every occurrence.` };
  const next = replaceAll ? text.split(needle).join(repl) : (() => { const i = text.indexOf(needle); return text.slice(0, i) + repl + text.slice(i + needle.length); })();
  return commit(next, { replaced: replaceAll ? hits : 1, ...(note ? { note } : {}) });
}

export function insertLines(chatId, rel, atLine, content) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `File not found: ${rel}` };
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split('\n');
  const insert = String(content ?? '').split('\n');
  const at = Number.isInteger(atLine) ? Math.max(0, Math.min(lines.length, atLine)) : lines.length;
  lines.splice(at, 0, ...insert);
  const next = lines.join('\n');
  fs.writeFileSync(p, next, 'utf8');
  const v = bumpVersion(chatId, rel);
  saveSnapshot(chatId, rel, v, next);
  return { ok: true, path: rel, v, adds: insert.length, dels: 0 };
}

export function treeString(chatId, under, includeIgnored, cap = 400) {
  const root = dirFor(chatId);
  const start = under ? resolveSafe(chatId, under) : root;
  const lines = [];
  let shown = 0, hidden = 0;
  const walk = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (shown >= cap) return;
      const abs = path.join(dir, e.name);
      const rel = relOf(chatId, abs);
      if (e.isDirectory()) {
        if (!includeIgnored && (isIgnoredDir(e.name) || isIgnoredRel(chatId, rel))) { hidden++; lines.push(`${prefix}${e.name}/  (ignored)`); continue; }
        lines.push(`${prefix}${e.name}/`); shown++;
        walk(abs, prefix + '  ');
      } else {
        if (!includeIgnored && isIgnoredRel(chatId, rel)) { hidden++; continue; }
        let size = 0; try { size = fs.statSync(abs).size; } catch {}
        lines.push(`${prefix}${e.name}  (${size}b)`); shown++;
      }
    }
  };
  walk(start, '');
  let out = lines.join('\n') || '(empty)';
  if (shown >= cap) out += `\n… (truncated at ${cap} entries; use find or view a subdirectory)`;
  return { text: out, shown, hidden };
}

export function view(chatId, rel, start, end) {
  const p = resolveSafe(chatId, rel || '');
  if (!fs.existsSync(p)) return { ok: false, error: `Not found: ${rel}` };
  if (fs.statSync(p).isDirectory()) {
    const t = treeString(chatId, rel || '', false);
    return { ok: true, path: rel || '.', dir: true, content: t.text, hidden: t.hidden };
  }
  if (!isText(rel)) { let size = 0; try { size = fs.statSync(p).size; } catch {} return { ok: true, path: rel, content: `[binary file, ${size} bytes; not shown as text]`, binary: true }; }
  const all = fs.readFileSync(p, 'utf8').split('\n');
  let s = 1, e = all.length;
  if (Number.isInteger(start)) s = Math.max(1, start);
  if (Number.isInteger(end)) e = Math.min(all.length, end);
  if (s > e) s = e;
  const width = String(e).length;
  let body = all.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(width)}\t${l}`).join('\n');
  let note = '';
  if (body.length > 12000) {
    let cut = body.lastIndexOf('\n', 12000);
    if (cut < 1) cut = 12000;
    body = body.slice(0, cut);
    note = `\n... [truncated; the file has ${all.length} lines, page through it with start/end]`;
  } else if (s > 1 || e < all.length) note = `\n[lines ${s}-${e} of ${all.length}]`;
  return { ok: true, path: rel, content: body + note, lines: all.length };
}

export function deleteFile(chatId, rel) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `Not found: ${rel}` };
  const wasDir = fs.statSync(p).isDirectory();
  if (wasDir) for (const f of list(chatId, { all: true, under: rel })) dropVersion(chatId, f.path);
  fs.rmSync(p, { recursive: true, force: true });
  dropVersion(chatId, rel);
  return { ok: true, path: rel, dir: wasDir };
}

export function renameFile(chatId, rel, newRel) {
  if (!newRel) return { ok: false, error: 'new_path is required' };
  const src = resolveSafe(chatId, rel);
  const dst = resolveSafe(chatId, newRel);
  if (!fs.existsSync(src)) return { ok: false, error: `Not found: ${rel}` };
  const before = fs.statSync(src).isDirectory() ? list(chatId, { all: true, under: rel }).map(f => f.path) : null;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  if (before) for (const oldRel of before) moveVersion(chatId, oldRel, newRel + oldRel.slice(rel.length));
  else moveVersion(chatId, rel, newRel);
  return { ok: true, path: newRel, from: rel };
}

function dirEntrySize(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) total += dirEntrySize(path.join(p, e.name));
  return total;
}
export function copyFile(chatId, rel, newRel, maxBytes = 0) {
  if (!newRel) return { ok: false, error: 'new_path is required' };
  const src = resolveSafe(chatId, rel);
  if (!fs.existsSync(src)) return { ok: false, error: `Not found: ${rel}` };
  const dst = resolveSafe(chatId, newRel);
  let incoming = 0; try { incoming = dirEntrySize(src); } catch {}
  if (overCap(chatId, incoming, maxBytes)) return capError(maxBytes);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
  const created = [];
  const stamp = (r) => { const v = bumpVersion(chatId, r); if (isText(r)) { try { saveSnapshot(chatId, r, v, fs.readFileSync(resolveSafe(chatId, r), 'utf8')); } catch {} } created.push(r); };
  if (fs.statSync(dst).isDirectory()) { for (const f of list(chatId, { all: true })) if (f.path === newRel || f.path.startsWith(newRel + '/')) stamp(f.path); }
  else stamp(newRel);
  return { ok: true, path: newRel, from: rel, count: created.length };
}
export function makeDir(chatId, rel) {
  if (!rel) return { ok: false, error: 'path is required' };
  fs.mkdirSync(resolveSafe(chatId, rel), { recursive: true });
  return { ok: true, path: rel };
}

const SEARCH_CAP = 100;
const SEARCH_TIMEOUT_MS = 5000;
// Backtracking cost grows with the length of the text, so a very long line — a minified
// bundle, a base64 blob — is the worst thing to hand a regex. Matching is capped; a hit
// past this point in a single line is not something a person is reading anyway.
const SEARCH_LINE_MAX = 4000;

// Which files a search would look at, after the ignore rules and the caller's filter.
function searchCandidates(chatId, filter) {
  const fre = filter && (filter.includes('*') || filter.includes('/') || filter.includes('?')) ? globToRe(filter) : null;
  const needle = filter ? String(filter).toLowerCase() : '';
  const out = [];
  for (const f of list(chatId)) {
    if (f.ext === 'zip' || !isText(f.path)) continue;
    if (filter && (fre ? !fre.test(f.path) : !f.path.toLowerCase().includes(needle))) continue;
    try { out.push({ rel: f.path, abs: resolveSafe(chatId, f.path) }); } catch {}
  }
  return out;
}

export async function search(chatId, query, filter, useRegex = false) {
  if (!query) return { ok: false, error: 'query is required' };
  const files = searchCandidates(chatId, filter);

  if (useRegex) {
    // Compile here first: a pattern that is malformed, absurdly long, or one of the
    // known catastrophic shapes gets a specific error rather than a generic timeout,
    // and we avoid paying for a worker to find that out.
    const compiled = compileSearchPattern(query);
    if (!compiled.ok) return { ok: false, error: compiled.error };
    const r = await runRegexSearch({ files, source: compiled.re.source, flags: compiled.re.flags, cap: SEARCH_CAP, lineMax: SEARCH_LINE_MAX, timeoutMs: SEARCH_TIMEOUT_MS });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, matches: r.matches, count: r.matches.length, truncated: r.truncated };
  }

  // Plain substring: String.includes cannot backtrack, so this is safe in-process.
  const q = String(query).toLowerCase();
  const out = [];
  for (const f of files) {
    const txt = readText(chatId, f.rel);
    if (txt == null) continue;
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(q)) continue;
      out.push({ path: f.rel, line: i + 1, text: lines[i].trim().slice(0, 240) });
      if (out.length >= SEARCH_CAP) break;
    }
    if (out.length >= SEARCH_CAP) break;
  }
  return { ok: true, matches: out, count: out.length, truncated: out.length >= SEARCH_CAP };
}

export function findFiles(chatId, pattern, includeIgnored = false) {
  if (!pattern) return { ok: false, error: 'pattern is required' };
  const clean = String(pattern).replace(/^\.?\/+/, '');
  const re = globToRe(clean);
  const bare = !clean.includes('/') ? globToRe('**/' + clean) : null;
  const matches = [];
  for (const f of list(chatId, { all: includeIgnored })) {
    if (re.test(f.path) || (bare && bare.test(f.path))) matches.push({ path: f.path, size: f.size });
    if (matches.length >= 300) break;
  }
  return { ok: true, pattern, matches, count: matches.length };
}

export function bundleZip(chatId, name, paths, includeIgnored = false) {
  const all = list(chatId, { all: includeIgnored });
  const picked = (paths && paths.length ? paths : all.map(f => f.path)).filter(p => p && !p.endsWith('.zip'));
  const entries = [];
  for (const rel of picked) { try { const abs = resolveSafe(chatId, rel); if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) entries.push({ name: rel, data: fs.readFileSync(abs) }); } catch {} }
  if (!entries.length) return { ok: false, error: 'No files to bundle.' };
  const zipName = (name || 'bundle').replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/\.zip$/i, '') + '.zip';
  fs.writeFileSync(resolveSafe(chatId, zipName), zipBuffer(entries));
  return { ok: true, path: zipName, count: entries.length };
}
export function zipAll(chatId) {
  const entries = list(chatId, { all: true }).filter(f => f.ext !== 'zip').map(f => ({ name: f.path, data: readBuffer(chatId, f.path) }));
  return zipBuffer(entries);
}


export function extractZip(chatId, rel, dest, budget = 0) {
  const p = resolveSafe(chatId, rel);
  if (!fs.existsSync(p)) return { ok: false, error: `Not found: ${rel}` };
  let entries;
  try { entries = unzipBuffer(fs.readFileSync(p)); } catch (e) { return { ok: false, error: 'Could not read the zip: ' + e.message }; }
  if (!entries.length) return { ok: false, error: 'Zip is empty or uses an unsupported compression method.' };
  const MAX_ENTRIES = 5000, MAX_TOTAL = budget > 0 ? Math.min(budget, 250 * 1024 * 1024) : 250 * 1024 * 1024;
  let total = 0, skipped = 0, deps = 0;
  const base = String(dest || '').replace(/^\/+|\/+$/g, '');
  const created = [];
  for (const e of entries) {
    if (created.length >= MAX_ENTRIES || total + e.data.length > MAX_TOTAL) { skipped++; continue; }
    const rel2 = (base ? base + '/' : '') + e.name;
    const isDep = rel2.split('/').slice(0, -1).some(isIgnoredDir);
    total += e.data.length;
    try {
      const outP = resolveSafe(chatId, rel2);
      fs.mkdirSync(path.dirname(outP), { recursive: true });
      fs.writeFileSync(outP, e.data);
      if (isDep) deps++;
      else { const v = bumpVersion(chatId, rel2); if (isText(rel2)) saveSnapshot(chatId, rel2, v, e.data.toString('utf8')); created.push(rel2); }
    } catch {}
  }
  gitignoreCacheDrop(chatId);
  const notes = [];
  if (deps) notes.push(`${deps} file(s) in dependency/build folders extracted but hidden from listings`);
  if (skipped) notes.push(`${skipped} entries skipped (size/count limit)`);
  return { ok: true, path: rel, count: created.length, files: created.slice(0, 200), deps, ...(notes.length ? { note: notes.join('; ') } : {}) };
}
export function importBuffer(chatId, destRel, buffer, maxBytes = 0) {
  if (overCap(chatId, buffer.length, maxBytes)) return capError(maxBytes);
  try {
    const p = resolveSafe(chatId, destRel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buffer);
    const v = bumpVersion(chatId, destRel);
    if (isText(destRel)) saveSnapshot(chatId, destRel, v, buffer.toString('utf8'));
    return { ok: true, path: destRel };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
