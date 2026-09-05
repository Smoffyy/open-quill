import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FileText, Download, Search, X, Folder, Menu, Chevron, ChevDown, Expand, Collapse } from './icons.jsx';
import { t } from '../i18n.jsx';
import Viewer from './artifacts/Viewer.jsx';
import FileTree, { FileCard } from './artifacts/FileTree.jsx';
import { extOf, buildTree, allDirPaths, ancestorDirs } from '../lib/artifacts.js';
import { dirOf } from '../lib/files.js';

function clampW(w) { return Math.max(320, Math.min(w, Math.round(window.innerWidth * 0.85))); }

const MemoViewer = React.memo(Viewer);

export default function ArtifactsPanel({ chatId, files, live, pending = {}, focus = null, onClose }) {
  const [active, setActive] = useState(null);
  const [split, setSplit] = useState(null);
  const [focusedPane, setFocusedPane] = useState('left');
  const [filter, setFilter] = useState('');
  const [tree, setTree] = useState(() => localStorage.getItem('oq-art-flat') !== '1');
  const [closed, setClosed] = useState(() => new Set());
  const [width, setWidth] = useState(null);
  const [resizing, setResizing] = useState(false);
  const [full, setFull] = useState(false);
  const dragRef = useRef(null);

  const byPath = new Map(files.map(f => [f.path, f]));
  for (const p of Object.keys(pending)) if (!byPath.has(p)) byPath.set(p, { path: p, ext: extOf(p), v: 0 });
  if (live && live.path && !byPath.has(live.path)) byPath.set(live.path, { path: live.path, ext: extOf(live.path), v: 0 });
  const treeFiles = [...byPath.values()];

  const openFile = useCallback((path) => {
    const toRight = focusedPane === 'right' && split != null;
    if (toRight) setSplit(path); else setActive(path);
  }, [focusedPane, split]);

  const goOverview = useCallback(() => { setActive(null); setSplit(null); setFocusedPane('left'); setFull(false); }, []);

  useEffect(() => { setActive(null); setSplit(null); setClosed(new Set()); }, [chatId]);
  // switching between the list and a file returns to that view's own width
  useEffect(() => { setWidth(null); }, [active == null]);
  useEffect(() => { if (focus && focus.path) { setActive(focus.path); setFocusedPane('left'); } }, [focus]);
  useEffect(() => {
    const exists = (p) => p && byPath.has(p);
    setActive(a => exists(a) ? a : null);
    setSplit(s => exists(s) ? s : null);
  }, [files, live, pending]);

  // A file being written must be visible, so its folders reopen themselves. Only
  // the ancestors are touched: a folder the user closed elsewhere stays closed.
  const livePath = live && live.path;
  useEffect(() => {
    if (!livePath) return;
    setClosed(c => {
      const anc = ancestorDirs(livePath).filter(d => c.has(d));
      if (!anc.length) return c;
      const next = new Set(c);
      for (const d of anc) next.delete(d);
      return next;
    });
  }, [livePath]);

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
      if (nextW != null) setWidth(nextW);
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  }

  const paneProps = (p) => ({
    chatId, path: p,
    liveText: live && p === live.path ? live.content : null,
    liveInfo: live && p === live.path ? live : null,
    committed: !!files.find(f => f.path === p),
    fileV: byPath.get(p)?.v || 0,
    pendingText: p in pending ? pending[p] : null,
  });

  const q = filter.trim().toLowerCase();
  const filtered = q ? treeFiles.filter(f => f.path.toLowerCase().includes(q)) : treeFiles;
  // Searching is a flat question — "where is X" — so a matching file is shown with
  // its full path rather than buried under folders that may hold nothing else.
  const asTree = tree && !q;
  // Rebuilt only when the set of paths actually changes: `filtered` is a fresh
  // array on every render, and a token arriving mid-write must not re-key the
  // whole tree and drop every open/closed folder with it.
  const pathKey = filtered.map(f => f.path).join('\n');
  const root = useMemo(() => buildTree(filtered), [pathKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasFolders = root.dirs.size > 0;
  const allClosed = hasFolders && allDirPaths(root).every(p => closed.has(p));

  const toggleDir = useCallback((path) => {
    setClosed(c => { const n = new Set(c); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  }, []);
  const toggleAll = useCallback(() => {
    setClosed(c => (allDirPaths(root).every(p => c.has(p)) ? new Set() : new Set(allDirPaths(root))));
  }, [root]);

  const fullBtn = (
    <button className="art-btn icon" onClick={() => setFull(f => !f)} title={full ? t('Exit full screen') : t('Full screen')}
      aria-label={full ? t('Exit full screen') : t('Full screen')} aria-pressed={full}>
      {full ? <Collapse style={{ width: 15 }} /> : <Expand style={{ width: 15 }} />}
    </button>
  );
  const closeSplitBtn = <button className="art-btn icon" onClick={() => { setSplit(null); setFocusedPane('left'); }} title={t("Close split")}><X style={{ width: 14 }} /></button>;

  return (
    <div className={'artifacts' + (resizing ? ' resizing' : '') + (active != null ? ' viewing' : '') + (full ? ' full' : '')} style={width && !full ? { width } : undefined}>
      <div className="art-resizer" onMouseDown={startResize} onTouchStart={startResize} ref={dragRef} title={t("Drag to resize")}><span /></div>
      {active != null ? (
        <div className={'art-panes' + (split ? ' split' : '')}>
          <div className={'art-pane' + (focusedPane === 'left' || !split ? ' focused' : '')}>
            <MemoViewer {...paneProps(active)} onBack={goOverview} canBack
              headerExtra={<>{fullBtn}<button className="art-btn icon" onClick={onClose} title={t("Close panel")}><X style={{ width: 15 }} /></button></>}
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
            <div className="art-head-actions">
              {files.length > 0 && <a className="art-dl-all" href={`/api/chats/${chatId}/zip`}><Download style={{ width: 15 }} /> {t("Download all")}</a>}
              <button className="art-btn icon" onClick={onClose} title={t("Close panel")}><X style={{ width: 15 }} /></button>
            </div>
          </div>
          {treeFiles.length > 0 && (
            <div className="art-toolbar">
              <div className="art-filter">
                <Search style={{ width: 14, opacity: .55, flexShrink: 0 }} />
                <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('Filter files')} spellCheck={false} />
                {filter && <button className="art-btn icon" onClick={() => setFilter('')} title={t("Clear")}><X style={{ width: 13 }} /></button>}
              </div>
              {asTree && hasFolders && (
                <button className="art-btn icon" onClick={toggleAll} title={allClosed ? t("Expand all folders") : t("Collapse all folders")}>
                  {allClosed ? <Chevron style={{ width: 15 }} /> : <ChevDown style={{ width: 15 }} />}
                </button>
              )}
              {/* The icon shows what pressing it switches to, so the button never
                  needs an active state shouting at the user from the default view. */}
              <button className="art-btn icon"
                onClick={() => { const n = !tree; setTree(n); localStorage.setItem('oq-art-flat', n ? '0' : '1'); }}
                title={tree ? t("Show as a flat list") : t("Show folder structure")}>
                {tree ? <Menu style={{ width: 15 }} /> : <Folder style={{ width: 15 }} />}
              </button>
            </div>
          )}
          {filtered.length === 0 && (
            <div className="art-list">
              {treeFiles.length === 0 ? (
                <div className="art-empty big">
                  <div className="art-empty-icon"><FileText style={{ width: 26 }} /></div>
                  <div className="art-empty-title">{t("No files yet")}</div>
                  <div>{t("When the assistant creates or edits files, they'll show up here, ready to view, diff, and download.")}</div>
                </div>
              ) : <div className="art-empty">{t('No files match “{q}”.', { q: filter })}</div>}
            </div>
          )}
          {filtered.length > 0 && (
            <div className="art-cards">
              {asTree ? (
                <FileTree tree={root} chatId={chatId} closed={closed} onToggle={toggleDir}
                  onOpen={openFile} sel={active} live={live} pending={pending} />
              ) : (
                filtered.map(f => (
                  <FileCard key={f.path} f={f} chatId={chatId}
                    sub={[extOf(f.path).toUpperCase() || 'FILE', dirOf(f.path)].filter(Boolean).join(' · ')}
                    writing={!!live && live.path === f.path}
                    pending={f.path in pending}
                    active={active === f.path} onOpen={openFile} />
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
