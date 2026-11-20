import { useState, useEffect } from 'react';
import { useAdmin } from '../store.jsx';
import { Card, Rows, Row, Input, Area, Seg, Select, Btn, IconBtn, Acts, Table, Badge, Empty, KV, Note, fmtMoney, fmtAgo } from '../ui.jsx';
import { Trash, Users, Logout, Alert, Eye, Shield } from '../../ui/icons.jsx';
import { t, tk, tp } from '../../../i18n.jsx';
import { Skel, SkelTable } from '../../ui/Skeleton.jsx';
import { roleLabel } from '../../ui/roleLabel.jsx';
import { USERS_PAGE } from '../state/useUsers.js';
import { can } from '../../../lib/permissions.js';
import AccessDialog from '../people/AccessDialog.jsx';

const SEARCH_DELAY_MS = 250;
const SOURCE_BADGE = { __proto__: null, scim: tk('provisioned'), ldap: tk('directory'), header: tk('proxy') };

const POLICIES = [
  { value: 'open', label: tk('Open'), note: tk('Anyone who can reach this server can create an account and start right away.') },
  { value: 'approval', label: tk('Approval'), note: tk('Anyone can create an account, but it waits as Pending until someone who manages users approves it.') },
  { value: 'closed', label: tk('Closed'), note: tk('Nobody can create an account. Existing accounts keep working.') }
];

const MFA_POLICIES = [
  { value: 'optional', label: tk('Optional'), note: tk('Everyone can choose whether to use two-factor.') },
  { value: 'admins', label: tk('Admins'), note: tk('Anyone with an admin permission must set up two-factor before using the app.') },
  { value: 'everyone', label: tk('Everyone'), note: tk('Every account must set up two-factor before using the app.') }
];

const VIEWS = [
  { value: 'all', label: tk('All'), filter: { role: '', status: '' } },
  { value: 'pending', label: tk('Pending'), filter: { role: 'pending', status: '' } },
  { value: 'disabled', label: tk('Disabled'), filter: { role: '', status: 'disabled' } }
];

function TwoFactorPolicy({ mfa, save }) {
  if (!mfa) return null;
  const policy = MFA_POLICIES.find(p => p.value === mfa.policy) || MFA_POLICIES[0];
  return (
    <Card title={t('Two-factor authentication')} sub={mfa.editable ? null : t('Only an owner can change who must use two-factor.')}>
      <Rows>
        <Row label={t('Required for')} note={t(policy.note)}>
          {mfa.editable
            ? <Seg value={policy.value} label={t('Required for')} onChange={save}
              options={MFA_POLICIES.map(p => ({ value: p.value, label: t(p.label) }))} />
            : <span className="dim">{t(policy.label)}</span>}
        </Row>
        <Row label={t('Coverage')} note={mfa.owing ? tp(mfa.owing, '{n} account has to set it up before it can continue.', '{n} accounts have to set it up before they can continue.') : null}>
          <span className="dim">{t('{n} of {total} accounts', { n: mfa.enrolled, total: mfa.total })}</span>
        </Row>
      </Rows>
    </Card>
  );
}

function Registration({ signup, save }) {
  const [domains, setDomains] = useState('');
  useEffect(() => { setDomains((signup?.domains || []).join('\n')); }, [signup?.domains]);
  if (!signup) return null;
  const policy = POLICIES.find(p => p.value === signup.policy) || POLICIES[0];
  return (
    <Card title={t('Registration')} sub={signup.editable ? null : t('Only an owner can change who may sign up.')}>
      <Rows>
        <Row label={t('New accounts')} note={t(policy.note)}>
          {signup.editable
            ? <Seg value={policy.value} label={t('New accounts')} onChange={(v) => save({ policy: v })}
              options={POLICIES.map(p => ({ value: p.value, label: t(p.label) }))} />
            : <span className="dim">{t(policy.label)}</span>}
        </Row>
        <Row label={t('Allowed email domains')} note={t('Leave empty to accept any domain. One per line, for example example.com.')} wide>
          <Area mono rows={3} value={domains} disabled={!signup.editable} aria-label={t('Allowed email domains')}
            onChange={(e) => setDomains(e.target.value)}
            onBlur={() => { if (signup.editable) save({ domains: domains.split(/\s+/).filter(Boolean) }); }} />
        </Row>
      </Rows>
    </Card>
  );
}

