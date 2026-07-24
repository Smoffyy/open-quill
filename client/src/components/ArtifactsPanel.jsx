import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import hljs from 'highlight.js';
import { api } from '../api.js';
import { copyText } from '../clipboard.js';
import Markdown from './Markdown.jsx';
import { Download, Refresh, FileText, Copy, Check, ChevDown, Folder, Chevron, Search, X, Down, Panel } from './icons.jsx';
import { t } from '../i18n.jsx';

const PREVIEW_HTML = new Set(['html', 'htm', 'svg']);
const PREVIEW_MD = new Set(['md', 'markdown']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);
const HL_MAX_LINES = 5000;

const EXT_LANG = { rs: 'rust', py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', html: 'xml', htm: 'xml', css: 'css', scss: 'scss', json: 'json', md: 'markdown', markdown: 'markdown', sh: 'bash', bash: 'bash', c: 'c', cpp: 'cpp', h: 'cpp', java: 'java', rb: 'ruby', go: 'go', php: 'php', sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', lua: 'lua', glsl: 'glsl', vert: 'glsl', frag: 'glsl', xml: 'xml', svg: 'xml', kt: 'kotlin', swift: 'swift', vue: 'xml' };
const EXT_COLOR = { py: '#4b8bf4', js: '#e6b73a', jsx: '#e6b73a', mjs: '#e6b73a', ts: '#3a8ddb', tsx: '#3a8ddb', html: '#e3683c', htm: '#e3683c', css: '#3f7ff0', scss: '#cd6799', json: '#9aa0a6', md: '#8a93a0', markdown: '#8a93a0', sh: '#5bbd6a', bash: '#5bbd6a', rs: '#d6a07a', c: '#6b78c4', cpp: '#6b78c4', h: '#6b78c4', java: '#c0824a', rb: '#c5413b', go: '#39c0d4', php: '#8a8fd0', sql: '#d99440', yml: '#cb4b3e', yaml: '#cb4b3e', toml: '#b08b54', lua: '#5b8df0', svg: '#e3683c', xml: '#e3683c', txt: '#9aa0a6', csv: '#5bbd6a', zip: '#b48ad6' };

const SCROLL_MEM = new Map();

