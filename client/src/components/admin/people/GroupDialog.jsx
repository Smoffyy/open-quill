import { useState, useEffect } from 'react';
import { api } from '../../../lib/api.js';
import { notify } from '../../../lib/notify.js';
import { Card, Fields, Field, Input, Area, Select, Btn, IconBtn, Acts, Table, Badge, Dialog, Note, Empty } from '../ui.jsx';
import { Trash, Users, Plus } from '../../ui/icons.jsx';
import { t } from '../../../i18n.jsx';
import { Skel, SkelRows } from '../../ui/Skeleton.jsx';
import PermissionPicker from './PermissionPicker.jsx';

const SEARCH_DELAY_MS = 250;

function PeoplePicker({ exclude, onAdd }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  useEffect(() => {
    const needle = q.trim();
    if (!needle) { setHits([]); return undefined; }
    const timer = setTimeout(() => {
      api.get('/api/admin/people?q=' + encodeURIComponent(needle)).then(d => setHits(d.people || [])).catch(() => setHits([]));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q]);
  const shown = hits.filter(p => !exclude.has(p.id));
  return (
    <>
      <Input type="search" value={q} placeholder={t('Find people by name or email')} aria-label={t('Find people by name or email')}
        onChange={(e) => setQ(e.target.value)} />
      {shown.length > 0 && (
        <Table head={[{ label: t('Name') }, { label: t('Email'), mono: true }, { label: '', fit: true }]}>
          {shown.map(p => (
            <tr key={p.id}>
              <td>{p.displayName}</td>
              <td className="mono dim">{p.email}</td>
              <td className="acts"><Acts end><Btn size="sm" onClick={() => onAdd(p.id)}><Plus /> {t('Add')}</Btn></Acts></td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

export default function GroupDialog({ id, groups, registry, models, editable, onChanged, onClose }) {
  const [group, setGroup] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/api/admin/groups/' + id).then(d => {
      if (!alive) return;
      setGroup(d.group);
      setDraft({ name: d.group.name, description: d.group.description, permissions: d.group.permissions, defaultModelId: d.group.defaultModelId || '' });
    }).catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [id]);

  const synced = group && group.source !== 'local';

  async function run(request) {
    setError('');
    try {
      const d = await request();
      if (d?.group) setGroup(d.group);
      onChanged();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }

  async function save() {
    setBusy(true);
    const ok = await run(() => api.patch('/api/admin/groups/' + id, { ...draft, defaultModelId: draft.defaultModelId || null }));
    setBusy(false);
    if (ok) { notify(t('Group saved'), { kind: 'success' }); onClose(); }
  }

  const members = new Set((group?.users || []).map(u => u.id));
  const inside = new Set((group?.childGroups || []).map(g => g.id));
  const nestable = groups.filter(g => g.id !== id && !inside.has(g.id));

  return (
    <Dialog title={group ? group.name : t('Group')} size="wide" onClose={onClose}
      foot={editable && draft ? <>
        <Btn onClick={onClose}>{t('Cancel')}</Btn>
        <Btn kind="primary" disabled={busy || !draft.name.trim()} onClick={save}>{busy ? t('Saving') : t('Save group')}</Btn>
      </> : <Btn onClick={onClose}>{t('Close')}</Btn>}>
      {!group || !draft ? <Skel when><SkelRows count={6} /></Skel> : (
        <>
          {synced && <Note>{t('This group is kept in sync by {source}. Its name and members come from there, but you can still choose what it grants.', { source: group.source })}</Note>}
          <Card title={t('Details')}>
            <Fields>
              <Field label={t('Name')}>
                <Input value={draft.name} disabled={!editable || synced} onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))} />
              </Field>
              <Field label={t('Description')} optional>
                <Area rows={2} value={draft.description} disabled={!editable} onChange={(e) => setDraft(d => ({ ...d, description: e.target.value }))} />
              </Field>
              <Field label={t('Default model for new chats')} hint={t('Used when a member has not picked their own. When groups disagree, the group higher in the list wins.')}>
                <Select value={draft.defaultModelId} label={t('Default model for new chats')} disabled={!editable}
                  onChange={(v) => setDraft(d => ({ ...d, defaultModelId: v }))}
                  options={[{ value: '', label: t('No preference') }, ...models.map(m => ({ value: m.id, label: m.displayName || m.id }))]} />
              </Field>
            </Fields>
          </Card>

          <Card title={t('People')} flush sub={t('Direct members. Members of the groups inside this one belong to it too. Adding or removing people applies at once.')}>
            {group.users.length === 0
              ? <Empty icon={Users} title={t('Nobody yet')}>{t('Add people below, or put another group inside this one.')}</Empty>
              : (
                <Table head={[{ label: t('Name') }, { label: t('Email'), mono: true }, { label: '', fit: true }]}>
                  {group.users.map(u => (
                    <tr key={u.id}>
                      <td>{u.displayName} {u.status === 'disabled' && <Badge tone="bad">{t('disabled')}</Badge>}</td>
                      <td className="mono dim">{u.email}</td>
                      <td className="acts">
                        <Acts end>
                          {editable && !synced && (
                            <IconBtn kind="danger" label={t('Remove from group')}
                              onClick={() => run(() => api.put(`/api/admin/groups/${id}/members`, { remove: [u.id] }))}><Trash /></IconBtn>
                          )}
                        </Acts>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
          </Card>
          {editable && !synced && <PeoplePicker exclude={members} onAdd={(uid) => run(() => api.put(`/api/admin/groups/${id}/members`, { add: [uid] }))} />}

          <Card title={t('Groups inside this one')} flush sub={t('Their members get everything this group grants.')}>
            {group.childGroups.length === 0
              ? <div className="cp-hint">{t('None.')}</div>
              : (
                <Table head={[{ label: t('Group') }, { label: '', fit: true }]}>
                  {group.childGroups.map(g => (
                    <tr key={g.id}>
                      <td>{g.name}</td>
                      <td className="acts">
                        <Acts end>
                          {editable && (
                            <IconBtn kind="danger" label={t('Take out of this group')}
                              onClick={() => run(() => api.del(`/api/admin/groups/${id}/groups/${g.id}`))}><Trash /></IconBtn>
                          )}
                        </Acts>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
          </Card>
          {editable && !synced && nestable.length > 0 && (
            <Select value="" label={t('Put a group inside this one')}
              onChange={(v) => { if (v) run(() => api.put(`/api/admin/groups/${id}/groups/${v}`)); }}
              options={[{ value: '', label: t('Put a group inside this one') }, ...nestable.map(g => ({ value: g.id, label: g.name }))]} />
          )}
          {group.parentGroups.length > 0 && (
            <Card title={t('This group is inside')}>
              <div className="cp-badges">{group.parentGroups.map(g => <Badge key={g.id}>{g.name}</Badge>)}</div>
            </Card>
          )}
          <Note>{t('Everything below adds to what the User role already allows. Admin permissions only come from roles.')}</Note>
          <PermissionPicker registry={registry} tier="member" value={draft.permissions} disabled={!editable}
            onChange={(permissions) => setDraft(d => ({ ...d, permissions }))} />
          {error && <Note tone="bad">{error}</Note>}
        </>
      )}
    </Dialog>
  );
}