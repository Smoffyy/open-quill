import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { askConfirm } from '../../lib/confirm.js';
import { useDismiss } from '../../lib/dismiss.js';
import { droppedFiles, pickedFiles } from '../../lib/dropfiles.js';
import { baseName } from '../../lib/artifacts.js';
import { Plus, Chevron, FileText, Folder, Pencil, Upload, Download, X } from '../ui/icons.jsx';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';
import Viewer from '../artifacts/Viewer.jsx';
import { t } from '../../i18n.jsx';

function buildFileTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = String(f.name || '').split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg);
    }
    node.files.push({ ...f, base: parts[parts.length - 1] });
  }
  return root;
}

function countFiles(node) {
  let n = node.files.length;
  for (const d of node.dirs.values()) n += countFiles(d);
  return n;
}

const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n >= 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B');

function NameField({ initial = '', label, placeholder, depth = 0, onSubmit, onCancel }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const done = useRef(false);
  const errId = useId();
  const cancel = () => { done.current = true; onCancel(); };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const start = initial.lastIndexOf('/') + 1;
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(start, dot > start ? dot : initial.length);
  }, []);
  async function submit() {
    const v = value.trim();
    if (busy || done.current) return;
    if (!v || v === initial) { cancel(); return; }
    setBusy(true);
    const err = await onSubmit(v);
    if (!err) { done.current = true; return; }
    setBusy(false);
    setError(err);
    ref.current?.focus();
  }
  return (
    <form className="pj-row pj-name-form" style={{ paddingLeft: 8 + depth * 12 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input ref={ref} className="pj-name-input" value={value} aria-label={label} placeholder={placeholder} spellCheck={false}
        aria-invalid={error ? true : undefined} aria-describedby={errId} readOnly={busy}
        onChange={(e) => { setValue(e.target.value); if (error) setError(''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}
        onBlur={() => { if (!error) submit(); }} />
      <div id={errId} className="pj-name-error" role="alert">{error}</div>
    </form>
  );
}

function FileTree({ node, prefix, depth, closed, renaming, onToggle, onOpen, onRename, onRenamed, onCancelRename, onRemove }) {
  const rows = [];
  for (const [seg, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dirPath = prefix ? prefix + '/' + seg : seg;
    const isClosed = closed.has(dirPath);
    rows.push(
      <div key={'d:' + dirPath}>
        <button type="button" className="pj-row pj-row-dir" style={{ paddingLeft: 8 + depth * 12 }} aria-expanded={!isClosed} onClick={() => onToggle(dirPath)}>
          <Chevron className={'pj-row-chev' + (isClosed ? '' : ' open')} style={{ width: 12 }} />
          <span className="pj-row-name">{seg}</span>
          <span className="pj-row-meta">{countFiles(child)}</span>
        </button>
        {!isClosed && (
          <FileTree node={child} prefix={dirPath} depth={depth + 1} closed={closed} renaming={renaming} onToggle={onToggle} onOpen={onOpen}
            onRename={onRename} onRenamed={onRenamed} onCancelRename={onCancelRename} onRemove={onRemove} />
        )}
      </div>
    );
  }
  for (const f of node.files) {
    if (renaming === f.name) {
      rows.push(
        <NameField key={'r:' + f.name} initial={f.name} depth={depth} label={t('Rename {name}', { name: f.base })}
          onSubmit={(to) => onRenamed(f.name, to)} onCancel={onCancelRename} />
      );
      continue;
    }
    rows.push(
      <div key={'f:' + f.name} className="pj-row" style={{ paddingLeft: 8 + depth * 12 }} title={f.name}>
        <button type="button" className="pj-row-open" onClick={() => onOpen(f.name)}>
          <FileText className="pj-row-icon" style={{ width: 13 }} />
          <span className="pj-row-name">{f.base}</span>
          <span className="pj-row-meta">{fmtSize(f.size)}</span>
        </button>
        <span className="pj-row-actions">
          <button type="button" className="ft-act" title={t('Rename')} aria-label={t('Rename {name}', { name: f.base })} onClick={() => onRename(f.name)}><Pencil /></button>
          <button type="button" className="ft-act ft-del" title={t('Delete')} aria-label={t('Delete {name}', { name: f.base })} onClick={() => onRemove(f.name)}><X /></button>
        </span>
      </div>
    );
  }
  return <>{rows}</>;
}

function FileDialog({ base, path, onClose, onSaved }) {
  const dirty = useRef(false);
  const close = async () => {
    if (dirty.current && !await askConfirm({ title: t('Discard unsaved changes?'), message: t('Your edits to {name} have not been saved.', { name: baseName(path) }), confirm: t('Discard'), danger: true })) return;
    onClose();
  };
  return (
    <Dialog className="pj-file-dialog" overlayClassName="pj-file-overlay" label={baseName(path)} onClose={close}>
      <Viewer apiBase={base} path={path} editable onSaved={onSaved}
        onDirtyChange={(d) => { dirty.current = d; }}
        headerExtra={<CloseButton plain className="art-btn icon" onClick={close} />} />
    </Dialog>
  );
}

export default function ProjectFiles({ projectId }) {
  const base = '/api/projects/' + projectId;
  const [files, setFiles] = useState([]);
  const [cap, setCap] = useState(0);
  const [closed, setClosed] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const menuRef = useRef(null);
  useDismiss(menu, () => setMenu(false), menuRef);

  const apply = useCallback((d) => { if (d?.files) setFiles(d.files); if (d?.cap) setCap(d.cap); }, []);
  const load = useCallback(async () => { try { apply(await api.get(base + '/files')); } catch {} }, [base, apply]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { folderInput.current?.setAttribute('webkitdirectory', ''); }, []);

  async function upload(items) {
    if (!items.length || busy) return;
    setBusy(true);
    let failed = 0;
    let firstError = '';
    for (const { file, path } of items) {
      try {
        const fd = new FormData();
        fd.append('path', path);
        fd.append('file', file);
        const r = await fetch(base + '/files', { method: 'POST', body: fd, credentials: 'same-origin' });
        const d = await r.json().catch(() => ({}));
        if (r.ok) apply(d);
        else { failed++; if (!firstError) firstError = d.error || ''; }
      } catch { failed++; }
    }
    setBusy(false);
    if (failed === 1) toast(firstError || t('Upload failed.'), { icon: 'info', kind: 'warn' });
    else if (failed > 1) toast(t('{n} files could not be uploaded.', { n: failed }) + (firstError ? ' ' + firstError : ''), { icon: 'info', kind: 'warn' });
  }

  async function create(path) {
    try {
      const d = await api.post(base + '/files/new', { path });
      apply(d);
      setCreating(false);
      setOpen(d.path);
      return '';
    } catch (e) { return e?.message || t('Could not create the file.'); }
  }

  async function rename(from, to) {
    try {
      apply(await api.post(base + '/files/rename', { path: from, to }));
      setRenaming(null);
      return '';
    } catch (e) { return e?.message || t('Could not rename the file.'); }
  }

  async function remove(name) {
    if (!await askConfirm({ title: t('Delete {name}?', { name: baseName(name) }), message: t('Every chat in this project loses access to it. This cannot be undone.'), confirm: t('Delete'), danger: true })) return;
    try { apply(await api.del(base + '/files?path=' + encodeURIComponent(name))); } catch {}
  }

  async function onDrop(e) {
    e.preventDefault();
    setDropping(false);
    upload(await droppedFiles(e.dataTransfer));
  }

  const toggleDir = (p) => setClosed(prev => { const next = new Set(prev); if (next.has(p)) next.delete(p); else next.add(p); return next; });
  const capPct = cap ? Math.min(100, Math.round(files.reduce((n, f) => n + (f.size || 0), 0) / cap * 100)) : 0;
  const pick = (fn) => { setMenu(false); fn(); };

  return (
    <>
      <div className={'pj-card pj-files' + (dropping ? ' dropping' : '')} data-own-drop
        onDragOver={(e) => { if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return; e.preventDefault(); if (!dropping) setDropping(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); }}
        onDrop={onDrop}>
        <div className="pj-card-head">
          <span>{t('Files')}{files.length ? ` (${files.length})` : ''}</span>
          <span className="pj-card-tools">
            {files.length > 0 && (
              <a className="pj-card-add" href={base + '/zip'} title={t('Download all')} aria-label={t('Download all')}><Download style={{ width: 15 }} /></a>
            )}
            <span className="pj-menu-wrap" ref={menuRef}>
              <button type="button" className="pj-card-add" disabled={busy} title={t('Add files')} aria-label={t('Add files')}
                aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}><Plus style={{ width: 16 }} /></button>
              {menu && (
                <div className="pj-menu pj-files-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => pick(() => fileInput.current?.click())}><Upload style={{ width: 15 }} /> {t('Upload files')}</button>
                  <button type="button" role="menuitem" onClick={() => pick(() => folderInput.current?.click())}><Folder style={{ width: 15 }} /> {t('Upload a folder')}</button>
                  <button type="button" role="menuitem" onClick={() => pick(() => { setRenaming(null); setCreating(true); })}><FileText style={{ width: 15 }} /> {t('New file')}</button>
                </div>
              )}
            </span>
          </span>
          <input ref={fileInput} type="file" multiple hidden
            onChange={(e) => { upload(pickedFiles(e.target.files)); e.target.value = ''; }} />
          <input ref={folderInput} type="file" multiple hidden
            onChange={(e) => { upload(pickedFiles(e.target.files)); e.target.value = ''; }} />
        </div>
        <div className="pj-cap">{t('{pct}% of project capacity used', { pct: capPct })}</div>
        {files.length === 0 && !creating ? (
          <button type="button" className="pj-files-empty" onClick={() => fileInput.current?.click()}>
            <FileText style={{ width: 30 }} />
            <span>{busy ? t('Uploading…') : t('Add any file. Every chat in this project shares this workspace and can read, edit and run what is in it.')}</span>
            {!busy && <span className="pj-files-drop">{t('Or drop files and folders here.')}</span>}
          </button>
        ) : (
          <div className="pj-file-tree">
            {creating && (
              <NameField label={t('New file name')} placeholder={t('File name, e.g. notes.md')}
                onSubmit={create} onCancel={() => setCreating(false)} />
            )}
            <FileTree node={buildFileTree(files)} prefix="" depth={0} closed={closed} renaming={renaming}
              onToggle={toggleDir} onOpen={setOpen} onRename={(p) => { setCreating(false); setRenaming(p); }}
              onRenamed={rename} onCancelRename={() => setRenaming(null)} onRemove={remove} />
            {busy && <div className="pj-row"><span className="pj-row-name">{t('Uploading…')}</span></div>}
          </div>
        )}
      </div>
      {open && <FileDialog base={base} path={open} onClose={() => setOpen(null)} onSaved={apply} />}
    </>
  );
}
