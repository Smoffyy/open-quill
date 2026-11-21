import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api.js';
import { Card, KV, Table, Badge, Select, IconBtn, Acts, Dialog, Note, Btn } from '../ui.jsx';
import { Trash } from '../../ui/icons.jsx';
import { t } from '../../../i18n.jsx';
import { Skel, SkelRows } from '../../ui/Skeleton.jsx';
import { roleLabel } from '../../ui/roleLabel.jsx';
import { PERMISSION_CATEGORIES } from '../../../lib/permissionlabels.js';
import { permissionLabel } from './PermissionPicker.jsx';
import { sourceBadge } from './sources.js';

const chain = (path) => path.map(p => p.name).join(' ⊂ ');

function Source({ source, roleName }) {
  if (source.type === 'role') return <Badge>{t('{role} role', { role: roleName(source.role) })}</Badge>;
  return <Badge tone="on">{chain(source.path)}</Badge>;
}

export default function AccessDialog({ person, roles, registry, canEditGroups, onClose }) {
  const [access, setAccess] = useState(null);
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState('');
  const custom = roles.filter(r => !r.builtin);
  const roleName = (id) => roleLabel(id, custom.find(r => r.id === id)?.name);

  const load = useCallback(async () => {
    try { setAccess(await api.get(`/api/admin/users/${person.id}/access`)); }
    catch (e) { setError(e.message); }
  }, [person.id]);

  useEffect(() => {
    load();
    if (canEditGroups) api.get('/api/admin/groups').then(d => setGroups(d.groups || [])).catch(() => {});
  }, [load, canEditGroups]);

  async function membership(groupId, change) {
    setError('');
    try {
      await api.put(`/api/admin/groups/${groupId}/members`, { [change]: [person.id] });
      await load();
    } catch (e) { setError(e.message); }
  }

  const direct = new Set(access?.direct || []);
  const joinable = groups.filter(g => g.source === 'local' && !direct.has(g.id));
  const categoryOf = new Map(registry.map(p => [p.id, p.category]));

  return (
    <Dialog title={t('Access for {who}', { who: person.displayName })} size="wide" onClose={onClose} foot={<Btn onClick={onClose}>{t('Close')}</Btn>}>
      {!access ? <Skel when><SkelRows count={6} /></Skel> : (
        <>
          <Card title={t('Summary')}>
            <KV items={[
              [t('Email'), person.email, true],
              [t('Role'), roleName(access.role)],
              [t('Can use the app'), access.active ? t('Yes') : t('No, the account is pending or disabled')]
            ]} />
          </Card>

          <Card title={t('Groups')} flush sub={t('Direct groups, and the groups they sit inside. Everything they grant applies.')}>
            {access.groups.length === 0 ? <div className="cp-hint">{t('Not in any group.')}</div> : (
              <Table head={[{ label: t('Group') }, { label: t('How'), fit: true }, { label: '', fit: true }]}>
                {access.groups.map(g => (
                  <tr key={g.id}>
                    <td>{g.name} {sourceBadge(g.source) && <Badge>{sourceBadge(g.source)}</Badge>}</td>
                    <td className="fit dim">{g.depth === 0 ? t('Direct member') : t('Through {path}', { path: chain(g.path) })}</td>
                    <td className="acts">
                      <Acts end>
                        {canEditGroups && g.depth === 0 && g.source === 'local' && (
                          <IconBtn kind="danger" label={t('Remove from group')} onClick={() => membership(g.id, 'remove')}><Trash /></IconBtn>
                        )}
                      </Acts>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          {canEditGroups && joinable.length > 0 && (
            <Select value="" label={t('Add to a group')} onChange={(v) => { if (v) membership(v, 'add'); }}
              options={[{ value: '', label: t('Add to a group') }, ...joinable.map(g => ({ value: g.id, label: g.name }))]} />
          )}

          {PERMISSION_CATEGORIES.map(cat => {
            const rows = access.permissions.filter(p => categoryOf.get(p.id) === cat.id);
            if (!rows.length) return null;
            return (
              <Card key={cat.id} title={t(cat.label)} flush>
                <Table head={[{ label: t('Permission') }, { label: t('Granted by') }]}>
                  {rows.map(p => (
                    <tr key={p.id}>
                      <td>{permissionLabel(p.id)}</td>
                      <td><span className="cp-badges">{p.sources.map((s, i) => <Source key={i} source={s} roleName={roleName} />)}</span></td>
                    </tr>
                  ))}
                </Table>
              </Card>
            );
          })}
          {access.permissions.length === 0 && <div className="cp-hint">{t('No permissions.')}</div>}
          {error && <Note tone="bad">{error}</Note>}
        </>
      )}
    </Dialog>
  );
}