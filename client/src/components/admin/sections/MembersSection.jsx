import { useState } from 'react';
import { useAdmin } from '../store.jsx';
import { Card, Rows, ToggleRow, Input, Seg, IconBtn, Acts, Table, Badge, Empty, fmtMoney } from '../ui.jsx';
import { Trash, Users } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

export default function MembersSection() {
  const { members: M, workspace, user } = useAdmin();
  const { members, setRole, setBudget, remove } = M;
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
        {shown.length === 0
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
                        aria-label={t('Cap $/month')}
                        onChange={(e) => setDrafts(d => ({ ...d, [u.id]: e.target.value }))}
                        onBlur={(e) => commitBudget(u.id, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
                    </td>
                    <td className="fit">
                      {u.isOwner
                        ? <span className="dim">{t('owner')}</span>
                        : (
                          <Seg value={u.isAdmin ? 'admin' : 'member'} label={t('Role')}
                            onChange={(v) => setRole(u.id, v === 'admin')}
                            options={[{ value: 'member', label: t('member') }, { value: 'admin', label: t('admin') }]} />
                        )}
                    </td>
                    <td className="acts">
                      <Acts end>
                        {!u.isOwner && u.id !== user?.id && (
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
