import React, { useState, useEffect, useMemo, useRef } from 'react';
import hljs from 'highlight.js';
import { api } from '../api.js';
import { Download, Refresh, FileText, Copy, Check, ChevDown, Folder } from './icons.jsx';

const EXT_LANG = { rs: 'rust', py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', html: 'xml', htm: 'xml', css: 'css', scss: 'scss', json: 'json', md: 'markdown', markdown: 'markdown', sh: 'bash', bash: 'bash', c: 'c', cpp: 'cpp', h: 'cpp', java: 'java', rb: 'ruby', go: 'go', php: 'php', sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', lua: 'lua', glsl: 'glsl', vert: 'glsl', frag: 'glsl', xml: 'xml', svg: 'xml', kt: 'kotlin', swift: 'swift', vue: 'xml' };

function baseName(p) { return p.split('/').pop(); }

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

function Viewer({ chatId, path, onBack, liveText, writingElsewhere, onJumpToLive }) {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const [diff, setDiff] = useState(false);
  const [prev, setPrev] = useState(null);
  const ext = (path.split('.').pop() || '').toUpperCase();
  const isLive = liveText != null;

  async function load(v) {
    setData(null);
    try { setData(await api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}${v ? '&v=' + v : ''}`)); }
    catch { setData({ error: true }); }
  }
  useEffect(() => { if (!isLive) { setDiff(false); setPrev(null); load(); } }, [path, isLive]);

  const viewingV = data?.viewing;
  useEffect(() => {
    if (!diff || !viewingV || viewingV <= 1) { setPrev(null); return; }
    let on = true; setPrev(null);
    api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}&v=${viewingV - 1}`)
      .then(r => { if (on) setPrev(r.text ?? ''); }).catch(() => { if (on) setPrev(''); });
    return () => { on = false; };
  }, [diff, viewingV, path, chatId]);

  const shownText = isLive ? liveText : (data?.text != null ? data.text : null);
  const html = useMemo(() => {
    if (shownText == null) return '';
    const lang = EXT_LANG[(isLive ? ext.toLowerCase() : (data?.ext || '').toLowerCase())];
    try { return lang && hljs.getLanguage(lang) ? hljs.highlight(shownText, { language: lang, ignoreIllegals: true }).value : hljs.highlightAuto(shownText).value; }
    catch { return shownText.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  }, [shownText, isLive]);
  const lines = shownText != null ? shownText.split('\n') : [];
  const diffRows = useMemo(() => {
    if (!diff || prev == null || data?.text == null) return null;
    return diffLines(prev.split('\n'), data.text.split('\n'));
  }, [diff, prev, data]);

  function copy() { if (data?.text != null) { navigator.clipboard.writeText(data.text); setCopied(true); setTimeout(() => setCopied(false), 1400); } }

  const bodyRef = useRef(null);
  useEffect(() => { if (isLive && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [shownText, isLive]);

  const versions = data?.versions || [];
  const viewing = data?.viewing;
  const current = data?.v;
  const stale = viewing && current && viewing !== current;

  return (
    <div className="art-viewer">
      <div className="art-vhead">
        <div className="art-vtitle">
          {baseName(path)} <span className="art-dot">·</span> {ext}
          {isLive && <span className="art-ver writing">{liveText && liveText.length ? 'writing…' : 'creating…'}</span>}
          {!isLive && viewing && <span className={'art-ver' + (stale ? ' stale' : '')}>v{viewing}{stale ? ` of ${current}` : ''}</span>}
        </div>
        <div className="art-vactions">
          {!isLive && data?.text != null && (
            <div className="art-copy-wrap">
              <button className="art-btn copy" onClick={copy}>{copied ? <Check style={{ width: 14 }} /> : <Copy style={{ width: 14 }} />} {copied ? 'Copied' : 'Copy'}</button>
              <button className="art-btn caret" onClick={() => setMenu(m => !m)}><ChevDown style={{ width: 13 }} /></button>
              {menu && (
                <div className="art-menu" onMouseLeave={() => setMenu(false)}>
                  <a className="art-menu-item" href={`/api/chats/${chatId}/download?path=${encodeURIComponent(path)}${stale ? '&v=' + viewing : ''}`}>Download as {ext}</a>
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
          {!isLive && data?.text != null && viewing > 1 && (
            <button className={'art-btn icon' + (diff ? ' on' : '')} onClick={() => setDiff(d => !d)} title="Show changes from previous version">Diff</button>
          )}
          {!isLive && <button className="art-btn icon" onClick={() => load(viewing)} title="Refresh"><Refresh style={{ width: 15 }} /></button>}
          <button className="art-btn icon" onClick={onBack} title="Close">✕</button>
        </div>
      </div>
      {!isLive && writingElsewhere && (
        <button className="art-writing-bar" onClick={onJumpToLive}>✍ Writing {baseName(writingElsewhere)}… — view live</button>
      )}
      {stale && <button className="art-stale-bar" onClick={() => load()}>Viewing older version v{viewing} — jump to latest (v{current})</button>}
      <div className="art-vbody" ref={bodyRef}>
        {isLive && (
          <div className="art-code live">
            <div className="art-gutter">{lines.map((_, i) => <div key={i}>{i + 1}</div>)}</div>
            <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /><span className="live-caret" /></pre>
          </div>
        )}
        {!isLive && !data && (
          <div className="art-skel">
            {Array.from({ length: 14 }).map((_, i) => <span key={i} className="skeleton" style={{ width: (35 + ((i * 53) % 55)) + '%' }} />)}
          </div>
        )}
        {!isLive && data?.error && <div className="art-empty">Couldn't load file.</div>}
        {!isLive && data && data.text != null && !diff && (
          <div className="art-code">
            <div className="art-gutter">{lines.map((_, i) => <div key={i}>{i + 1}</div>)}</div>
            <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
          </div>
        )}
        {!isLive && data && data.text != null && diff && (
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
            <FileText style={{ width: 40 }} />
            <div className="art-bname">{baseName(path)}</div>
            <a className="btn primary" href={data.downloadUrl}>Download</a>
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
    <div className={'art-row tree' + (active ? ' active' : '')} style={{ paddingLeft: 10 + depth * 15 }} onClick={() => onOpen(f.path)}>
      <div className="art-ricon"><FileText style={{ width: 18 }} /></div>
      <div className="art-rmeta">
        <div className="art-rname">{baseName(f.path)}</div>
        <div className="art-rext">{writing ? <span className="row-writing">writing…</span> : <>{(f.ext || 'file').toUpperCase()}{f.v ? ' · v' + f.v : ''}</>}</div>
      </div>
      {!writing && <a className="art-btn icon dl" href={`/api/chats/${chatId}/download?path=${encodeURIComponent(f.path)}`} onClick={(e) => e.stopPropagation()} title="Download"><Download style={{ width: 15 }} /></a>}
    </div>
  );
}
function TreeFolder({ name, node, depth, chatId, onOpen, sel, live }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="art-tree-folder" style={{ paddingLeft: 10 + depth * 15 }} onClick={() => setOpen(o => !o)}>
        <ChevDown className={'tf-chev' + (open ? ' open' : '')} style={{ width: 13 }} />
        <Folder style={{ width: 16 }} /><span className="tf-name">{name}</span>
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

export default function ArtifactsPanel({ chatId, files, live, onClose }) {
  const [sel, setSel] = useState(null);
  const [width, setWidth] = useState(() => { const s = parseInt(localStorage.getItem('oq-art-w')); return s ? clampW(s) : Math.min(460, Math.round(window.innerWidth * 0.42)); });
  const autoRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => { setSel(null); autoRef.current = null; }, [chatId]);
  useEffect(() => { if (sel && !(live && sel === live.path) && !files.find(f => f.path === sel)) setSel(null); }, [files]);
  // we don't yank focus to a file that's being written; it shows "writing…" in the tree if they want it

  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  function startResize(e) {
    e.preventDefault();
    const move = (ev) => { const x = ev.touches ? ev.touches[0].clientX : ev.clientX; setWidth(clampW(window.innerWidth - x)); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up); document.body.style.cursor = ''; document.body.style.userSelect = ''; setWidth(w => { localStorage.setItem('oq-art-w', String(w)); return w; }); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  }

  const liveText = live && sel === live.path ? live.content : null;
  const treeFiles = live && live.path && !files.find(f => f.path === live.path)
    ? [...files, { path: live.path, ext: (live.path.split('.').pop() || ''), v: 0 }]
    : files;

  return (
    <div className="artifacts" style={{ width }}>
      <div className="art-resizer" onMouseDown={startResize} onTouchStart={startResize} ref={dragRef} title="Drag to resize" />
      {sel ? (
        <Viewer chatId={chatId} path={sel} liveText={liveText} onBack={() => setSel(null)}
          writingElsewhere={live && live.path && sel !== live.path ? live.path : null}
          onJumpToLive={() => live && setSel(live.path)} />
      ) : (
        <>
          <div className="art-head">
            <div className="art-title">Artifacts{treeFiles.length > 0 && <span className="art-count">{treeFiles.length}</span>}</div>
            <div className="art-head-actions">
              {files.length > 0 && <a className="art-dl-all" href={`/api/chats/${chatId}/zip`}><Download style={{ width: 15 }} /> Download all</a>}
              <button className="art-btn icon" onClick={onClose} title="Close panel">✕</button>
            </div>
          </div>
          <div className="art-list">
            {treeFiles.length === 0 && <div className="art-empty">No files yet. When the assistant creates files, they'll appear here.</div>}
            {treeFiles.length > 0 && <TreeChildren node={buildTree(treeFiles)} depth={0} chatId={chatId} onOpen={setSel} sel={sel} live={live} />}
          </div>
        </>
      )}
    </div>
  );
}
