import React, { useState, useEffect, useMemo, useRef } from 'react';
import hljs from 'highlight.js';
import { api } from '../api.js';
import { copyText } from '../clipboard.js';
import { Download, Refresh, FileText, Copy, Check, ChevDown, Folder, Chevron } from './icons.jsx';

const EXT_LANG = { rs: 'rust', py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', html: 'xml', htm: 'xml', css: 'css', scss: 'scss', json: 'json', md: 'markdown', markdown: 'markdown', sh: 'bash', bash: 'bash', c: 'c', cpp: 'cpp', h: 'cpp', java: 'java', rb: 'ruby', go: 'go', php: 'php', sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', lua: 'lua', glsl: 'glsl', vert: 'glsl', frag: 'glsl', xml: 'xml', svg: 'xml', kt: 'kotlin', swift: 'swift', vue: 'xml' };
const EXT_COLOR = { py: '#4b8bf4', js: '#e6b73a', jsx: '#e6b73a', mjs: '#e6b73a', ts: '#3a8ddb', tsx: '#3a8ddb', html: '#e3683c', htm: '#e3683c', css: '#3f7ff0', scss: '#cd6799', json: '#9aa0a6', md: '#8a93a0', markdown: '#8a93a0', sh: '#5bbd6a', bash: '#5bbd6a', rs: '#d6a07a', c: '#6b78c4', cpp: '#6b78c4', h: '#6b78c4', java: '#c0824a', rb: '#c5413b', go: '#39c0d4', php: '#8a8fd0', sql: '#d99440', yml: '#cb4b3e', yaml: '#cb4b3e', toml: '#b08b54', lua: '#5b8df0', svg: '#e3683c', xml: '#e3683c', txt: '#9aa0a6', csv: '#5bbd6a', zip: '#b48ad6' };

