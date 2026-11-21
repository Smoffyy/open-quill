import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api.js';
import { notify } from '../../../lib/notify.js';
import { useAdmin } from '../store.jsx';
import { Card, Fields, Field, Input, Area, Btn, IconBtn, Acts, Table, Dialog, Note } from '../ui.jsx';
import { Plus, Trash, Pencil } from '../../ui/icons.jsx';
import { t, tk } from '../../../i18n.jsx';
import { Skel, SkelTable } from '../../ui/Skeleton.jsx';
import { can } from '../../../lib/permissions.js';
import { roleLabel } from '../../ui/roleLabel.jsx';
import PermissionPicker from '../people/PermissionPicker.jsx';

const BUILTIN_NOTES = {
  __proto__: null,
  owner: tk('Everything, including sign-in and security settings and making admins and owners. There can be several, and the last one cannot be removed.'),
  admin: tk('The whole admin panel, including publishing. Manages every account below Admin.'),
  user: tk('Everyday use: chats, projects, files and tools, within what the User role allows.'),
  pending: tk('Signed up but cannot use anything until someone approves the account.')
};

function RoleDialog({ role, registry, baseline, onSaved, onClose }) {
  const [draft, setDraft] = useState(() => ({
    name: role?.name || '', description: role?.description || '', rank: role?.rank ?? 50, permissions: role?.extras || []
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = new Set(baseline);

  async function save() {
    setError('');
    setBusy(true);
    const body = { ...draft, rank: Number(draft.rank), permissions: draft.permissions.filter(p => !locked.has(p)) };
    try {
      const d = role ? await api.patch('/api/admin/roles/' + role.id, body) : await api.post('/api/admin/roles', body);
      onSaved(d.roles);
      onClose();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <Dialog title={role ? role.name : t('New role')} size="wide" onClose={onClose}
      foot={<>
        <Btn onClick={onClose}>{t('Cancel')}</Btn>
        <Btn kind="primary" disabled={busy || !draft.name.trim()} onClick={save}>{busy ? t('Saving') : t('Save role')}</Btn>
      </>}>
      <Card title={t('Details')}>
        <Fields>
          <Field label={t('Name')}>
            <Input value={draft.name} onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))} />
          </Field>
          <Field label={t('Description')} optional>
            <Area rows={2} value={draft.description} onChange={(e) => setDraft(d => ({ ...d, description: e.target.value }))} />
          </Field>
          <Field label={t('Rank')} hint={t('Between 11 and 99. Someone with this role manages only accounts ranked lower, and admins manage everyone with this role.')}>
            <Input type="number" min="11" max="99" value={draft.rank} onChange={(e) => setDraft(d => ({ ...d, rank: e.target.value }))} />
          </Field>
        </Fields>
      </Card>
      <Note>{t('A custom role always includes everything the User role allows. Pick what it adds on top.')}</Note>
      <PermissionPicker registry={registry} value={draft.permissions} locked={locked} lockedNote={t('Included through the User role.')}
        onChange={(permissions) => setDraft(d => ({ ...d, permissions }))} />
      {error && <Note tone="bad">{error}</Note>}
    </Dialog>
  );
}

export default function RolesSection() {
  const { confirm, user } = useAdmin();
  const owner = !!user?.owner;
  const groupsAdmin = can(user, 'admin.groups');
  const [roles, setRoles] = useState(null);
  const [registry, setRegistry] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get('/api/admin/roles');
      setRoles(d.roles || []);
      setRegistry(d.permissions || []);
    } catch { setRoles([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const baseline = roles?.find(r => r.id === 'user')?.permissions || [];

  async function saveBaseline(permissions) {
    try { setRoles((await api.put('/api/admin/roles/user-baseline', { permissions })).roles); }
    catch (e) { notify(e.message, { kind: 'error' }); }
  }

  function remove(role) {
    confirm({
      title: t('Delete role'),
      message: t('Everyone with “{name}” becomes a User. Their accounts and chats are not touched.', { name: role.name }),
      confirm: t('Delete role'),
      onConfirm: async () => {
        try { setRoles((await api.del('/api/admin/roles/' + role.id)).roles); }
        catch (e) { notify(e.message, { kind: 'error' }); }
      }
    });
  }

  const adminCount = (r) => r.permissions.filter(p => p.startsWith('admin.')).length;

  return (
    <>
      <Card title={t('Roles')} flush
        sub={t('A role sets someone’s baseline and how far up they can manage. Groups add everyday permissions on top; admin permissions only come from roles.')}
        actions={owner && <Btn kind="primary" size="sm" onClick={() => setEditing({})}><Plus /> {t('New role')}</Btn>}>
        {roles == null ? <Skel when><SkelTable cols={4} rows={4} /></Skel> : (
          <Table head={[
            { label: t('Role'), fit: true },
            { label: t('Rank'), num: true, fit: true },
            { label: t('Admin permissions'), num: true, fit: true },
            { label: t('What it is for') },
            { label: '', fit: true }
          ]}>
            {roles.map(r => (
              <tr key={r.id}>
                <td className="fit">{roleLabel(r.id, r.name)}</td>
                <td className="num mono">{r.rank}</td>
                <td className="num mono">{adminCount(r)}</td>
                <td className="dim wrap">{r.builtin ? t(BUILTIN_NOTES[r.id]) : (r.description || t('A custom role made by an owner.'))}</td>
                <td className="acts">
                  <Acts end>
                    {owner && !r.builtin && <IconBtn label={t('Edit')} onClick={() => setEditing(r)}><Pencil /></IconBtn>}
                    {owner && !r.builtin && <IconBtn kind="danger" label={t('Delete role')} onClick={() => remove(r)}><Trash /></IconBtn>}
                  </Acts>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {roles && (
        <>
          <Note>{groupsAdmin
            ? t('What every approved account can do, before groups add more. Changes apply on the next request.')
            : t('What every approved account can do, before groups add more. Only someone who manages groups can change it.')}</Note>
          <PermissionPicker registry={registry} tier="member" value={baseline} disabled={!groupsAdmin} onChange={saveBaseline} />
        </>
      )}

      {editing && (
        <RoleDialog role={editing.id ? editing : null} registry={registry} baseline={baseline}
          onSaved={setRoles} onClose={() => setEditing(null)} />
      )}
    </>
  );
}