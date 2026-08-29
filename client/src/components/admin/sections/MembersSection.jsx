import { useState } from 'react';
import { useAdmin } from '../store.jsx';
import { Block, Row, Input, Seg, Switch, Btn, Table, Badge, Empty, fmtMoney } from '../ui.jsx';
import { Trash } from '../../icons.jsx';
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

  return (
    <>
      <Block title={t('Registration')}>
        <Row label={t('Accept new sign-ups')}
          note={t('Off, the sign-in screen stops offering account creation and the server refuses registrations. Existing members keep working.')}>
          <Switch on={workspace.config.allowSignups !== false} label={t('Accept new sign-ups')}
            onToggle={() => workspace.setCfg('allowSignups', workspace.config.allowSignups === false)} />
        </Row>
      </Block>

      <Block title={t('Accounts')}
        sub={t('A blank cap falls back to the role default set in Quotas. Removing an account deletes everything it owns.')}
        actions={<>
          <div style={{ width: 220 }}>
            <Input value={q} placeholder={t('Filter by name or email')} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Seg value={role} label={t('Role filter')} onChange={setRoleFilter}
            options={[
              { value: 'all', label: t('All {n}', { n: members.length }) },
              { value: 'admins', label: t('Admins {n}', { n: admins }) },
              { value: 'members', label: t('Members {n}', { n: members.length - admins }) }
            ]} />
        </>}>
        {shown.length === 0
          ? <Empty title={t('No accounts match')}>{t('Clear the filter to see everyone who has signed in.')}</Empty>
          : (
            <Table head={[
              { label: t('Member') },
              { label: t('Email'), mono: true },
              { label: t('Spent this month'), num: true, fit: true },
              { label: t('Cap $/month') },
              { label: t('Role'), fit: true },
              { label: '', fit: true }
            ]}>
              {shown.map(u => {
                const draft = drafts[u.id];
                const value = draft !== undefined ? draft : (u.budget == null ? '' : u.budget);
                return (
                  <tr key={u.id}>
                    <td>
                      {u.displayName}
                      {u.isOwner && <> <Badge tone="on">{t('owner')}</Badge></>}
                      {u.twoFactor && <> <Badge>{t('2fa')}</Badge></>}
                      {u.id === user?.id && <> <Badge>{t('you')}</Badge></>}
                    </td>
                    <td className="mono dim">{u.email}</td>
                    <td className="num mono">{u.monthSpend > 0 ? fmtMoney(u.monthSpend) : <span className="dim">—</span>}</td>
                    <td className="fit" style={{ width: 120 }}>
                      <Input type="number" min="0" step="any" placeholder={t('default')} value={value}
                        onChange={(e) => setDrafts(d => ({ ...d, [u.id]: e.target.value }))}
                        onBlur={(e) => { setBudget(u.id, e.target.value); setDrafts(d => { const n = { ...d }; delete n[u.id]; return n; }); }} />
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
                      {!u.isOwner && u.id !== user?.id && (
                        <Btn kind="danger" size="sm" title={t('Remove member')} aria-label={t('Remove member')}
                          onClick={() => remove(u.id, u.email)}><Trash /></Btn>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
      </Block>
    </>
  );
}
