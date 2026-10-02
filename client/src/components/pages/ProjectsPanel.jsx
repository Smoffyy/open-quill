import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import Composer from '../composer/Composer.jsx';
import { Box, Search, Plus, ChevDown, Star, Dots, Trash, Pencil } from '../ui/icons.jsx';
import { t, fmtDate } from '../../i18n.jsx';
import { focusUnlessTouch } from '../../lib/touch.js';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';
import { useDismiss } from '../../lib/dismiss.js';
import { useSkeleton } from '../../lib/skeleton.js';
import { askConfirm } from '../../lib/confirm.js';
import ProjectFiles from './ProjectFiles.jsx';

function updatedLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const opts = sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
  return t('Updated {when}', { when: fmtDate(d, opts) });
}
function lastMsgLabel(ts) {
  const d = new Date(ts);
  return t('Last message {when}', { when: fmtDate(d, { month: 'short', day: 'numeric' }) });
}

function CreateModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { focusUnlessTouch(ref.current); }, []);
  async function submit(e) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    try { const p = await api.post('/api/projects', { name: name.trim() || t('New project'), description: desc.trim() }); onCreate(p); }
    catch (err) { setBusy(false); toast(err?.message || t('Could not save these changes.'), { icon: 'info', kind: 'warn' }); }
  }
  return (
    <Dialog className="pj-create" overlayClassName="pj-create-overlay" labelledBy="pj-create-title" onClose={onClose} initialFocus={ref}>
      <form onSubmit={submit}>
        <div className="pj-create-head">
          <h2 id="pj-create-title">{t("Create a project")}</h2>
          <CloseButton plain className="pj-x" onClick={onClose} />
        </div>
        <label className="pj-field">
          <span>{t("What are you working on?")}</span>
          <input ref={ref} value={name} placeholder={t("Name your project")}
            onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="pj-field">
          <span>{t("What are you trying to achieve?")}</span>
          <textarea value={desc} placeholder={t("Describe your project, goals, subject, etc...")}
            onChange={(e) => setDesc(e.target.value)} rows={3} />
        </label>
        <div className="pj-create-actions">
          <button type="button" className="pj-btn ghost" onClick={onClose}>{t("Cancel")}</button>
          <button type="submit" className="pj-btn solid" disabled={busy}>
            {busy && <span className="btn-spin" aria-hidden="true" />}{t("Create project")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ProjectDetail({ id, composerProps, onBack, onOpenChat, onStartChat, onChanged, onDeleted }) {
  const [project, setProject] = useState(null);
  const showSkeleton = useSkeleton(!project);
  const [editingInstr, setEditingInstr] = useState(false);
  const [instr, setInstr] = useState('');
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const menuRef = useRef(null);
  const load = useCallback(async () => {
    try { const p = await api.get('/api/projects/' + id); setProject(p); setInstr(p.instructions || ''); setName(p.name); }
    catch { onBack(); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useDismiss(menu, () => setMenu(false), menuRef);
  if (!project) return !showSkeleton ? null : (
    <div className="pj-detail" aria-hidden="true">
      <div className="pj-main">
        <div className="pj-title-row"><span className="skeleton pj-name-skel" /></div>
        <div className="pj-chats">
          {[64, 48, 56].map((w, i) => <span key={i} className="skeleton pj-row-skel" style={{ width: w + '%' }} />)}
        </div>
      </div>
    </div>
  );

  async function patch(body) {
    const p = await api.patch('/api/projects/' + id, body);
    setProject(pp => ({ ...pp, ...p }));
    onChanged?.();
  }
  function saveInstr() { setEditingInstr(false); if (instr !== project.instructions) patch({ instructions: instr }); }
  function commitName() {
    setRenaming(false);
    const v = name.trim();
    if (v && v !== project.name) patch({ name: v }); else setName(project.name);
  }
  async function del() {
    if (!await askConfirm({ title: t('Delete this project?'), message: t('Its files are deleted. Chats inside it are kept.'), confirm: t('Delete project'), danger: true })) return;
    await api.del('/api/projects/' + id);
    onDeleted?.();
  }

  return (
    <div className="pj-detail">
      <button className="pj-back" onClick={onBack}>{t("← All projects")}</button>
      <div className="pj-detail-grid">
        <div className="pj-main">
          <div className="pj-title-row">
            {renaming ? (
              <input className="pj-title-edit" autoFocus value={name}
                onChange={(e) => setName(e.target.value)} onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { e.preventDefault(); setName(project.name); setRenaming(false); } }} />
            ) : (
              <h1 className="pj-name">{project.name}</h1>
            )}
            <div className="pj-title-ctrls">
              <div className="pj-menu-wrap" ref={menuRef}>
                <button className="pj-icon-btn" onClick={() => setMenu(m => !m)}><Dots style={{ width: 18 }} /></button>
                {menu && (
                  <div className="pj-menu">
                    <button onClick={() => { setMenu(false); setRenaming(true); }}><Pencil style={{ width: 15 }} /> {t("Rename")}</button>
                    <button className="danger" onClick={() => { setMenu(false); del(); }}><Trash style={{ width: 15 }} /> {t("Delete project")}</button>
                  </div>
                )}
              </div>
              <button className={'pj-icon-btn' + (project.starred ? ' on' : '')} onClick={() => patch({ starred: !project.starred })}>
                <Star style={{ width: 18 }} />
              </button>
            </div>
          </div>
          {project.description && <div className="pj-desc">{project.description}</div>}

          <div className="pj-composer">
            <Composer {...composerProps} project={null} autoFocus enterSend={false}
              onSend={(attachments) => onStartChat(project, composerProps.value, attachments)} />
          </div>

          <div className="pj-chats">
            {project.chats.length > 0 && <div className="pj-chats-head">{t("Recents")}</div>}
            {project.chats.length === 0 ? (
              <div className="pj-empty">{t("Start a chat to keep conversations organized and re-use project knowledge.")}</div>
            ) : (
              project.chats.map(c => (
                <button key={c.id} className="pj-chat-row" onClick={() => onOpenChat(c.id, project)}>
                  <div className="pj-chat-title">{c.title}</div>
                  <div className="pj-chat-time">{lastMsgLabel(c.updated_at)}</div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="pj-side">
          <div className="pj-card">
            <div className="pj-card-head">
              <span>{t("Instructions")}</span>
              <button className="pj-card-add" onClick={() => setEditingInstr(e => !e)}><Plus style={{ width: 16 }} /></button>
            </div>
            {editingInstr ? (
              <textarea className="pj-instr-edit" autoFocus value={instr} rows={5}
                placeholder={t("Add instructions to tailor the Assistant's responses")}
                onChange={(e) => setInstr(e.target.value)} onBlur={saveInstr} />
            ) : (
              <div className="pj-card-sub" onClick={() => setEditingInstr(true)}>
                {project.instructions ? project.instructions : t("Add instructions to tailor Assistant's responses")}
              </div>
            )}
          </div>
          <ProjectFiles projectId={id} />
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPanel({ openId, composerProps, onClose, onOpenChat, onStartChat, onOpenProject, startCreate = false, onCreateHandled }) {
  const [projects, setProjects] = useState(null);
  const showSkeleton = useSkeleton(projects === null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('updated');
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState(openId || null);

  const load = useCallback(async () => { try { setProjects(await api.get('/api/projects')); } catch { setProjects([]); } }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDetailId(openId || null); }, [openId]);
  // The sidebar's + opens this panel and asks for the create dialog in one go.
  useEffect(() => { if (!startCreate) return; setDetailId(null); setCreating(true); onCreateHandled && onCreateHandled(); }, [startCreate, onCreateHandled]);

  function openDetail(id) { setDetailId(id); onOpenProject?.(id); }

  let list = (projects || []).filter(p => !q.trim() || p.name.toLowerCase().includes(q.toLowerCase()) || (p.description || '').toLowerCase().includes(q.toLowerCase()));
  list = list.slice().sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : b.updated_at - a.updated_at);

  return (
    <div className="chats-overview pj-overview">
      {detailId ? (
        <ProjectDetail id={detailId} composerProps={composerProps}
          onBack={() => { setDetailId(null); onOpenProject?.(null); load(); }}
          onOpenChat={onOpenChat} onStartChat={onStartChat}
          onChanged={load}
          onDeleted={() => { setDetailId(null); onOpenProject?.(null); load(); }} />
      ) : (
        <>
          <div className="co-head pj-head">
            <h2>{t("Projects")}</h2>
            <div className="pj-head-actions">
              <div className="pj-sort">
                <span>{t("Sort by")}</span> <b>{sort === 'name' ? t('Name') : t('Last updated')}</b>
                <button className="pj-sort-toggle" onClick={() => setSort(s => s === 'name' ? 'updated' : 'name')}><ChevDown style={{ width: 15 }} /></button>
              </div>
              <button className="pj-new" onClick={() => setCreating(true)}>{t("New project")}</button>
              <CloseButton plain className="co-close" onClick={onClose} />
            </div>
          </div>
          <div className="co-body">
            <div className="pj-search">
              <Search style={{ width: 16 }} />
              <input value={q} placeholder={t("Search projects...")} onChange={(e) => setQ(e.target.value)} />
            </div>
            {projects === null ? (showSkeleton &&
              <div className="pj-grid" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="pj-card-tile pj-tile-skel">
                    <div className="pj-tile-top"><span className="skeleton" style={{ width: '52%' }} /></div>
                    <span className="skeleton" style={{ width: '78%' }} />
                    <span className="skeleton" style={{ width: '34%' }} />
                  </div>
                ))}
              </div>
            ) : list.length === 0 ? (
              <div className="co-end">{q.trim() ? t('No projects match your search.') : t('No projects yet, create one to get started.')}</div>
            ) : (
              <div className="pj-grid">
                {list.map((p, i) => (
                  <button key={p.id} className="pj-card-tile" style={{ animationDelay: (i % 18) * 26 + 'ms' }} onClick={() => openDetail(p.id)}>
                    <div className="pj-tile-top">
                      <span className="pj-tile-icon"><Box style={{ width: 17 }} /></span>
                      <div className="pj-tile-name">{p.name}</div>
                    </div>
                    {p.description && <div className="pj-tile-desc">{p.description}</div>}
                    <div className="pj-tile-time">{updatedLabel(p.updated_at)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onCreate={(p) => { setCreating(false); load(); openDetail(p.id); }} />}
    </div>
  );
}