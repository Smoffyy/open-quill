import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Viewer from '../artifacts/Viewer.jsx';
import CodeMenu, { MenuItem, MenuSep } from './CodeMenu.jsx';
import Tip from '../ui/Tip.jsx';
import { Menu, Search, FilePlus, Upload, Download, Expand, Collapse, X, Dots, ChevDown, Folder, FileText, CodeTag, Pencil, Trash, Copy } from '../ui/icons.jsx';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { copyText } from '../../lib/clipboard.js';
import { askConfirm } from '../../lib/confirm.js';
import { buildTree, extOf, baseName, ancestorDirs } from '../../lib/artifacts.js';
import { t } from '../../i18n.jsx';

const TREE_KEY = 'oq-code-tree';
const CODE_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'php', 'swift', 'sh', 'bash', 'html', 'htm', 'css', 'scss', 'json', 'yml', 'yaml', 'toml', 'sql', 'lua', 'vue', 'xml', 'svg']);
const MemoViewer = React.memo(Viewer);

function readTreePref() {
  try { return localStorage.getItem(TREE_KEY) !== '0'; } catch { return true; }
}

function RenameInput({ initial, onDone }) {
  const [v, setV] = useState(initial);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  return (
    <input ref={ref} className="cx-frow-input" value={v} spellCheck={false} aria-label={t('New name')}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onDone(v); }
        else if (e.key === 'Escape') { e.preventDefault(); onDone(null); }
      }} />
  );
}

function FileRow({ f, depth, selected, writing, saving, renaming, onOpen, onAction }) {
  const [menu, setMenu] = useState(false);
  const rowRef = useRef(null);
  const btnRef = useRef(null);
  const anchorRef = useRef(null);
  const name = baseName(f.path);
  const openMenu = (fromRow) => { anchorRef.current = fromRow ? rowRef.current : btnRef.current; setMenu(true); };
  return (
    <div ref={rowRef} className={'cx-frow' + (selected ? ' on' : '') + (writing ? ' writing' : '')} style={{ '--depth': depth }}
      role="treeitem" aria-selected={selected} tabIndex={0} data-tip={f.path}
      onClick={() => onOpen(f.path)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(f.path); else if (e.key === 'F2') onAction('rename', f.path); else if (e.key === 'Delete') onAction('delete', f.path); }}
      onContextMenu={(e) => { e.preventDefault(); openMenu(true); }}>
      <span className="cx-frow-ic">{CODE_EXT.has(extOf(f.path)) ? <CodeTag /> : <FileText />}</span>
      {renaming ? <RenameInput initial={name} onDone={(v) => onAction('renamed', f.path, v)} /> : <span className="cx-frow-name">{name}</span>}
      {(writing || saving) && <span className="cx-frow-live" aria-label={writing ? t('Writing…') : t('Saving…')} />}
      {!renaming && (
        <button type="button" ref={btnRef} className="cx-frow-more" aria-label={t('More options for {name}', { name })}
          aria-haspopup="menu" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); if (menu) setMenu(false); else openMenu(false); }}><Dots /></button>
      )}
      <CodeMenu open={menu} setOpen={setMenu} anchorRef={anchorRef} align="right" label={name}>
        <MenuItem icon={<FileText />} onClick={() => { setMenu(false); onOpen(f.path); }}>{t('Open')}</MenuItem>
        <MenuItem icon={<Pencil />} kbd="F2" onClick={() => { setMenu(false); onAction('rename', f.path); }}>{t('Rename')}</MenuItem>
        <MenuItem icon={<Download />} onClick={() => { setMenu(false); onAction('download', f.path); }}>{t('Download')}</MenuItem>
        <MenuItem icon={<Copy />} onClick={() => { setMenu(false); onAction('copy', f.path); }}>{t('Copy path')}</MenuItem>
        <MenuSep />
        <MenuItem icon={<Trash />} danger kbd="Del" onClick={() => { setMenu(false); onAction('delete', f.path); }}>{t('Delete')}</MenuItem>
      </CodeMenu>
    </div>
  );
}

