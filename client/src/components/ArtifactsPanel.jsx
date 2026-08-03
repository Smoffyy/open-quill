import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Download, Folder, Search, X, Panel } from './icons.jsx';
import { t } from '../i18n.jsx';
import FileChip from './artifacts/FileChip.jsx';
import TreeChildren from './artifacts/FileTree.jsx';
import Viewer from './artifacts/Viewer.jsx';
import { baseName, extOf, buildTree } from '../lib/artifacts.js';

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

  const splitBtn = <button className="art-btn icon" onClick={() => { setSplit(active); setFocusedPane('right'); }} title={t("Split view")}><Panel style={{ width: 15 }} /></button>;
  const closeSplitBtn = <button className="art-btn icon" onClick={() => { setSplit(null); setFocusedPane('left'); }} title={t("Close split")}><X style={{ width: 14 }} /></button>;

  return (
    <div className={'artifacts' + (resizing ? ' resizing' : '')} style={{ width }}>
      <div className="art-resizer" onMouseDown={startResize} onTouchStart={startResize} ref={dragRef} title={t("Drag to resize")}><span /></div>
      {tabs.length > 0 && (
        <div className="art-tabs">
          <button className={'art-tabs-list' + (active == null ? ' on' : '')} onClick={goOverview} title={t("All files")}><Folder style={{ width: 15 }} /></button>
          <div className="art-tabs-scroll">
            {tabs.map(p => (
              <div key={p} className={'art-tab' + (p === active ? ' active' : '') + (p === split ? ' split' : '')} onClick={() => { if (focusedPane === 'right' && split != null) setSplit(p); else setActive(p); }} title={p}>
                <FileChip ext={extOf(p)} />
                <span className="art-tab-name">{baseName(p)}</span>
                <button className="art-tab-close" onClick={(e) => closeTab(p, e)} title={t("Close")}><X style={{ width: 12 }} /></button>
              </div>
            ))}
          </div>
          <button className="art-btn icon" onClick={onClose} title={t("Close panel")}><X style={{ width: 15 }} /></button>
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
            {tabs.length === 0 && <button className="art-btn icon" onClick={onClose} title={t("Close panel")}><X style={{ width: 15 }} /></button>}
          </div>
          {treeFiles.length > 3 && (
            <div className="art-filter">
              <Search style={{ width: 14, opacity: .55, flexShrink: 0 }} />
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('Filter files')} spellCheck={false} />
              {filter && <button className="art-btn icon" onClick={() => setFilter('')} title={t("Clear")}><X style={{ width: 13 }} /></button>}
            </div>
          )}
          <div className="art-list">
            {treeFiles.length === 0 && (
              <div className="art-empty big">
                <div className="art-empty-icon"><FileText style={{ width: 26 }} /></div>
                <div className="art-empty-title">{t("No files yet")}</div>
                <div>{t("When the assistant creates or edits files, they'll show up here, ready to view, diff, and download.")}</div>
              </div>
            )}
            {treeFiles.length > 0 && filtered.length === 0 && <div className="art-empty">No files match “{filter}”.</div>}
            {filtered.length > 0 && <TreeChildren node={buildTree(filtered)} depth={0} chatId={chatId} onOpen={openFile} sel={active} live={live} forceOpen={!!filter.trim()} />}
          </div>
          {files.length > 0 && (
            <div className="art-foot">
              <span className="art-foot-count">{files.length} file{files.length === 1 ? '' : 's'}</span>
              <a className="art-dl-all" href={`/api/chats/${chatId}/zip`}><Download style={{ width: 15 }} /> {t("Download all")}</a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
