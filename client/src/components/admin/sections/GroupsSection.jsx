import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api.js';
import { notify } from '../../../lib/notify.js';
import { useAdmin } from '../store.jsx';
import { Card, Fields, Field, Input, Area, Btn, IconBtn, Acts, Table, Badge, Empty, Dialog, Note } from '../ui.jsx';
import { Plus, Trash, Pencil, Users, Up, Down } from '../../ui/icons.jsx';
import { t, tp } from '../../../i18n.jsx';
import { Skel, SkelTable } from '../../ui/Skeleton.jsx';
import { can } from '../../../lib/permissions.js';
import GroupDialog from '../people/GroupDialog.jsx';

export default function GroupsSection() {
  const { confirm, user } = useAdmin();
  const editable = can(user, 'admin.groups');
  const [groups, setGroups] = useState(null);
  const [registry, setRegistry] = useState([]);
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(null);
  const [making, setMaking] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setGroups((await api.get('/api/admin/groups')).groups || []); }
    catch { setGroups([]); }
  }, []);

  useEffect(() => {
    load();
    api.get('/api/admin/roles').then(d => setRegistry(d.permissions || [])).catch(() => {});
    api.get('/api/models').then(list => setModels(Array.isArray(list) ? list : [])).catch(() => {});
  }, [load]);

  async function create() {
    setError('');
    try {
      const d = await api.post('/api/admin/groups', making);
      setMaking(null);
      await load();
      setOpen(d.group.id);
    } catch (e) { setError(e.message); }
  }

  async function move(index, by) {
    const ids = groups.map(g => g.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved);
    setGroups(list => ids.map(id => list.find(g => g.id === id)));
    try { await api.put('/api/admin/groups/order', { ids }); }
    catch { notify(t('The order could not be saved.'), { kind: 'error' }); load(); }
  }

  function remove(g) {
    confirm({
      title: t('Delete group'),
      message: t('Members of “{name}” lose what it grants straight away. Their accounts and chats are not touched.', { name: g.name }),
      confirm: t('Delete group'),
      onConfirm: async () => {
        try { await api.del('/api/admin/groups/' + g.id); await load(); }
        catch (e) { notify(e.message, { kind: 'error' }); }
      }
    });
  }

  const nameOf = (id) => groups?.find(g => g.id === id)?.name || '';
  const modelName = (id) => models.find(m => m.id === id)?.displayName || '';

  return (
    <>
      <Card title={t('Groups')} flush
        sub={t('A group adds permissions and a default model to everyone in it, including members of the groups placed inside it. Higher in the list wins when two groups pick different default models.')}
        actions={editable && <Btn kind="primary" size="sm" onClick={() => { setMaking({ name: '', description: '' }); setError(''); }}><Plus /> {t('New group')}</Btn>}>
        {groups == null
          ? <Skel when><SkelTable cols={5} rows={4} /></Skel>
          : groups.length === 0
          ? <Empty icon={Users} title={t('No groups yet')}>{t('Make a group for a team or a project, then give it the permissions and models its members need.')}</Empty>
          : (
            <Table head={[
              { label: t('Group') },
              { label: t('Members'), num: true, fit: true },
              { label: t('Inside'), fit: true },
              { label: t('Grants'), num: true, fit: true },
              { label: t('Default model') },
              { label: '', fit: true }
            ]}>
              {groups.map((g, i) => (
                <tr key={g.id}>
                  <td>
                    <span className="cp-inline">
                      {g.name}
                      <span className="cp-badges">
                        {g.source !== 'local' && <Badge>{g.source}</Badge>}
                        {g.groups > 0 && <Badge>{tp(g.groups, '{n} group inside', '{n} groups inside')}</Badge>}
                      </span>
                    </span>
                  </td>
                  <td className="num mono">{g.members}</td>
                  <td className="fit dim">{g.parents.map(nameOf).filter(Boolean).join(', ')}</td>
                  <td className="num mono">{g.permissions.length}</td>
                  <td className="dim">{g.defaultModelId ? modelName(g.defaultModelId) || g.defaultModelId : ''}</td>
                  <td className="acts">
                    <Acts end>
                      {editable && i > 0 && <IconBtn label={t('Move up')} onClick={() => move(i, -1)}><Up /></IconBtn>}
                      {editable && i < groups.length - 1 && <IconBtn label={t('Move down')} onClick={() => move(i, 1)}><Down /></IconBtn>}
                      <IconBtn label={editable ? t('Edit') : t('Open')} onClick={() => setOpen(g.id)}><Pencil /></IconBtn>
                      {editable && <IconBtn kind="danger" label={t('Delete group')} onClick={() => remove(g)}><Trash /></IconBtn>}
                    </Acts>
                  </td>
                </tr>
              ))}
            </Table>
          )}
      </Card>

      {making && (
        <Dialog title={t('New group')} size="narrow" onClose={() => setMaking(null)}
          foot={<>
            <Btn onClick={() => setMaking(null)}>{t('Cancel')}</Btn>
            <Btn kind="primary" disabled={!making.name.trim()} onClick={create}>{t('Create group')}</Btn>
          </>}>
          <Fields>
            <Field label={t('Name')}>
              <Input value={making.name} onChange={(e) => setMaking(m => ({ ...m, name: e.target.value }))} />
            </Field>
            <Field label={t('Description')} optional>
              <Area rows={2} value={making.description} onChange={(e) => setMaking(m => ({ ...m, description: e.target.value }))} />
            </Field>
          </Fields>
          {error && <Note tone="bad">{error}</Note>}
        </Dialog>
      )}

      {open && groups && (
        <GroupDialog id={open} groups={groups} registry={registry} models={models} editable={editable}
          onChanged={load} onClose={() => setOpen(null)} />
      )}
    </>
  );
}