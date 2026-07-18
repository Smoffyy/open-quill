import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card, AutosaveNote, SettingRow } from '../widgets.jsx';
import { FileText, Pencil, Trash } from '../../icons.jsx';

export default function MembankSection() {
  const A = useAdmin();
  const { settings, setSettings, settingsSave } = A;
  const [files, setFiles] = useState([]);
  const [edit, setEdit] = useState(null);
  const [editName, setEditName] = useState('');
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(null);
  const pickRef = useRef(null);

  useEffect(() => {
    (async () => { try { const d = await api.get('/api/admin/membank'); setFiles(d.files || []); } catch {} })();
  }, []);

  async function onPick(e) {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    try { const r = await api.uploadMembank(list); setFiles(r.files || []); } catch {}
  }
  async function remove(name) {
    try { const r = await api.del('/api/admin/membank/' + encodeURIComponent(name)); setFiles(r.files || []); } catch {}
  }
  async function saveRename(oldName) {
    const name = editName.trim();
    setErr('');
    if (!name || name === oldName) { setEdit(null); return; }
    try { const r = await api.patch('/api/admin/membank/' + encodeURIComponent(oldName), { name }); setFiles(r.files || []); setEdit(null); }
    catch (e) { setErr(e?.message || 'Could not rename file.'); }
  }
  async function setFolder(name, folder) {
    setFiles(fs => fs.map(f => f.name === name ? { ...f, folder } : f));
    try { const r = await api.patch('/api/admin/membank/' + encodeURIComponent(name), { folder }); setFiles(r.files || []); } catch {}
  }
  async function commitOrder(ordered) {
    setFiles(ordered);
    try { const r = await api.put('/api/admin/membank/order', { items: ordered.map(f => ({ name: f.name, folder: f.folder || '' })) }); if (r.files) setFiles(r.files); } catch {}
  }
  function onDrop(target) {
    if (!drag || drag === target.name) { setDrag(null); return; }
    const arr = files.slice();
    const from = arr.findIndex(f => f.name === drag);
    const to = arr.findIndex(f => f.name === target.name);
    if (from < 0 || to < 0) { setDrag(null); return; }
    const [moved] = arr.splice(from, 1);
    moved.folder = target.folder || '';
    arr.splice(to, 0, moved);
    setDrag(null);
    commitOrder(arr);
  }

  const groups = [];
  const seen = new Map();
  for (const f of files) {
    const k = f.folder || '';
    if (!seen.has(k)) { seen.set(k, { folder: k, files: [] }); groups.push(seen.get(k)); }
    seen.get(k).files.push(f);
  }

  return (
    <>
      <Card title="Behavior" sub="How and when models reach for these files.">
        <SettingRow label="Enable memory bank" note={<>When on, all models receive a system-prompt section listing these files plus the <code>mb_view</code> and <code>mb_search</code> tools.</>}
          on={!!settings.membankEnabled} onToggle={() => setSettings(s => ({ ...s, membankEnabled: !s.membankEnabled }))} />
        <SettingRow label="Hide tool calls from users" note={<>When on, file reads stay behind the scenes, the model still uses the files, but users won't see the <code>mb_view</code> / <code>mb_search</code> steps in the reply.</>}
          on={!!settings.membankHideTools} onToggle={() => setSettings(s => ({ ...s, membankHideTools: !s.membankHideTools }))} />
        <div className="field" style={{ marginBottom: 0 }}>
          <label>System prompt</label>
          <textarea rows={5} value={settings.membankPrompt ?? ''} onChange={(e) => setSettings(s => ({ ...s, membankPrompt: e.target.value }))} />
          <div className="muted-note">Intro text added above the file list when the memory bank is enabled. The file names and tool instructions are appended automatically.</div>
        </div>
      </Card>
      <Card title="Files" sub="Text and PDF files work best (.md, .txt, .json, .pdf, code, etc.). PDFs are read as extracted text. Up to 25 MB each."
        right={<button className="btn" onClick={() => pickRef.current?.click()}>Upload files</button>}>
        <input ref={pickRef} type="file" multiple hidden onChange={onPick} />
        <div className="muted-note">Drag the handle to reorder or move files between folders. Type a folder name to group files; clear it to leave a file ungrouped.</div>
        <datalist id="mb-folders">{[...new Set(files.map(f => f.folder).filter(Boolean))].map(fo => <option key={fo} value={fo} />)}</datalist>
        <div style={{ marginTop: 12 }}>
          {files.length === 0 ? <div className="muted-note">No files yet.</div> : groups.map(g => (
            <div key={g.folder || '__none'} className="mb-group">
              <div className="mb-group-head">{g.folder ? g.folder : 'Ungrouped'}</div>
              {g.files.map(f => {
                const editing = edit === f.name;
                return (
                  <div key={f.name} className={'mb-file-row' + (drag === f.name ? ' dragging' : '')}
                    onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(f)}>
                    <span className="mb-drag" draggable onDragStart={() => setDrag(f.name)} onDragEnd={() => setDrag(null)} title="Drag to reorder / move">⋮⋮</span>
                    <FileText style={{ width: 16, flexShrink: 0, opacity: 0.7 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editing ? (
                        <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveRename(f.name); if (e.key === 'Escape') { setEdit(null); setErr(''); } }}
                          style={{ width: '100%' }} />
                      ) : (
                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      )}
                      <div className="muted-note">{f.readable ? `${(f.lines || 0).toLocaleString()} lines · ${(f.size || 0).toLocaleString()} bytes` : `${(f.size || 0).toLocaleString()} bytes · not readable as text`}</div>
                      {editing && err && <div className="dz-err" style={{ marginTop: 4 }}>{err}</div>}
                    </div>
                    {editing ? (
                      <>
                        <button className="btn" style={{ flexShrink: 0 }} onClick={() => saveRename(f.name)}>Save</button>
                        <button className="btn ghost" style={{ flexShrink: 0 }} onClick={() => { setEdit(null); setErr(''); }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <input className="mb-folder-input" list="mb-folders" placeholder="folder" defaultValue={f.folder || ''}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v !== (f.folder || '')) setFolder(f.name, v); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
                        <button className="btn ghost" title="Rename" style={{ flexShrink: 0 }} onClick={() => { setEdit(f.name); setEditName(f.name); setErr(''); }}><Pencil style={{ width: 14 }} /></button>
                        <button className="btn danger" title="Remove" style={{ flexShrink: 0 }} onClick={() => remove(f.name)}><Trash style={{ width: 15 }} /></button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
      <AutosaveNote status={settingsSave} live />
    </>
  );
}