function FolderRow({ node, depth, open, onToggle, onAction }) {
  const [menu, setMenu] = useState(false);
  const btnRef = useRef(null);
  return (
    <div className="cx-frow folder" style={{ '--depth': depth }} role="treeitem" aria-expanded={open} tabIndex={0} data-tip={node.path}
      onClick={() => onToggle(node.path)}
      onKeyDown={(e) => { if (e.key === 'Enter') onToggle(node.path); }}
      onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}>
      <span className="cx-frow-ic"><ChevDown className={'cx-fchev' + (open ? '' : ' shut')} /></span>
      <span className="cx-frow-name">{node.name}</span>
      <button type="button" ref={btnRef} className="cx-frow-more" aria-label={t('More options for {name}', { name: node.name })}
        aria-haspopup="menu" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu(m => !m); }}><Dots /></button>
      <CodeMenu open={menu} setOpen={setMenu} anchorRef={btnRef} align="right" label={node.name}>
        <MenuItem icon={<FilePlus />} onClick={() => { setMenu(false); onAction('new', node.path + '/'); }}>{t('New file here')}</MenuItem>
        <MenuSep />
        <MenuItem icon={<Trash />} danger onClick={() => { setMenu(false); onAction('delete', node.path, true); }}>{t('Delete folder')}</MenuItem>
      </CodeMenu>
    </div>
  );
}

function Tree({ node, depth, closed, onToggle, ...rest }) {
  return (
    <>
      {[...node.dirs.values()].map(d => {
        const open = !closed.has(d.path);
        return (
          <React.Fragment key={d.path}>
            <FolderRow node={d} depth={depth} open={open} onToggle={onToggle} onAction={rest.onAction} />
            {open && <Tree node={d} depth={depth + 1} closed={closed} onToggle={onToggle} {...rest} />}
          </React.Fragment>
        );
      })}
      {node.files.map(f => (
        <FileRow key={f.path} f={f} depth={depth} selected={rest.active === f.path}
          writing={!!rest.live && rest.live.path === f.path} saving={!!rest.pending && f.path in rest.pending}
          renaming={rest.renaming === f.path} onOpen={rest.onOpen} onAction={rest.onAction} />
      ))}
    </>
  );
}