function UserRow({ u, me, roleName, order, M, onAccess }) {
  const [cap, setCap] = useState(null);
  const pending = u.role === 'pending';
  const disabled = u.status === 'disabled';
  const value = cap !== null ? cap : (u.budget == null ? '' : u.budget);
  const commitCap = (v) => { M.setBudget(u.id, v); setCap(null); };
  return (
    <tr>
      <td>
        <span className="cp-inline">
          {u.displayName}
          <span className="cp-badges">
            {pending && <Badge tone="warn">{t('pending')}</Badge>}
            {disabled && <Badge tone="bad">{t('disabled')}</Badge>}
            {u.twoFactor && <Badge>{t('2fa')}</Badge>}
            {SOURCE_BADGE[u.source] && <Badge>{t(SOURCE_BADGE[u.source])}</Badge>}
            {u.id === me?.id && <Badge>{t('you')}</Badge>}
          </span>
        </span>
      </td>
      <td className="mono dim">{u.email}</td>
      <td className="num dim">{u.lastSeen ? fmtAgo(u.lastSeen) : t('never')}</td>
      <td className="num mono">{fmtMoney(u.monthSpend || 0)}</td>
      <td>
        <Input type="number" min="0" step="any" placeholder={t('default')} value={value}
          aria-label={t('Cap $/month')} disabled={!u.manage && u.id !== me?.id}
          onChange={(e) => setCap(e.target.value)}
          onBlur={(e) => commitCap(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
      </td>
      <td className="fit">
        {u.manage && u.assignable.length
          ? <Select value={u.role} label={t('Role')} onChange={(v) => { if (v !== u.role) M.setRole(u.id, v); }}
            options={order.filter(r => r === u.role || u.assignable.includes(r)).map(r => ({ value: r, label: roleName(r) }))} />
          : <span className="dim">{roleName(u.role)}</span>}
      </td>
      <td className="acts">
        <Acts end>
          <IconBtn label={t('See access')} onClick={() => onAccess(u)}><Eye /></IconBtn>
          {pending && u.assignable.includes('user') && (
            <Btn size="sm" kind="primary" onClick={() => M.setRole(u.id, 'user')}>{t('Approve')}</Btn>
          )}
          {u.manage && (
            <Btn size="sm" onClick={() => M.setStatus(u.id, disabled ? 'active' : 'disabled')}>{disabled ? t('Enable') : t('Disable')}</Btn>
          )}
          {u.manage && u.twoFactor && <IconBtn label={t('Reset two-factor')} onClick={() => M.resetMfa(u)}><Shield /></IconBtn>}
          {u.manage && <IconBtn label={t('Sign out everywhere')} onClick={() => M.revokeSessions(u.id)}><Logout /></IconBtn>}
          {u.manage && <IconBtn kind="danger" label={t('Remove account')} onClick={() => M.remove(u)}><Trash /></IconBtn>}
        </Acts>
      </td>
    </tr>
  );
}

export default function UsersSection() {
  const { users: M, user } = useAdmin();
  const [q, setQ] = useState(M.filter.q);
  const [viewing, setViewing] = useState(null);
  const view = VIEWS.find(v => v.filter.role === M.filter.role && v.filter.status === M.filter.status)?.value || 'all';
  const custom = M.roles.filter(r => !r.builtin);
  const roleName = (id) => roleLabel(id, custom.find(r => r.id === id)?.name);
  const order = M.roles.map(r => r.id);
  const { setFilter } = M;

  useEffect(() => {
    const timer = setTimeout(() => setFilter({ q: q.trim() }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q, setFilter]);

  const badges = { all: M.counts.all, pending: M.counts.pending, disabled: M.counts.disabled };

  return (
    <>
      <Registration signup={M.signup} save={M.saveSignup} />
      <TwoFactorPolicy mfa={M.mfa} save={M.saveMfa} />

      {M.counts.pending > 0 && view !== 'pending' && (
        <Note tone="warn" icon={<Alert />}>
          {tp(M.counts.pending, '{n} account is waiting for approval.', '{n} accounts are waiting for approval.')}{' '}
          <button type="button" className="linklike" onClick={() => setFilter(VIEWS[1].filter)}>{t('Show them')}</button>
        </Note>
      )}

      <div className="cp-toolbar">
        <div className="cp-toolbar-find">
          <Input value={q} type="search" placeholder={t('Filter by name or email')} aria-label={t('Filter by name or email')}
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <Seg value={view} label={t('Show')} onChange={(v) => setFilter(VIEWS.find(x => x.value === v).filter)}
          options={VIEWS.map(v => ({ value: v.value, label: t(v.label), badge: badges[v.value] }))} />
      </div>

      <Card title={t('Accounts')} flush
        sub={t('You can manage only accounts below your own role, and grant only roles below it. A blank cap falls back to the default in Quotas.')}
        foot={M.users.length < M.total
          ? <Btn size="sm" disabled={M.loading} onClick={M.loadMore}>{M.loading ? t('Loading…') : t('Load {n} more', { n: USERS_PAGE })}</Btn>
          : null}>
        {!M.ready
          ? <Skel when><SkelTable cols={5} rows={6} /></Skel>
          : M.users.length === 0
          ? <Empty icon={Users} title={t('No accounts match')}>{t('Clear the filter to see everyone.')}</Empty>
          : (
            <Table head={[
              { label: t('User') },
              { label: t('Email'), mono: true },
              { label: t('Last active'), num: true, fit: true },
              { label: t('Spent this month'), num: true, fit: true },
              { label: t('Cap $/month'), width: '130px' },
              { label: t('Role'), fit: true },
              { label: '', fit: true }
            ]}>
              {M.users.map(u => <UserRow key={u.id} u={u} me={user} roleName={roleName} order={order} M={M} onAccess={setViewing} />)}
            </Table>
          )}
      </Card>

      {viewing && (
        <AccessDialog person={viewing} roles={M.roles} registry={M.registry} canEditGroups={can(user, 'admin.groups')}
          onClose={() => setViewing(null)} />
      )}

      <Card title={t('Roles')}>
        <KV items={[
          [t('Owner'), t('Everything, including sign-in and security settings and making admins and owners. There can be several, and the last one cannot be removed.')],
          [t('Admin'), t('The whole admin panel, including publishing. Manages every account below Admin.')],
          ...custom.map(r => [r.name, r.description || t('A custom role made by an owner.')]),
          [t('User'), t('Everyday use: chats, projects, files and tools, within what the User role allows.')],
          [t('Pending'), t('Signed up but cannot use anything until someone approves the account.')]
        ]} />
      </Card>
    </>
  );
}