function baseName(p) { return p.split('/').pop(); }
function extOf(p) { return (p.split('.').pop() || '').toLowerCase(); }
function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function escHtml(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function FileChip({ ext, size = 'sm' }) {
  const e = (ext || '').toLowerCase();
  const color = EXT_COLOR[e] || '#9aa0a6';
  const label = (ext || 'file').toUpperCase().slice(0, 4);
  return <span className={'file-chip ' + size} style={{ color, background: color + '24' }}>{label}</span>;
}

// rough line diff (LCS); bails out if the file is too big
function diffLines(a, b) {
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

function stableLineDiff(a, b) {
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

function collapseRuns(rows, keep, expanded) {
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

function splitHighlightedLines(html) {
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

function markLine(text, matches, activeGid) {
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

function useFrameThrottle(value, active) {
  const [v, setV] = useState(value);
  const latest = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    latest.current = value;
    if (!active) { if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; } setV(value); return; }
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; setV(latest.current); });
  }, [value, active]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  return active ? v : value;
}

function ImageView({ src, alt }) {
  const [z, setZ] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const onWheel = (e) => { e.preventDefault(); setZ(v => Math.min(8, Math.max(0.2, v * (e.deltaY < 0 ? 1.12 : 0.89)))); };
  const onDown = (e) => { drag.current = { x: e.clientX - off.x, y: e.clientY - off.y }; };
  const onMove = (e) => { if (!drag.current) return; setOff({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); };
  const onUp = () => { drag.current = null; };
  const reset = () => { setZ(1); setOff({ x: 0, y: 0 }); };
  return (
    <div className="art-imgwrap">
      <div className="art-imgstage" onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onDoubleClick={reset} style={{ cursor: z > 1 ? 'grab' : 'default' }}>
        <img className="art-img" src={src} alt={alt} draggable={false} style={{ transform: `translate(${off.x}px, ${off.y}px) scale(${z})` }} />
      </div>
      <div className="art-imgbar">
        <button className="art-btn icon" onClick={() => setZ(v => Math.max(0.2, v * 0.8))} title="Zoom out">−</button>
        <span className="art-imgzoom">{Math.round(z * 100)}%</span>
        <button className="art-btn icon" onClick={() => setZ(v => Math.min(8, v * 1.25))} title="Zoom in">+</button>
        <button className="art-btn icon" onClick={reset} title="Reset">⤢</button>
        <a className="art-btn copy" href={src} style={{ borderRadius: 8 }}><Download style={{ width: 14 }} /> Download</a>
      </div>
    </div>
  );
}

function Viewer({ chatId, path, onBack, canBack, liveText, liveInfo = null, writingElsewhere, onJumpToLive, committed = true, pendingText = null, fileV = 0, headerExtra = null, onFocusPane }) {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const [diff, setDiff] = useState(false);
  const [wrap, setWrap] = useState(() => localStorage.getItem('oq-art-wrap') === '1');
  const [prev, setPrev] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [baseText, setBaseText] = useState(null);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  const loadTok = useRef(0);
  const searchInputRef = useRef(null);

  const ext = extOf(path);
  const isLive = liveText != null;
  const canPreview = PREVIEW_HTML.has(ext) || PREVIEW_MD.has(ext);
  const [mode, setMode] = useState(() => (PREVIEW_HTML.has(ext) ? 'preview' : 'code'));
  useEffect(() => { setMode(PREVIEW_HTML.has(extOf(path)) ? 'preview' : 'code'); }, [path]);
  const previewOn = canPreview && mode === 'preview' && !isLive && !diff;
  const liveEdit = isLive && liveInfo && liveInfo.tool === 'str_replace';
  const rawStream = isLive ? liveText : (!committed && pendingText != null ? pendingText : null);
  const fromStream = rawStream != null;
  const streamText = useFrameThrottle(rawStream ?? '', fromStream);

  useEffect(() => { setExpanded(new Set()); }, [path, diff]);
  useEffect(() => { setWrap(localStorage.getItem('oq-art-wrap') === '1'); }, [path]);
  useEffect(() => { if (search && searchInputRef.current) searchInputRef.current.focus(); }, [search]);

  useEffect(() => {
    if (!liveEdit) { setBaseText(null); return; }
    if (baseText != null) return;
    let on = true;
    api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}`)
      .then(r => { if (on) setBaseText(r.text ?? ''); }).catch(() => { if (on) setBaseText(''); });
    return () => { on = false; };
  }, [liveEdit, path, chatId]);

  const liveDiff = useMemo(() => {
    if (!liveEdit || baseText == null) return null;
    const oldStr = liveInfo.oldStr || '';
    const newStr = streamText || '';
    const idx = oldStr ? baseText.indexOf(oldStr) : -1;
    const result = idx !== -1 ? baseText.slice(0, idx) + newStr + baseText.slice(idx + oldStr.length) : baseText;
    return { rows: stableLineDiff(baseText.split('\n'), result.split('\n')) };
  }, [liveEdit, baseText, streamText, liveInfo]);

  async function load(v, { blank = false } = {}) {
    const tok = ++loadTok.current;
    if (blank) setData(null);
    try { const r = await api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}${v ? '&v=' + v : ''}`); if (tok === loadTok.current) setData(r); }
    catch { if (tok === loadTok.current) setData({ error: true }); }
  }
  useEffect(() => { if (isLive) return; if (committed) { setDiff(false); setPrev(null); load(undefined, { blank: true }); } else setData(null); }, [path, isLive, committed]);

  const pinnedOld = data && data.viewing && data.v && data.viewing !== data.v;
  useEffect(() => {
    if (isLive || !committed || !fileV) return;
    if (pinnedOld) return;
    if (data && data.v === fileV) return;
    load();
  }, [fileV]);

  const viewingV = data?.viewing;
  useEffect(() => {
    if (!diff || !viewingV || viewingV <= 1) { setPrev(null); return; }
    let on = true; setPrev(null);
    api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}&v=${viewingV - 1}`)
      .then(r => { if (on) setPrev(r.text ?? ''); }).catch(() => { if (on) setPrev(''); });
    return () => { on = false; };
  }, [diff, viewingV, path, chatId]);

  const shownText = fromStream ? streamText : (data?.text != null ? data.text : null);
  const rawLines = useMemo(() => shownText != null ? shownText.split('\n') : [], [shownText]);
  const bigFile = rawLines.length > HL_MAX_LINES;
  const lineHtmls = useMemo(() => {
    if (shownText == null) return [];
    if (bigFile || (fromStream && shownText.length > 40000)) return rawLines.map(escHtml);
    const lang = EXT_LANG[(fromStream ? ext : (data?.ext || '').toLowerCase())];
    try {
      let full;
      if (lang && hljs.getLanguage(lang)) full = hljs.highlight(shownText, { language: lang, ignoreIllegals: true }).value;
      else if (fromStream) return rawLines.map(escHtml);
      else full = hljs.highlightAuto(shownText).value;
      return splitHighlightedLines(full);
    } catch { return rawLines.map(escHtml); }
  }, [shownText, fromStream, bigFile]);

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.toLowerCase();
    const out = [];
    for (let li = 0; li < rawLines.length; li++) {
      const low = rawLines[li].toLowerCase();
      let from = 0, idx;
      while ((idx = low.indexOf(q, from)) !== -1) { out.push({ line: li, start: idx, end: idx + q.length, gid: out.length }); from = idx + q.length; }
    }
    return out;
  }, [query, rawLines]);
  useEffect(() => { setMatchIdx(0); }, [query]);
  const matchesByLine = useMemo(() => { const m = new Map(); for (const x of matches) { if (!m.has(x.line)) m.set(x.line, []); m.get(x.line).push(x); } return m; }, [matches]);
  const activeMatch = matches[matchIdx] || null;

  const diffRows = useMemo(() => {
    if (!diff || prev == null || data?.text == null) return null;
    const raw = diffLines(prev.split('\n'), data.text.split('\n'));
    return raw == null ? null : collapseRuns(raw, 3, expanded);
  }, [diff, prev, data, expanded]);
  const liveRows = useMemo(() => liveDiff ? collapseRuns(liveDiff.rows, 4, expanded) : null, [liveDiff, expanded]);

  async function copy() { const text = data?.text != null ? data.text : shownText; if (text != null && await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }
  async function restore() {
    if (restoring || !viewing) return;
    setRestoring(true);
    try { await api.post(`/api/chats/${chatId}/restore`, { path, v: viewing }); await load(); } catch {}
    setRestoring(false);
  }

  const bodyRef = useRef(null);
  const codeRef = useRef(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const progUntil = useRef(0);
  const touchY = useRef(0);
  const liveActive = isLive || liveEdit;
  const scrollKey = chatId + '::' + path;

  useEffect(() => { followRef.current = true; setFollowing(true); }, [path]);

  const restoreScroll = useCallback(() => {
    const el = bodyRef.current; if (!el) return;
    const want = SCROLL_MEM.get(scrollKey) || 0;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    progUntil.current = Date.now() + 160;
    el.scrollTop = Math.min(want, max);
  }, [scrollKey]);

  useLayoutEffect(() => {
    if (liveActive && followRef.current) {
      const el = bodyRef.current;
      if (el) { progUntil.current = Date.now() + 160; el.scrollTop = el.scrollHeight; }
    }
  }, [streamText, liveActive]);

  useLayoutEffect(() => {
    if (liveActive && followRef.current) return;
    restoreScroll();
  }, [path, mode, diff, wrap, previewOn, data?.viewing, shownText != null, restoreScroll]);

  useLayoutEffect(() => {
    if (!activeMatch) return;
    const el = codeRef.current; if (!el) return;
    const node = el.querySelector('.art-line.hit');
    if (node && node.scrollIntoView) { progUntil.current = Date.now() + 160; node.scrollIntoView({ block: 'center' }); }
  }, [matchIdx, activeMatch, query]);

  function onBodyScroll() {
    const el = bodyRef.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    if (Date.now() > progUntil.current) SCROLL_MEM.set(scrollKey, el.scrollTop);
    if (liveActive && atBottom && !followRef.current) { followRef.current = true; setFollowing(true); }
  }
  function stopFollow() { if (liveActive && followRef.current) { followRef.current = false; setFollowing(false); } }
  function onBodyWheel(e) { if (e.deltaY < 0) stopFollow(); }
  function onBodyTouchStart(e) { touchY.current = e.touches[0]?.clientY || 0; }
  function onBodyTouchMove(e) { const y = e.touches[0]?.clientY || 0; if (y > touchY.current + 2) stopFollow(); touchY.current = y; }
  function jumpLatest() { followRef.current = true; setFollowing(true); const el = bodyRef.current; if (el) { progUntil.current = Date.now() + 160; el.scrollTop = el.scrollHeight; } }
  function nextMatch(d) { if (!matches.length) return; setMatchIdx(i => (i + d + matches.length) % matches.length); }
  function onSearchKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); nextMatch(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); setSearch(false); setQuery(''); }
  }

  function jumpToChange() {
    const el = codeRef.current || bodyRef.current;
    const node = el && el.querySelector('.art-diff-line.add, .art-diff-line.del');
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center' });
  }

  const versions = data?.versions || [];
  const viewing = data?.viewing;
  const current = data?.v;
  const stale = viewing && current && viewing !== current;
  const showText = (fromStream || (committed && data && data.text != null));
  const isCode = !liveEdit && showText && !diff && !previewOn;
  const crumbs = path.split('/');

  const renderDiffRows = (rows, live) => (
    <div className={'art-diff' + (live ? ' live' : '') + (wrap ? ' wrap' : '')} ref={live ? codeRef : undefined}>
      {(rows || []).map((r) => r.fold
        ? <button key={r.key} className="art-fold" onClick={() => setExpanded(s => { const n = new Set(s); n.add(r.key); return n; })}>⋯ {r.count} unchanged line{r.count === 1 ? '' : 's'}</button>
        : (
          <div key={r.key} className={'art-diff-line ' + r.type}>
            <span className="art-diff-sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ''}</span>
            <span className="art-diff-text">{r.text || ' '}</span>
          </div>
        ))}
      {live && <span className="live-caret diff" />}
    </div>
  );

  return (
    <div className="art-viewer" onMouseDown={onFocusPane}>
      <div className="art-vhead">
        <div className="art-vtitle">
          {canBack && <button className="art-back" onClick={onBack} title="Back to files"><Chevron style={{ width: 16, transform: 'rotate(180deg)' }} /></button>}
          <FileChip ext={ext} />
          <div className="art-crumbs">
            {crumbs.map((c, i) => (
              <span key={i} className="art-crumb-wrap">
                {i > 0 && <span className="art-crumb-sep">/</span>}
                {i < crumbs.length - 1
                  ? <button className="art-crumb" onClick={onBack} title="Back to files">{c}</button>
                  : <span className="art-crumb name">{c}</span>}
              </span>
            ))}
          </div>
          {isLive && <span className="art-ver writing">{liveEdit ? t('editing…') : (liveText && liveText.length ? t('writing…') : t('creating…'))}</span>}
          {!isLive && viewing && <span className={'art-ver' + (stale ? ' stale' : '')}>v{viewing}{stale ? ` of ${current}` : ''}</span>}
          {isCode && rawLines.length > 0 && <span className="art-ver muted">{rawLines.length} ln</span>}
        </div>
        <div className="art-vactions">
          {canPreview && !isLive && showText && (
            <div className="art-mode-seg">
              <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>{t('Preview')}</button>
              <button className={mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>{t('Code')}</button>
            </div>
          )}
          {showText && !previewOn && !isLive && <button className={'art-btn icon' + (search ? ' on' : '')} onClick={() => setSearch(s => !s)} title={t('Find in file')}><Search style={{ width: 14 }} /></button>}
          {isCode && <button className={'art-btn icon' + (wrap ? ' on' : '')} onClick={() => setWrap(w => { localStorage.setItem('oq-art-wrap', w ? '0' : '1'); return !w; })} title={t('Toggle word wrap')}>↩</button>}
          {!isLive && data?.text != null && viewing > 1 && (
            <button className={'art-btn icon' + (diff ? ' on' : '')} onClick={() => setDiff(d => !d)} title={t('Show changes from previous version')}>{t('Diff')}</button>
          )}
          {!isLive && data?.text != null && (
            <div className="art-copy-wrap">
              <button className="art-btn copy" onClick={copy}>{copied ? <Check style={{ width: 14 }} /> : <Copy style={{ width: 14 }} />} {copied ? 'Copied' : 'Copy'}</button>
              <button className="art-btn caret" onClick={() => setMenu(m => !m)}><ChevDown style={{ width: 13 }} /></button>
              {menu && (
                <div className="art-menu" onMouseLeave={() => setMenu(false)}>
                  <a className="art-menu-item" href={`/api/chats/${chatId}/download?path=${encodeURIComponent(path)}${stale ? '&v=' + viewing : ''}`}>Download as {ext.toUpperCase()}</a>
                  {versions.length > 1 && <>
                    <div className="art-menu-label">Version history</div>
                    {[...versions].reverse().map(v => (
                      <button key={v} className={'art-menu-item ver' + (v === viewing ? ' active' : '')} onClick={() => { setMenu(false); load(v); }}>
                        Version {v}{v === current ? ' · latest' : ''}{v === viewing && <Check style={{ width: 13 }} />}
                      </button>
                    ))}
                  </>}
                </div>
              )}
            </div>
          )}
          {headerExtra}
          {!isLive && <button className="art-btn icon" onClick={() => load(viewing)} title="Refresh"><Refresh style={{ width: 15 }} /></button>}
        </div>
      </div>
      {search && !isLive && (
        <div className="art-search">
          <Search style={{ width: 14, opacity: .6, flexShrink: 0 }} />
          <input ref={searchInputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder={t('Find in file')} spellCheck={false} />
          <span className="art-search-count">{matches.length ? `${matchIdx + 1} / ${matches.length}` : (query ? '0' : '')}</span>
          <button className="art-btn icon" disabled={!matches.length} onClick={() => nextMatch(-1)} title="Previous">↑</button>
          <button className="art-btn icon" disabled={!matches.length} onClick={() => nextMatch(1)} title="Next">↓</button>
          <button className="art-btn icon" onClick={() => { setSearch(false); setQuery(''); }} title="Close"><X style={{ width: 13 }} /></button>
        </div>
      )}
      {!isLive && writingElsewhere && (
        <button className="art-writing-bar" onClick={onJumpToLive}>✍ Writing {baseName(writingElsewhere)}…, view live</button>
      )}
      {stale && (
        <div className="art-stale-row">
          <button className="art-stale-bar" onClick={() => load()}>Viewing older version v{viewing}, jump to latest (v{current})</button>
          <button className="art-restore-btn" disabled={restoring} onClick={restore}>{restoring ? 'Restoring…' : `Restore v${viewing}`}</button>
        </div>
      )}
      <div className="art-vbody" ref={bodyRef} onScroll={onBodyScroll} onWheel={onBodyWheel} onTouchStart={onBodyTouchStart} onTouchMove={onBodyTouchMove}>
        {liveEdit && (
          baseText == null
            ? <div className="art-skel">{Array.from({ length: 14 }).map((_, i) => <span key={i} className="skeleton" style={{ width: (32 + ((i * 53) % 58)) + '%' }} />)}</div>
            : renderDiffRows(liveRows, true)
        )}
        {!liveEdit && showText && !diff && previewOn && (
          PREVIEW_MD.has(ext)
            ? <div className="art-md"><Markdown>{shownText || ''}</Markdown></div>
            : <iframe className="art-preview-frame" sandbox="allow-scripts" srcDoc={shownText || ''} title={baseName(path)} />
        )}
        {isCode && (
          <div className={'art-code2' + (isLive ? ' live' : '') + (wrap ? ' wrap' : '')} ref={codeRef}>
            {lineHtmls.map((lh, i) => {
              const lm = matchesByLine.get(i);
              const hit = activeMatch && activeMatch.line === i;
              const inner = lm ? markLine(rawLines[i] ?? '', lm, activeMatch ? activeMatch.gid : -1) : lh;
              return (
                <div key={i} className={'art-line' + (hit ? ' hit' : '') + (lm ? ' has-match' : '')}>
                  <span className="art-ln">{i + 1}</span>
                  <span className="art-lc" dangerouslySetInnerHTML={{ __html: inner || ' ' }} />
                </div>
              );
            })}
            {isLive && <div className="art-line caret"><span className="art-ln" /><span className="art-lc"><span className="live-caret" /></span></div>}
          </div>
        )}
        {!fromStream && !committed && <div className="art-empty"><div className="art-empty-spin" />This file is still being written…</div>}
        {!fromStream && committed && !data && (
          <div className="art-skel">
            {Array.from({ length: 16 }).map((_, i) => <span key={i} className="skeleton" style={{ width: (32 + ((i * 53) % 58)) + '%' }} />)}
          </div>
        )}
        {!fromStream && committed && data?.error && <div className="art-empty">Couldn't load this file.</div>}
        {!fromStream && data && data.text != null && diff && (
          prev == null ? <div className="art-empty">Loading diff…</div>
            : diffRows == null ? <div className="art-empty">File too large to diff.</div>
              : renderDiffRows(diffRows, false)
        )}
        {!isLive && data && data.binary && (
          IMAGE_EXT.has(ext)
            ? <ImageView src={data.downloadUrl} alt={baseName(path)} />
            : (
              <div className="art-binary">
                <div className="art-binary-icon"><FileChip ext={ext} size="lg" /></div>
                <div className="art-bname">{baseName(path)}</div>
                <a className="btn primary" href={data.downloadUrl}><Download style={{ width: 15, verticalAlign: '-2px' }} /> Download</a>
              </div>
            )
        )}
      </div>
      {diff && diffRows && <button className="art-jump change" onClick={jumpToChange} title="Jump to first change"><Down style={{ width: 14 }} /> Change</button>}
      {liveActive && !following && <button className="art-jump" onClick={jumpLatest}><Down style={{ width: 14 }} /> {t('Jump to latest')}</button>}
    </div>
  );
}

function buildTree(files) {
  const root = { dirs: {}, files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) { node.dirs[parts[i]] ||= { dirs: {}, files: [] }; node = node.dirs[parts[i]]; }
    node.files.push(f);
  }
  return root;
}
function FileRow({ f, chatId, depth, onOpen, sel, live }) {
  const active = sel === f.path;
  const writing = live && live.path === f.path;
  return (
    <div className={'art-row tree' + (active ? ' active' : '')} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => onOpen(f.path)}>
      <FileChip ext={f.ext} />
      <div className="art-rmeta">
        <div className="art-rname">{baseName(f.path)}</div>
        <div className="art-rext">{writing ? <span className="row-writing">writing…</span> : <>{(f.ext || 'file').toUpperCase()}{f.v ? ' · v' + f.v : ''}{f.size != null ? ' · ' + fmtSize(f.size) : ''}</>}</div>
      </div>
      {!writing && <a className="art-btn icon dl" href={`/api/chats/${chatId}/download?path=${encodeURIComponent(f.path)}`} onClick={(e) => e.stopPropagation()} title="Download"><Download style={{ width: 15 }} /></a>}
    </div>
  );
}
function TreeFolder({ name, node, depth, chatId, onOpen, sel, live, forceOpen }) {
  const [open, setOpen] = useState(true);
  const isOpen = forceOpen || open;
  return (
    <>
      <div className="art-tree-folder" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setOpen(o => !o)}>
        <ChevDown className={'tf-chev' + (isOpen ? ' open' : '')} style={{ width: 13 }} />
        <Folder style={{ width: 15 }} /><span className="tf-name">{name}</span>
      </div>
      {isOpen && <TreeChildren node={node} depth={depth + 1} chatId={chatId} onOpen={onOpen} sel={sel} live={live} forceOpen={forceOpen} />}
    </>
  );
}
function TreeChildren({ node, depth, chatId, onOpen, sel, live, forceOpen }) {
  const dirs = Object.keys(node.dirs).sort();
  const files = node.files.slice().sort((a, b) => a.path.localeCompare(b.path));
  return (
    <>
      {dirs.map(d => <TreeFolder key={d} name={d} node={node.dirs[d]} depth={depth} chatId={chatId} onOpen={onOpen} sel={sel} live={live} forceOpen={forceOpen} />)}
      {files.map(f => <FileRow key={f.path} f={f} chatId={chatId} depth={depth} onOpen={onOpen} sel={sel} live={live} />)}
    </>
  );
}

function clampW(w) { return Math.max(320, Math.min(w, Math.round(window.innerWidth * 0.85))); }

const MemoViewer = React.memo(Viewer);

export default function ArtifactsPanel({ chatId, files, live, pending = {}, focus = null, onClose }) {
  const [tabs, setTabs] = useState([]);
  const [active, setActive] = useState(null);
  const [split, setSplit] = useState(null);
  const [focusedPane, setFocusedPane] = useState('left');
  const [filter, setFilter] = useState('');
  const [width, setWidth] = useState(() => { const s = parseInt(localStorage.getItem('oq-art-w')); return s ? clampW(s) : Math.min(480, Math.round(window.innerWidth * 0.42)); });
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef(null);

  const byPath = new Map(files.map(f => [f.path, f]));
  for (const p of Object.keys(pending)) if (!byPath.has(p)) byPath.set(p, { path: p, ext: extOf(p), v: 0 });
  if (live && live.path && !byPath.has(live.path)) byPath.set(live.path, { path: live.path, ext: extOf(live.path), v: 0 });
  const treeFiles = [...byPath.values()];

  const openFile = useCallback((path) => {
    const toRight = focusedPane === 'right' && split != null;
    setTabs(ts => ts.includes(path) ? ts : [...ts, path]);
    if (toRight) setSplit(path); else setActive(path);
  }, [focusedPane, split]);

  const closeTab = useCallback((path, e) => {
    if (e) e.stopPropagation();
    setTabs(ts => ts.includes(path) ? ts.filter(p => p !== path) : ts);
    setSplit(s => s === path ? null : s);
    setActive(a => {
      if (a !== path) return a;
      const rest = tabs.filter(p => p !== path);
      return rest.length ? rest[rest.length - 1] : null;
    });
  }, [tabs]);

  const goOverview = useCallback(() => { setActive(null); setSplit(null); setFocusedPane('left'); }, []);

  useEffect(() => { setTabs([]); setActive(null); setSplit(null); }, [chatId]);
  useEffect(() => { if (focus && focus.path) { setTabs(ts => ts.includes(focus.path) ? ts : [...ts, focus.path]); setActive(focus.path); setFocusedPane('left'); } }, [focus]);
  useEffect(() => {
    const exists = (p) => p && byPath.has(p);
    setTabs(ts => ts.every(exists) ? ts : ts.filter(exists));
    setActive(a => exists(a) ? a : null);
    setSplit(s => exists(s) ? s : null);
  }, [files, live, pending]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement;
      if (el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable)) return;
      if (split) { setSplit(null); setFocusedPane('left'); }
      else if (active) goOverview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, split, goOverview]);

  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  function startResize(e) {
    e.preventDefault();
    setResizing(true);
    let raf = 0, nextW = null;
    const apply = () => { raf = 0; if (nextW != null) setWidth(nextW); };
    const move = (ev) => { const x = ev.touches ? ev.touches[0].clientX : ev.clientX; nextW = clampW(window.innerWidth - x); if (!raf) raf = requestAnimationFrame(apply); };
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      if (raf) cancelAnimationFrame(raf);
      setResizing(false);
      if (nextW != null) { setWidth(nextW); localStorage.setItem('oq-art-w', String(nextW)); }
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  }

  const onJumpToLive = useCallback(() => { if (live && live.path) openFile(live.path); }, [live, openFile]);
  const paneProps = (p) => ({
    chatId, path: p,
    liveText: live && p === live.path ? live.content : null,
    liveInfo: live && p === live.path ? live : null,
    committed: !!files.find(f => f.path === p),
    fileV: byPath.get(p)?.v || 0,
    pendingText: p in pending ? pending[p] : null,
    writingElsewhere: live && live.path && p !== live.path ? live.path : null,
    onJumpToLive
  });

  const filtered = filter.trim() ? treeFiles.filter(f => f.path.toLowerCase().includes(filter.trim().toLowerCase())) : treeFiles;

  const splitBtn = <button className="art-btn icon" onClick={() => { setSplit(active); setFocusedPane('right'); }} title="Split view"><Panel style={{ width: 15 }} /></button>;
  const closeSplitBtn = <button className="art-btn icon" onClick={() => { setSplit(null); setFocusedPane('left'); }} title="Close split"><X style={{ width: 14 }} /></button>;

  return (
    <div className={'artifacts' + (resizing ? ' resizing' : '')} style={{ width }}>
      <div className="art-resizer" onMouseDown={startResize} onTouchStart={startResize} ref={dragRef} title="Drag to resize"><span /></div>
      {tabs.length > 0 && (
        <div className="art-tabs">
          <button className={'art-tabs-list' + (active == null ? ' on' : '')} onClick={goOverview} title="All files"><Folder style={{ width: 15 }} /></button>
          <div className="art-tabs-scroll">
            {tabs.map(p => (
              <div key={p} className={'art-tab' + (p === active ? ' active' : '') + (p === split ? ' split' : '')} onClick={() => { if (focusedPane === 'right' && split != null) setSplit(p); else setActive(p); }} title={p}>
                <FileChip ext={extOf(p)} />
                <span className="art-tab-name">{baseName(p)}</span>
                <button className="art-tab-close" onClick={(e) => closeTab(p, e)} title="Close"><X style={{ width: 12 }} /></button>
              </div>
            ))}
          </div>
          <button className="art-btn icon" onClick={onClose} title="Close panel"><X style={{ width: 15 }} /></button>
        </div>
      )}
      {active != null ? (
        <div className={'art-panes' + (split ? ' split' : '')}>
          <div className={'art-pane' + (focusedPane === 'left' || !split ? ' focused' : '')}>
            <MemoViewer {...paneProps(active)} onBack={goOverview} canBack
              headerExtra={!split ? splitBtn : null}
              onFocusPane={() => setFocusedPane('left')} />
          </div>
          {split && (
            <div className={'art-pane' + (focusedPane === 'right' ? ' focused' : '')}>
              <MemoViewer {...paneProps(split)} onBack={() => { setSplit(null); setFocusedPane('left'); }} canBack={false}
                headerExtra={closeSplitBtn}
                onFocusPane={() => setFocusedPane('right')} />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="art-head">
            <div className="art-title">Artifacts{treeFiles.length > 0 && <span className="art-count">{treeFiles.length}</span>}</div>
            {tabs.length === 0 && <button className="art-btn icon" onClick={onClose} title="Close panel"><X style={{ width: 15 }} /></button>}
          </div>
          {treeFiles.length > 3 && (
            <div className="art-filter">
              <Search style={{ width: 14, opacity: .55, flexShrink: 0 }} />
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('Filter files')} spellCheck={false} />
              {filter && <button className="art-btn icon" onClick={() => setFilter('')} title="Clear"><X style={{ width: 13 }} /></button>}
            </div>
          )}
          <div className="art-list">
            {treeFiles.length === 0 && (
              <div className="art-empty big">
                <div className="art-empty-icon"><FileText style={{ width: 26 }} /></div>
                <div className="art-empty-title">No files yet</div>
                <div>When the assistant creates or edits files, they'll show up here, ready to view, diff, and download.</div>
              </div>
            )}
            {treeFiles.length > 0 && filtered.length === 0 && <div className="art-empty">No files match “{filter}”.</div>}
            {filtered.length > 0 && <TreeChildren node={buildTree(filtered)} depth={0} chatId={chatId} onOpen={openFile} sel={active} live={live} forceOpen={!!filter.trim()} />}
          </div>
          {files.length > 0 && (
            <div className="art-foot">
              <span className="art-foot-count">{files.length} file{files.length === 1 ? '' : 's'}</span>
              <a className="art-dl-all" href={`/api/chats/${chatId}/zip`}><Download style={{ width: 15 }} /> Download all</a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
