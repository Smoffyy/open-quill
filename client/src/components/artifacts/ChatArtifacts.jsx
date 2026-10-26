import React, { useState, useEffect, useRef, useCallback } from 'react';
import Viewer from './Viewer.jsx';
import { FileText, Download, X, Expand, Collapse, Trash, Box, ChevDown, Check } from '../ui/icons.jsx';
import { api } from '../../lib/api.js';
import { notify } from '../../lib/notify.js';
import { askConfirm } from '../../lib/confirm.js';
import { useLayer, useDismiss } from '../../lib/dismiss.js';
import { baseName, extOf, fmtSize, EXT_COLOR } from '../../lib/artifacts.js';
import { t } from '../../i18n.jsx';

const MemoViewer = React.memo(Viewer);

function clampW(w) { return Math.max(320, Math.min(w, Math.round(window.innerWidth * 0.85))); }

function ArtifactCard({ f, base, writing, pending, active, onOpen, onDelete, busy }) {
  const ext = extOf(f.path);
  const tint = EXT_COLOR[ext] || null;
  const sub = writing ? t('Writing…') : pending ? t('Saving…')
    : [ext.toUpperCase() || 'FILE', f.size != null ? fmtSize(f.size) : '', f.v > 1 ? t('version {v}', { v: f.v }) : ''].filter(Boolean).join(' · ');
  return (
    <div className={'art-card' + (writing || pending ? ' writing' : '') + (active ? ' on' : '')}>
      <button type="button" className="art-card-open" onClick={() => onOpen(f.path)} data-tip={f.path}>
        <span className="art-thumbcol" aria-hidden="true">
          <span className="art-thumb" style={tint ? { color: tint } : undefined}>
            <FileText />
            <span className="art-thumb-ext">{(ext || 'file').toUpperCase().slice(0, 4)}</span>
          </span>
        </span>
        <span className="art-card-body">
          <span className="art-card-title">{baseName(f.path)}</span>
          <span className="art-card-sub">{sub}</span>
        </span>
      </button>
      {!writing && !pending && (
        <>
          <a className="art-card-dl" href={`${base}/download?path=${encodeURIComponent(f.path)}`}
            data-tip={t('Download')} aria-label={t('Download {name}', { name: baseName(f.path) })}><Download style={{ width: 16 }} /></a>
          <button type="button" className="art-card-dl" disabled={busy} onClick={() => onDelete(f.path)}
            data-tip={t('Delete')} aria-label={t('Delete {name}', { name: baseName(f.path) })}><Trash style={{ width: 15 }} /></button>
        </>
      )}
    </div>
  );
}

