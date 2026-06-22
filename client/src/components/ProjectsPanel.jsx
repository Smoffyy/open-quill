import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';
import Composer from './Composer.jsx';
import { Box, Search, Plus, ChevDown, Star, Dots, Trash, Pencil, X, FileText } from './icons.jsx';

function updatedLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const opts = sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' };
  return 'Updated ' + d.toLocaleDateString(undefined, opts);
}
function lastMsgLabel(ts) {
  const d = new Date(ts);
  return 'Last message ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function CreateModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  async function submit() {
    if (busy) return;
    setBusy(true);
    try { const p = await api.post('/api/projects', { name: name.trim() || 'New project', description: desc.trim() }); onCreate(p); }
    catch (e) { setBusy(false); }
  }
  return (
    <div className="overlay pj-create-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pj-create">
        <div className="pj-create-head">
          <h2>Create a project</h2>
          <button className="pj-x" onClick={onClose}><X style={{ width: 18 }} /></button>
        </div>
        <label className="pj-field">
          <span>What are you working on?</span>
          <input ref={ref} value={name} placeholder="Name your project"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
        </label>
        <label className="pj-field">
          <span>What are you trying to achieve?</span>
          <textarea value={desc} placeholder="Describe your project, goals, subject, etc..."
            onChange={(e) => setDesc(e.target.value)} rows={3} />
        </label>
        <div className="pj-create-actions">
          <button className="pj-btn ghost" onClick={onClose}>Cancel</button>
          <button className="pj-btn solid" onClick={submit} disabled={busy}>Create project</button>
        </div>
      </div>
    </div>
  );
}

function ProjectDetail({ id, composerProps, onBack, onOpenChat, onStartChat, onChanged, onDeleted }) {
  const [project, setProject] = useState(null);
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
  useEffect(() => {
    if (!menu) return;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);
  if (!project) return <div className="pj-detail" />;

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
    if (!confirm('Delete this project? Chats inside it are kept.')) return;
    await api.del('/api/projects/' + id);
    onDeleted?.();
  }

  return (
    <div className="pj-detail">
      <button className="pj-back" onClick={onBack}>← All projects</button>
      <div className="pj-detail-grid">
        <div className="pj-main">
          <div className="pj-title-row">
            {renaming ? (
              <input className="pj-title-edit" autoFocus value={name}
                onChange={(e) => setName(e.target.value)} onBlur={commitName}
                onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setName(project.name); setRenaming(false); } }} />
            ) : (
              <h1 className="pj-name">{project.name}</h1>
            )}
            <div className="pj-title-ctrls">
              <div className="pj-menu-wrap" ref={menuRef}>
                <button className="pj-icon-btn" onClick={() => setMenu(m => !m)}><Dots style={{ width: 18 }} /></button>
                {menu && (
                  <div className="pj-menu">
                    <button onClick={() => { setMenu(false); setRenaming(true); }}><Pencil style={{ width: 15 }} /> Rename</button>
                    <button className="danger" onClick={() => { setMenu(false); del(); }}><Trash style={{ width: 15 }} /> Delete project</button>
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
            <Composer {...composerProps} project={null} autoFocus
              onSend={(attachments) => onStartChat(project, composerProps.value, attachments)} />
          </div>

          <div className="pj-chats">
            {project.chats.length === 0 ? (
              <div className="pj-empty">Start a chat to keep conversations organized and re-use project knowledge.</div>
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
              <span>Instructions</span>
              <button className="pj-card-add" onClick={() => setEditingInstr(e => !e)}><Plus style={{ width: 16 }} /></button>
            </div>
            {editingInstr ? (
              <textarea className="pj-instr-edit" autoFocus value={instr} rows={5}
                placeholder="Add instructions to tailor Claude's responses"
                onChange={(e) => setInstr(e.target.value)} onBlur={saveInstr} />
            ) : (
              <div className="pj-card-sub" onClick={() => setEditingInstr(true)}>
                {project.instructions ? project.instructions : "Add instructions to tailor Claude's responses"}
              </div>
            )}
          </div>
          <div className="pj-card">
            <div className="pj-card-head">
              <span>Files</span>
              <button className="pj-card-add"><Plus style={{ width: 16 }} /></button>
            </div>
            <div className="pj-files-empty">
              <FileText style={{ width: 30 }} />
              <span>Add PDFs, documents, or other text to reference in this project.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPanel({ openId, composerProps, onClose, onOpenChat, onStartChat, onOpenProject }) {
  const [projects, setProjects] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('updated');
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState(openId || null);

  const load = useCallback(async () => { try { setProjects(await api.get('/api/projects')); } catch { setProjects([]); } }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDetailId(openId || null); }, [openId]);

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
            <h2>Projects</h2>
            <div className="pj-head-actions">
              <div className="pj-sort">
                <span>Sort by</span> <b>{sort === 'name' ? 'Name' : 'Last updated'}</b>
                <button className="pj-sort-toggle" onClick={() => setSort(s => s === 'name' ? 'updated' : 'name')}><ChevDown style={{ width: 15 }} /></button>
              </div>
              <button className="pj-new" onClick={() => setCreating(true)}>New project</button>
              <button className="co-close" onClick={onClose}>✕</button>
            </div>
          </div>
          <div className="co-body">
            <div className="pj-search">
              <Search style={{ width: 16 }} />
              <input value={q} placeholder="Search projects..." onChange={(e) => setQ(e.target.value)} />
            </div>
            {projects === null ? null : list.length === 0 ? (
              <div className="co-end">{q.trim() ? 'No projects match your search.' : 'No projects yet — create one to get started.'}</div>
            ) : (
              <div className="pj-grid">
                {list.map((p, i) => (
                  <button key={p.id} className="pj-card-tile" style={{ animationDelay: (i * 26) + 'ms' }} onClick={() => openDetail(p.id)}>
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
