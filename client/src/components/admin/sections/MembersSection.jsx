import { useState } from 'react';
import { useAdmin } from '../store.jsx';
import { Card, Rows, ToggleRow, Input, Seg, IconBtn, Acts, Table, Badge, Empty, KV, fmtMoney } from '../ui.jsx';
import { Trash, Users } from '../../ui/icons.jsx';
import { t, tk } from '../../../i18n.jsx';
import { Skel, SkelTable } from '../../ui/Skeleton.jsx';
import { ASSIGNABLE, canManage, canAssign } from '../../../lib/roles.js';

const ROLE_LABELS = { __proto__: null, member: tk('member'), editor: tk('editor'), publisher: tk('publisher'), owner: tk('owner') };

export default function MembersSection() {
  const { members: M, workspace, user } = useAdmin();
  const { members, ready, setRole, setBudget, remove } = M;
  const [q, setQ] = useState('');
  const [role, setRoleFilter] = useState('all');
  const [drafts, setDrafts] = useState({});

  const admins = members.filter(u => u.isAdmin || u.isOwner).length;
  const needle = q.trim().toLowerCase();
  const shown = members.filter(u => {
    const isAdmin = !!(u.isAdmin || u.isOwner);
    if (role === 'admins' && !isAdmin) return false;
    if (role === 'members' && isAdmin) return false;
    if (!needle) return true;
    return (u.displayName || '').toLowerCase().includes(needle) || (u.email || '').toLowerCase().includes(needle);
  });

  function commitBudget(id, value) {
    setBudget(id, value);
    setDrafts(d => { const n = { ...d }; delete n[id]; return n; });
  }

  return (
    <>
      <Card title={t('Registration')}>
        <Rows>
          <ToggleRow label={t('Accept new sign-ups')} on={workspace.config.allowSignups !== false}
            onToggle={() => workspace.setCfg('allowSignups', workspace.config.allowSignups === false)}
            note={t('Off, the sign-in screen stops offering account creation and the server refuses registrations. Existing members keep working.')} />
        </Rows>
      </Card>

      <Card title={t('Roles')} sub={t('Everyone can manage only the accounts below their own role, and grant only roles below it.')}>
        <KV items={[
          [t('Editor'), t('Uses the admin panel and stages changes. Can discard only their own changes.')],
          [t('Publisher'), t('Everything an editor can do, plus publishing releases, restoring old versions and discarding anyone’s changes.')],
          [t('Owner'), t('Everything, including making and removing publishers. There is exactly one owner.')]
        ]} />
      </Card>

      <div className="cp-toolbar">
        <div className="cp-toolbar-find">
          <Input value={q} type="search" placeholder={t('Filter by name or email')} aria-label={t('Filter by name or email')}
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <Seg value={role} label={t('Role filter')} onChange={setRoleFilter}
          options={[
            { value: 'all', label: t('All'), badge: members.length },
            { value: 'admins', label: t('Admins'), badge: admins },
            { value: 'members', label: t('Members'), badge: members.length - admins }
          ]} />
      </div>

      <Card title={t('Accounts')} flush
        sub={t('A blank cap falls back to the role default set in Quotas. Removing an account deletes everything it owns.')}>
        {!ready
          ? <Skel when><SkelTable cols={4} rows={6} /></Skel>
          : shown.length === 0
          ? <Empty icon={Users} title={t('No accounts match')}>{t('Clear the filter to see everyone who has signed in.')}</Empty>
          : (
            <Table head={[
              { label: t('Member') },
              { label: t('Email'), mono: true },
              { label: t('Spent this month'), num: true, fit: true },
              { label: t('Cap $/month'), width: '140px' },
              { label: t('Role'), fit: true },
              { label: '', fit: true }
            ]}>
              {shown.map(u => {
                const draft = drafts[u.id];
                const manage = canManage(user?.role, u.role);
                const value = draft !== undefined ? draft : (u.budget == null ? '' : u.budget);
                return (
                  <tr key={u.id}>
                    <td>
                      <span className="cp-inline">
                        {u.displayName}
                        <span className="cp-badges">
                          {u.isOwner && <Badge tone="on">{t('owner')}</Badge>}
                          {u.twoFactor && <Badge>{t('2fa')}</Badge>}
                          {u.id === user?.id && <Badge>{t('you')}</Badge>}
                        </span>
                      </span>
                    </td>
                    <td className="mono dim">{u.email}</td>
                    <td className="num mono">{u.monthSpend > 0 ? fmtMoney(u.monthSpend) : <span className="dim">—</span>}</td>
                    <td>
                      <Input type="number" min="0" step="any" placeholder={t('default')} value={value}
                        aria-label={t('Cap $/month')} disabled={!manage && u.id !== user?.id}
                        onChange={(e) => setDrafts(d => ({ ...d, [u.id]: e.target.value }))}
                        onBlur={(e) => commitBudget(u.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
                    </td>
                    <td className="fit">
                      {manage
                        ? (
                          <Seg value={u.role} label={t('Role')}
                            onChange={(v) => { if (v !== u.role && canAssign(user?.role, v)) setRole(u.id, v); }}
                            options={ASSIGNABLE.filter(r => canAssign(user?.role, r) || r === u.role).map(r => ({ value: r, label: t(ROLE_LABELS[r]) }))} />
                        )
                        : <span className="dim">{t(ROLE_LABELS[u.role] || ROLE_LABELS.member)}</span>}
                    </td>
                    <td className="acts">
                      <Acts end>
                        {manage && u.id !== user?.id && (
                          <IconBtn kind="danger" label={t('Remove member')} onClick={() => remove(u.id, u.email)}><Trash /></IconBtn>
                        )}
                      </Acts>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
      </Card>
    </>
  );
}