export default function CodeFiles({ chatId, files, live, pending = {}, busy, focus, onFilesChanged, onClose, wide, onToggleWide }) {
  const [active, setActive] = useState(null);
  const [showTree, setShowTree] = useState(readTreePref);
  const [filter, setFilter] = useState('');
  const [searching, setSearching] = useState(false);
  const [closed, setClosed] = useState(() => new Set());
  const [renaming, setRenaming] = useState(null);
  const [creating, setCreating] = useState(null);
  const uploadRef = useRef(null);
  const base = '/api/chats/' + chatId;

  const byPath = useMemo(() => {
    const m = new Map(files.map(f => [f.path, f]));
    for (const p of Object.keys(pending)) if (!m.has(p)) m.set(p, { path: p, ext: extOf(p), v: 0 });
    if (live && live.path && !m.has(live.path)) m.set(live.path, { path: live.path, ext: extOf(live.path), v: 0 });
    return m;
  }, [files, pending, live]);
  const all = useMemo(() => [...byPath.values()], [byPath]);

  useEffect(() => { setActive(null); setClosed(new Set()); setRenaming(null); setCreating(null); setFilter(''); }, [chatId]);
  useEffect(() => { if (focus && focus.path) setActive(focus.path); }, [focus]);
  useEffect(() => { setActive(a => (a && byPath.has(a) ? a : null)); }, [byPath]);
  const livePath = live && live.path;
  useEffect(() => {
    if (!livePath) return;
    setActive(a => a || livePath);
    setClosed(c => {
      const anc = ancestorDirs(livePath).filter(d => c.has(d));
      if (!anc.length) return c;
      const next = new Set(c);
      for (const d of anc) next.delete(d);
      return next;
    });
  }, [livePath]);

  const q = filter.trim().toLowerCase();
  const shown = q ? all.filter(f => f.path.toLowerCase().includes(q)) : all;
  const pathKey = shown.map(f => f.path).join('\n');
  const root = useMemo(() => buildTree(shown, { compact: false }), [pathKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTree = () => setShowTree(v => { try { localStorage.setItem(TREE_KEY, v ? '0' : '1'); } catch {} return !v; });
  const toggleDir = useCallback((p) => setClosed(c => { const n = new Set(c); if (n.has(p)) n.delete(p); else n.add(p); return n; }), []);
  const apply = (r) => { if (r && Array.isArray(r.files)) onFilesChanged(r.files); };
  const fail = (e) => toast(e?.message || t('Could not change the file.'), { icon: 'info', kind: 'warn' });

  async function onAction(kind, path, extra) {
    if (kind === 'rename') { if (busy) { toast(t('Wait for the reply to finish before changing files.')); return; } setRenaming(path); return; }
    if (kind === 'renamed') {
      setRenaming(null);
      const name = String(extra || '').trim();
      if (!name || name === baseName(path)) return;
      const to = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) + name : name;
      try { const r = await api.post(base + '/files/rename', { path, to }); apply(r); if (active === path) setActive(r.path); } catch (e) { fail(e); }
      return;
    }
    if (kind === 'download') { window.location.href = base + '/download?path=' + encodeURIComponent(path); return; }
    if (kind === 'copy') { if (await copyText(path)) toast(t('Path copied'), { icon: 'copy' }); return; }
    if (kind === 'new') { setCreating(path || ''); setShowTree(true); return; }
    if (kind === 'delete') {
      if (busy) { toast(t('Wait for the reply to finish before changing files.')); return; }
      const ok = await askConfirm({
        title: extra ? t('Delete folder {name}?', { name: path }) : t('Delete {name}?', { name: baseName(path) }),
        message: extra ? t('Every file inside it is deleted too. This cannot be undone.') : t('This cannot be undone.'),
        confirm: t('Delete'), danger: true
      });
      if (!ok) return;
      try { apply(await api.del(base + '/files?path=' + encodeURIComponent(path))); } catch (e) { fail(e); }
    }
  }

  async function createFile(raw) {
    setCreating(null);
    const p = String(raw || '').trim();
    if (!p) return;
    try { const r = await api.post(base + '/files/new', { path: p }); apply(r); setActive(r.path); } catch (e) { fail(e); }
  }

  async function upload(e) {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    if (!list.length) return;
    if (busy) { toast(t('Wait for the reply to finish before changing files.')); return; }
    for (const f of list) {
      try { apply(await api.uploadTo(base + '/files', f)); } catch (err) { fail(err); }
    }
  }

  const onSaved = useCallback((d) => { if (Array.isArray(d?.files)) onFilesChanged(d.files); }, [onFilesChanged]);
  const crumbs = active ? active.split('/') : [];
  const empty = all.length === 0;
  const treeVisible = showTree || !active;

  return (
    <section className={'cx-panel' + (wide ? ' wide' : '')} aria-label={t('Files')}>
      <div className="cx-panel-head">
        <div className="cx-ph-left">
          <Tip label={showTree ? t('Hide files') : t('Show files')}>
            <button type="button" className={'cx-ibtn' + (showTree && active ? ' on' : '')} onClick={toggleTree}
              aria-label={showTree ? t('Hide files') : t('Show files')} aria-pressed={showTree}><Menu /></button>
          </Tip>
          {active ? (
            <span className="cx-crumbs" data-tip={active}>
              {crumbs.slice(0, -1).map((c, i) => <span key={i} className="cx-crumb dim">{c}<span className="cx-crumb-sep">/</span></span>)}
              <span className="cx-crumb">{crumbs[crumbs.length - 1]}</span>
            </span>
          ) : (
            <span className="cx-crumbs"><span className="cx-crumb">{t('Files')}</span>{all.length > 0 && <span className="cx-count">{all.length}</span>}</span>
          )}
        </div>
        <div className="cx-ph-right">
          <Tip label={t('Go to file')}>
            <button type="button" className={'cx-ibtn' + (searching ? ' on' : '')} aria-label={t('Go to file')} aria-pressed={searching}
              onClick={() => { setSearching(s => !s); setFilter(''); setShowTree(true); }}><Search /></button>
          </Tip>
          <Tip label={t('New file')}>
            <button type="button" className="cx-ibtn" aria-label={t('New file')} disabled={busy} onClick={() => onAction('new', '')}><FilePlus /></button>
          </Tip>
          <Tip label={t('Upload files')}>
            <button type="button" className="cx-ibtn" aria-label={t('Upload files')} disabled={busy} onClick={() => uploadRef.current?.click()}><Upload /></button>
          </Tip>
          <Tip label={t('Download all')}>
            <a className={'cx-ibtn' + (empty ? ' off' : '')} href={empty ? undefined : base + '/zip'} aria-label={t('Download all')} aria-disabled={empty}><Download /></a>
          </Tip>
          <Tip label={wide ? t('Collapse') : t('Expand')}>
            <button type="button" className="cx-ibtn" aria-label={wide ? t('Collapse') : t('Expand')} onClick={onToggleWide}>{wide ? <Collapse /> : <Expand />}</button>
          </Tip>
          <Tip label={t('Close')}>
            <button type="button" className="cx-ibtn" aria-label={t('Close')} onClick={onClose}><X /></button>
          </Tip>
        </div>
      </div>
      <div className={'cx-panel-body' + (active ? ' viewing' : '') + (treeVisible ? ' with-tree' : '')}>
        {treeVisible && (
          <div className="cx-tree" role="tree" aria-label={t('Workspace files')}>
            {searching && (
              <div className="cx-tree-search">
                <Search />
                <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('Go to file')} spellCheck={false}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setSearching(false); setFilter(''); } else if (e.key === 'Enter' && shown[0]) setActive(shown[0].path); }} />
              </div>
            )}
            {creating != null && (
              <div className="cx-frow creating" style={{ '--depth': 0 }}>
                <span className="cx-frow-ic"><FilePlus /></span>
                <RenameInput initial={creating} onDone={(v) => (v == null ? setCreating(null) : createFile(v))} />
              </div>
            )}
            {empty && creating == null ? (
              <div className="cx-empty">
                <span className="cx-empty-ic"><Folder /></span>
                <span className="cx-empty-title">{t('No files yet')}</span>
                <span className="cx-empty-text">{t('Files the assistant creates or edits appear here as it works.')}</span>
                <div className="cx-empty-acts">
                  <button type="button" className="cx-pill" disabled={busy} onClick={() => onAction('new', '')}><FilePlus />{t('New file')}</button>
                  <button type="button" className="cx-pill" disabled={busy} onClick={() => uploadRef.current?.click()}><Upload />{t('Upload')}</button>
                </div>
              </div>
            ) : shown.length === 0 && q ? (
              <div className="cx-tree-none">{t('No files match “{q}”.', { q: filter })}</div>
            ) : (
              <Tree node={root} depth={0} closed={closed} onToggle={toggleDir} active={active} live={live} pending={pending}
                renaming={renaming} onOpen={setActive} onAction={onAction} />
            )}
          </div>
        )}
        {active && (
          <div className="cx-view">
            <MemoViewer chatId={chatId} path={active}
              liveText={live && live.path === active ? live.content : null}
              liveInfo={live && live.path === active ? live : null}
              committed={files.some(f => f.path === active)}
              fileV={byPath.get(active)?.v || 0}
              pendingText={active in pending ? pending[active] : null}
              editable={!busy}
              onSaved={onSaved}
              canBack={!showTree} onBack={() => setActive(null)}
              headerExtra={<button type="button" className="art-btn icon" onClick={() => setActive(null)} data-tip={t('Close file')} aria-label={t('Close file')}><X style={{ width: 14 }} /></button>} />
          </div>
        )}
      </div>
      <input ref={uploadRef} type="file" multiple hidden onChange={upload} />
    </section>
  );
}