function SaveToProject({ chatId, path, projectId, projects }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, () => setOpen(false), ref);
  if (!projects.length) return null;
  const ordered = projectId ? [...projects.filter(p => p.id === projectId), ...projects.filter(p => p.id !== projectId)] : projects;
  async function save(p) {
    setOpen(false);
    try {
      const r = await api.post(`/api/chats/${chatId}/artifacts/save`, { path, projectId: p.id });
      notify(t('Added {name} to {project}', { name: r.path, project: r.projectName }), { kind: 'success', icon: 'check' });
    } catch (e) { notify(e?.message || t('Could not add it to the project.'), { kind: 'warn' }); }
  }
  return (
    <div className="art-copy-wrap" ref={ref}>
      <button type="button" className="art-btn text" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        data-tip={t('Add a copy to a project, where every chat in it can read it')}>
        <Box style={{ width: 14 }} /> {t('Add to project')} <ChevDown style={{ width: 12 }} />
      </button>
      {open && (
        <div className="art-menu" role="menu">
          <div className="art-menu-label">{t('Add to project')}</div>
          {ordered.map(p => (
            <button key={p.id} type="button" role="menuitem" className="art-menu-item" onClick={() => save(p)}>
              {p.name}{p.id === projectId && <Check style={{ width: 13 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatArtifacts({ chatId, files, live, pending = {}, focus = null, busy = false, projectId = null, projects = [], onFilesChanged, onClose }) {
  const [active, setActive] = useState(null);
  const [width, setWidth] = useState(null);
  const [resizing, setResizing] = useState(false);
  const [full, setFull] = useState(false);
  const base = `/api/chats/${chatId}/artifacts`;

  const byPath = new Map(files.map(f => [f.path, f]));
  for (const p of Object.keys(pending)) if (!byPath.has(p)) byPath.set(p, { path: p, v: 0 });
  if (live && live.path && !byPath.has(live.path)) byPath.set(live.path, { path: live.path, v: 0 });
  const list = [...byPath.values()];
  const only = list.length === 1 ? list[0].path : null;
  const shown = active && byPath.has(active) ? active : only;

  useEffect(() => { setActive(null); setFull(false); }, [chatId]);
  useEffect(() => { if (focus && focus.path) setActive(focus.path); }, [focus]);
  const livePath = live && live.path;
  useEffect(() => { if (livePath) setActive(livePath); }, [livePath]);

  useLayer(true, (e) => {
    const el = e?.target;
    if (el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable)) return;
    if (full) setFull(false);
    else if (shown && list.length > 1) setActive(null);
    else onClose();
  });

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

  const changedRef = useRef(onFilesChanged);
  changedRef.current = onFilesChanged;
  const onSaved = useCallback((d) => { if (Array.isArray(d?.files)) changedRef.current?.(d.files); }, []);

  async function remove(path) {
    if (!await askConfirm({ title: t('Delete {name}?', { name: baseName(path) }), message: t('Every version of this artifact is deleted. This cannot be undone.'), confirm: t('Delete'), danger: true })) return;
    try {
      const r = await api.del(`${base}?path=${encodeURIComponent(path)}`);
      onFilesChanged(r.files || []);
      if (active === path) setActive(null);
    } catch (e) { notify(e?.message || t('Could not delete the artifact.'), { kind: 'warn' }); }
  }

  const closeBtn = <button className="art-btn icon" onClick={onClose} data-tip={t('Close panel')} aria-label={t('Close panel')}><X style={{ width: 15 }} /></button>;
  const fullBtn = (
    <button className="art-btn icon" onClick={() => setFull(f => !f)} aria-pressed={full}
      data-tip={full ? t('Exit full screen') : t('Full screen')} aria-label={full ? t('Exit full screen') : t('Full screen')}>
      {full ? <Collapse style={{ width: 15 }} /> : <Expand style={{ width: 15 }} />}
    </button>
  );
  const writing = !!(live && shown === live.path);

  return (
    <aside className={'artifacts chat-artifacts' + (resizing ? ' resizing' : '') + (shown ? ' viewing' : '') + (full ? ' full' : '')}
      style={width && !full ? { width } : undefined} aria-label={t('Artifacts')}>
      <div className="art-resizer" onMouseDown={startResize} onTouchStart={startResize} data-tip={t('Drag to resize')}><span /></div>
      {shown ? (
        <div className="art-panes">
          <div className="art-pane focused">
            <MemoViewer key={shown} apiBase={base} path={shown} preferPreview
              onBack={() => setActive(null)} canBack={list.length > 1}
              liveText={writing ? live.content : null} liveInfo={writing ? live : null}
              committed={files.some(f => f.path === shown)} fileV={byPath.get(shown)?.v || 0}
              pendingText={shown in pending ? pending[shown] : null}
              editable={!busy} onSaved={onSaved}
              headerExtra={<>
                {!writing && files.some(f => f.path === shown) && <SaveToProject chatId={chatId} path={shown} projectId={projectId} projects={projects} />}
                {fullBtn}{closeBtn}
              </>} />
          </div>
        </div>
      ) : (
        <>
          <div className="art-head">
            <div className="art-title">{t('Artifacts')}{list.length > 0 && <span className="art-count">{list.length}</span>}</div>
            <div className="art-head-actions">
              {files.length > 1 && <a className="art-dl-all" href={`${base}/zip`}><Download style={{ width: 15 }} /> {t('Download all')}</a>}
              {closeBtn}
            </div>
          </div>
          {list.length === 0 ? (
            <div className="art-list">
              <div className="art-empty big">
                <div className="art-empty-icon"><FileText style={{ width: 26 }} /></div>
                <div className="art-empty-title">{t('No artifacts yet')}</div>
                <div>{t('Ask for a document, a plan, a web page, a diagram or a script and it opens here, ready to read, edit, compare and download.')}</div>
              </div>
            </div>
          ) : (
            <div className="art-cards">
              {list.map(f => (
                <ArtifactCard key={f.path} f={f} base={base} busy={busy}
                  writing={!!live && live.path === f.path} pending={f.path in pending}
                  active={active === f.path} onOpen={setActive} onDelete={remove} />
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}