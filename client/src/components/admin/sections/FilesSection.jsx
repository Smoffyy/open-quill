import { useState, useEffect, useRef } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Card, Rows, ToggleRow, Field, Input, Area, Btn, IconBtn, Acts, Table, Empty, fmtInt, fmtBytes } from '../ui.jsx';
import { Trash, Pencil, Check, X, FileText, Upload } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

const MAX_FILE_MB = 25;

export default function FilesSection() {
  const { workspace } = useAdmin();
  const { settings, set } = workspace;
  const [files, setFiles] = useState([]);
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(null);
  const picker = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const d = await api.get('/api/admin/membank'); if (alive) setFiles(d.files || []); } catch {}
    })();
    return () => { alive = false; };
  }, []);

  async function upload(e) {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    setError('');
    try { const r = await api.uploadMembank(list); setFiles(r.files || []); }
    catch (err) { setError(err?.message || t('The upload failed.')); }
  }

  async function commitRename(old) {
    const next = name.trim();
    setError('');
    if (!next || next === old) { setRenaming(null); return; }
    try {
      const r = await api.patch('/api/admin/membank/' + encodeURIComponent(old), { name: next });
      setFiles(r.files || []);
      setRenaming(null);
    } catch (e) { setError(e?.message || t('That name is not available.')); }
  }

  async function setFolder(file, folder) {
    setFiles(fs => fs.map(f => (f.name === file ? { ...f, folder } : f)));
    try { const r = await api.patch('/api/admin/membank/' + encodeURIComponent(file), { folder }); setFiles(r.files || []); }
    catch { try { const d = await api.get('/api/admin/membank'); setFiles(d.files || []); } catch {} }
  }

  async function reorder(target) {
    if (!dragging || dragging === target.name) { setDragging(null); return; }
    const arr = files.slice();
    const from = arr.findIndex(f => f.name === dragging);
    const to = arr.findIndex(f => f.name === target.name);
    setDragging(null);
    if (from < 0 || to < 0) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, { ...moved, folder: target.folder || '' });
    setFiles(arr);
    try {
      const r = await api.put('/api/admin/membank/order', { items: arr.map(f => ({ name: f.name, folder: f.folder || '' })) });
      if (r.files) setFiles(r.files);
    } catch { try { const d = await api.get('/api/admin/membank'); setFiles(d.files || []); } catch {} }
  }

  async function remove(fileName) {
    try { const r = await api.del('/api/admin/membank/' + encodeURIComponent(fileName)); setFiles(r.files || []); } catch {}
  }

  const folders = [...new Set(files.map(f => f.folder).filter(Boolean))];

  return (
    <>
      <Card title={t('Availability')}>
        <Rows>
          <ToggleRow label={t('Expose the file set')} on={!!settings.membankEnabled}
            onToggle={() => set('membankEnabled', !settings.membankEnabled)}
            note={t('Adds a listing of these files to every system prompt, plus the mb_view and mb_search tools for reading them.')} />
          <ToggleRow label={t('Hide reads from members')} on={!!settings.membankHideTools}
            onToggle={() => set('membankHideTools', !settings.membankHideTools)}
            note={t('The model still reads files, but the tool steps are not shown in the reply.')} />
        </Rows>
        <Field label={t('Preamble')}
          hint={t('Placed above the file listing in the system prompt. The names and tool instructions are appended for you.')}>
          <Area rows={5} value={settings.membankPrompt ?? ''} onChange={(e) => set('membankPrompt', e.target.value)} />
        </Field>
      </Card>

      <Card title={t('Files')} flush
        sub={t('Text and PDF read best: markdown, plain text, JSON, source, and PDFs parsed to text. Up to {n} MB each. Drag a row onto another to reorder or move it between folders.', { n: MAX_FILE_MB })}
        actions={<Btn size="sm" onClick={() => picker.current?.click()}><Upload /> {t('Upload')}</Btn>}
        foot={error ? <span className="cp-err">{error}</span> : null}>
        <input ref={picker} type="file" multiple hidden onChange={upload} />
        <datalist id="cp-folders">{folders.map(f => <option key={f} value={f} />)}</datalist>

        {files.length === 0
          ? <Empty icon={FileText} title={t('No files')}>{t('Anything uploaded here is readable by every model on demand, without being pasted into a chat.')}</Empty>
          : (
            <Table head={[
              { label: t('Name') },
              { label: t('Folder'), width: '150px' },
              { label: t('Lines'), num: true, fit: true },
              { label: t('Size'), num: true, fit: true },
              { label: '', fit: true }
            ]}>
              {files.map(f => (
                <tr key={f.name} draggable={renaming !== f.name}
                  className={'cp-row-drag' + (dragging === f.name ? ' dragging' : '')}
                  onDragStart={() => setDragging(f.name)} onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => e.preventDefault()} onDrop={() => reorder(f)}>
                  <td>
                    {renaming === f.name
                      ? <Input mono autoFocus value={name} aria-label={t('Name')}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(f.name);
                          if (e.key === 'Escape') { setRenaming(null); setError(''); }
                        }} />
                      : <span className="mono">{f.name}</span>}
                  </td>
                  <td>
                    <Input list="cp-folders" placeholder={t('none')} defaultValue={f.folder || ''} aria-label={t('Folder')}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (f.folder || '')) setFolder(f.name, v); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
                  </td>
                  <td className="num mono">{f.readable ? fmtInt(f.lines) : <span className="dim">{t('binary')}</span>}</td>
                  <td className="num mono dim">{fmtBytes(f.size)}</td>
                  <td className="acts">
                    <Acts end>
                      {renaming === f.name ? (
                        <>
                          <IconBtn label={t('Save')} onClick={() => commitRename(f.name)}><Check /></IconBtn>
                          <IconBtn label={t('Cancel')} onClick={() => { setRenaming(null); setError(''); }}><X /></IconBtn>
                        </>
                      ) : (
                        <>
                          <IconBtn label={t('Rename')} onClick={() => { setRenaming(f.name); setName(f.name); setError(''); }}><Pencil /></IconBtn>
                          <IconBtn kind="danger" label={t('Delete')} onClick={() => remove(f.name)}><Trash /></IconBtn>
                        </>
                      )}
                    </Acts>
                  </td>
                </tr>
              ))}
            </Table>
          )}
      </Card>
    </>
  );
}