function baseName(p) { return p.split('/').pop(); }
function extOf(p) { return (p.split('.').pop() || '').toLowerCase(); }
function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
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
    if (a[i] === b[j]) { out.push({ type: 'ctx', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

function Viewer({ chatId, path, onBack, canBack, liveText, liveInfo = null, writingElsewhere, onJumpToLive, committed = true, pendingText = null }) {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const [diff, setDiff] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [prev, setPrev] = useState(null);
  const [baseText, setBaseText] = useState(null);
  const ext = extOf(path);
  const isLive = liveText != null;
  const liveEdit = isLive && liveInfo && liveInfo.tool === 'str_replace';
  const streamText = isLive ? liveText : (!committed && pendingText != null ? pendingText : null);
  const fromStream = streamText != null;

  // for a live edit, pull the current on-disk content as the diff base
  useEffect(() => {
    if (!liveEdit) { setBaseText(null); return; }
    if (baseText != null) return;
    let on = true;
    api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}`)
      .then(r => { if (on) setBaseText(r.text ?? ''); }).catch(() => { if (on) setBaseText(''); });
    return () => { on = false; };
  }, [liveEdit, path, chatId]);

  // live applied-diff: splice the streaming new_str into the base where old_str sits
  const liveDiff = useMemo(() => {
    if (!liveEdit || baseText == null) return null;
    const oldStr = liveInfo.oldStr;
    const newStr = liveText || '';
    let result;
    if (oldStr && baseText.includes(oldStr)) {
      const idx = baseText.indexOf(oldStr);
      result = baseText.slice(0, idx) + newStr + baseText.slice(idx + oldStr.length);
    } else {
      result = baseText; // can't locate the target yet; show the file unchanged
    }
    const rows = diffLines(baseText.split('\n'), result.split('\n'));
    return { rows, result };
  }, [liveEdit, baseText, liveText, liveInfo]);

  async function load(v) {
    setData(null);
    try { setData(await api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}${v ? '&v=' + v : ''}`)); }
    catch { setData({ error: true }); }
  }
  useEffect(() => { if (isLive) return; if (committed) { setDiff(false); setPrev(null); load(); } else setData(null); }, [path, isLive, committed]);

  const viewingV = data?.viewing;
  useEffect(() => {
    if (!diff || !viewingV || viewingV <= 1) { setPrev(null); return; }
    let on = true; setPrev(null);
    api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}&v=${viewingV - 1}`)
      .then(r => { if (on) setPrev(r.text ?? ''); }).catch(() => { if (on) setPrev(''); });
    return () => { on = false; };
  }, [diff, viewingV, path, chatId]);

  const shownText = fromStream ? streamText : (data?.text != null ? data.text : null);
  const html = useMemo(() => {
    if (shownText == null) return '';
    const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const lang = EXT_LANG[(fromStream ? ext : (data?.ext || '').toLowerCase())];
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(shownText, { language: lang, ignoreIllegals: true }).value;
      if (isLive) return esc(shownText);
      return hljs.highlightAuto(shownText).value;
    } catch { return esc(shownText); }
  }, [shownText, fromStream]);
  const lines = shownText != null ? shownText.split('\n') : [];
  const diffRows = useMemo(() => {
    if (!diff || prev == null || data?.text == null) return null;
    return diffLines(prev.split('\n'), data.text.split('\n'));
  }, [diff, prev, data]);

  async function copy() { const t = data?.text != null ? data.text : shownText; if (t != null && await copyText(t)) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }

  const bodyRef = useRef(null);
  const stickRef = useRef(true);
  function onBodyScroll() {
    const el = bodyRef.current; if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }
  useEffect(() => { if ((isLive || liveEdit) && stickRef.current && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [shownText, liveDiff, isLive, liveEdit]);
  useEffect(() => { stickRef.current = true; }, [path]);

  const versions = data?.versions || [];
  const viewing = data?.viewing;
  const current = data?.v;
  const stale = viewing && current && viewing !== current;
  const showText = (fromStream || (committed && data && data.text != null));

  return (
    <div className="art-viewer">
      <div className="art-vhead">
        <div className="art-vtitle">
          {canBack && <button className="art-back" onClick={onBack} title="Back to files"><Chevron style={{ width: 16, transform: 'rotate(180deg)' }} /></button>}
          <FileChip ext={ext} />
          <span className="art-vname">{baseName(path)}</span>
          {isLive && <span className="art-ver writing">{liveEdit ? 'editing…' : (liveText && liveText.length ? 'writing…' : 'creating…')}</span>}
          {!isLive && viewing && <span className={'art-ver' + (stale ? ' stale' : '')}>v{viewing}{stale ? ` of ${current}` : ''}</span>}
        </div>
        <div className="art-vactions">
          {showText && !diff && <button className={'art-btn icon' + (wrap ? ' on' : '')} onClick={() => setWrap(w => !w)} title="Toggle word wrap">↩</button>}
          {!isLive && data?.text != null && viewing > 1 && (
            <button className={'art-btn icon' + (diff ? ' on' : '')} onClick={() => setDiff(d => !d)} title="Show changes from previous version">Diff</button>
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
          {!isLive && <button className="art-btn icon" onClick={() => load(viewing)} title="Refresh"><Refresh style={{ width: 15 }} /></button>}
        </div>
      </div>
      {!isLive && writingElsewhere && (
        <button className="art-writing-bar" onClick={onJumpToLive}>✍ Writing {baseName(writingElsewhere)}… — view live</button>
      )}
      {stale && <button className="art-stale-bar" onClick={() => load()}>Viewing older version v{viewing} — jump to latest (v{current})</button>}
      <div className="art-vbody" ref={bodyRef} onScroll={onBodyScroll}>
        {liveEdit && (
          baseText == null
            ? <div className="art-skel">{Array.from({ length: 14 }).map((_, i) => <span key={i} className="skeleton" style={{ width: (32 + ((i * 53) % 58)) + '%' }} />)}</div>
            : liveDiff && liveDiff.rows == null
              ? <div className={'art-code live wrap'}><pre><code className="hljs">{liveDiff.result}</code><span className="live-caret" /></pre></div>
              : <div className="art-diff live">
                  {(liveDiff?.rows || []).map((r, i) => (
                    <div key={i} className={'art-diff-line ' + r.type}>
                      <span className="art-diff-sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ''}</span>
                      <span className="art-diff-text">{r.text || ' '}</span>
                    </div>
                  ))}
                  <span className="live-caret diff" />
                </div>
        )}
        {!liveEdit && showText && !diff && (
          <div className={'art-code' + (isLive ? ' live' : '') + (wrap ? ' wrap' : '')}>
            <div className="art-gutter">{lines.map((_, i) => <div key={i}>{i + 1}</div>)}</div>
            <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />{isLive && <span className="live-caret" />}</pre>
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
              : <div className="art-diff">
                {diffRows.map((r, i) => (
                  <div key={i} className={'art-diff-line ' + r.type}>
                    <span className="art-diff-sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ''}</span>
                    <span className="art-diff-text">{r.text || ' '}</span>
                  </div>
                ))}
              </div>
        )}
        {!isLive && data && data.binary && (
          <div className="art-binary">
            <div className="art-binary-icon"><FileChip ext={ext} size="lg" /></div>
            <div className="art-bname">{baseName(path)}</div>
            <a className="btn primary" href={data.downloadUrl}><Download style={{ width: 15, verticalAlign: '-2px' }} /> Download</a>
          </div>
        )}
      </div>
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
function TreeFolder({ name, node, depth, chatId, onOpen, sel, live }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="art-tree-folder" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setOpen(o => !o)}>
        <ChevDown className={'tf-chev' + (open ? ' open' : '')} style={{ width: 13 }} />
        <Folder style={{ width: 15 }} /><span className="tf-name">{name}</span>
      </div>
      {open && <TreeChildren node={node} depth={depth + 1} chatId={chatId} onOpen={onOpen} sel={sel} live={live} />}
    </>
  );
}
function TreeChildren({ node, depth, chatId, onOpen, sel, live }) {
  const dirs = Object.keys(node.dirs).sort();
  const files = node.files.slice().sort((a, b) => a.path.localeCompare(b.path));
  return (
    <>
      {dirs.map(d => <TreeFolder key={d} name={d} node={node.dirs[d]} depth={depth} chatId={chatId} onOpen={onOpen} sel={sel} live={live} />)}
      {files.map(f => <FileRow key={f.path} f={f} chatId={chatId} depth={depth} onOpen={onOpen} sel={sel} live={live} />)}
    </>
  );
}

function clampW(w) { return Math.max(320, Math.min(w, Math.round(window.innerWidth * 0.8))); }

export default function ArtifactsPanel({ chatId, files, live, pending = {}, focus = null, onClose }) {
  const [sel, setSel] = useState(null);
  const [width, setWidth] = useState(() => { const s = parseInt(localStorage.getItem('oq-art-w')); return s ? clampW(s) : Math.min(480, Math.round(window.innerWidth * 0.42)); });
  const [resizing, setResizing] = useState(false);
  const autoRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => { setSel(null); autoRef.current = null; }, [chatId]);
  useEffect(() => { if (focus && focus.path) setSel(focus.path); }, [focus]);
  useEffect(() => { if (sel && !(live && sel === live.path) && !files.find(f => f.path === sel)) setSel(null); }, [files]);

  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  function startResize(e) {
    e.preventDefault();
    setResizing(true);
    const move = (ev) => { const x = ev.touches ? ev.touches[0].clientX : ev.clientX; setWidth(clampW(window.innerWidth - x)); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up); document.body.style.cursor = ''; document.body.style.userSelect = ''; setResizing(false); setWidth(w => { localStorage.setItem('oq-art-w', String(w)); return w; }); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  }

  const liveText = live && sel === live.path ? live.content : null;
  const liveInfo = live && sel === live.path ? live : null;
  const byPath = new Map(files.map(f => [f.path, f]));
  for (const p of Object.keys(pending)) if (!byPath.has(p)) byPath.set(p, { path: p, ext: extOf(p), v: 0 });
  if (live && live.path && !byPath.has(live.path)) byPath.set(live.path, { path: live.path, ext: extOf(live.path), v: 0 });
  const treeFiles = [...byPath.values()];

  return (
    <div className={'artifacts' + (resizing ? ' resizing' : '')} style={{ width }}>
      <div className="art-resizer" onMouseDown={startResize} onTouchStart={startResize} ref={dragRef} title="Drag to resize"><span /></div>
      {sel ? (
        <Viewer chatId={chatId} path={sel} liveText={liveText} liveInfo={liveInfo} onBack={() => setSel(null)} canBack={treeFiles.length > 1}
          committed={!!files.find(f => f.path === sel)}
          pendingText={sel in pending ? pending[sel] : null}
          writingElsewhere={live && live.path && sel !== live.path ? live.path : null}
          onJumpToLive={() => live && setSel(live.path)} />
      ) : (
        <>
          <div className="art-head">
            <div className="art-title">Artifacts{treeFiles.length > 0 && <span className="art-count">{treeFiles.length}</span>}</div>
            <button className="art-btn icon" onClick={onClose} title="Close panel">✕</button>
          </div>
          <div className="art-list">
            {treeFiles.length === 0 && (
              <div className="art-empty big">
                <div className="art-empty-icon"><FileText style={{ width: 26 }} /></div>
                <div className="art-empty-title">No files yet</div>
                <div>When the assistant creates or edits files, they'll show up here — ready to view, diff, and download.</div>
              </div>
            )}
            {treeFiles.length > 0 && <TreeChildren node={buildTree(treeFiles)} depth={0} chatId={chatId} onOpen={setSel} sel={sel} live={live} />}
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
