import React, { useState } from 'react';
import { useAdmin } from '../store.jsx';
import { Trash } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

export default function MembersSection() {
  const A = useAdmin();
  const { users, setUsers, user } = A;
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const adminCount = users.filter(u => u.isAdmin || u.isOwner).length;
  const mq = q.trim().toLowerCase();
  const shownUsers = users.filter(u => {
    const isAdm = !!(u.isAdmin || u.isOwner);
    if (role === 'admins' && !isAdm) return false;
    if (role === 'users' && isAdm) return false;
    if (mq && !((u.displayName || '').toLowerCase().includes(mq) || (u.email || '').toLowerCase().includes(mq))) return false;
    return true;
  });
  return (
    <>
      <div className="field row">
        <div>
          <label>{t("Allow new accounts")}</label>
          <div className="muted-note">{t("When off, the sign-in screen stops offering account creation and the server refuses new registrations. Existing members are unaffected.")}</div>
        </div>
        <div className={'switch' + (A.cfg.allowSignups !== false ? ' on' : '')} onClick={() => A.setCfg(c => ({ ...c, allowSignups: c.allowSignups === false }))} />
      </div>
      <div className="mem-toolbar">
        <input className="mem-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search by name or email…")} />
        <div className="seg">
          {[['all', `All (${users.length})`], ['admins', `Admins (${adminCount})`], ['users', `Users (${users.length - adminCount})`]].map(([v, l]) => (
            <button key={v} className={role === v ? 'on' : ''} onClick={() => setRole(v)}>{l}</button>
          ))}
        </div>
      </div>
      {shownUsers.length === 0 && <div className="muted-note">{t("No members match.")}</div>}
      {shownUsers.map(u => (
        <div className="user-row" key={u.id}>
          <div className="avatar">{(u.displayName || u.email)[0].toUpperCase()}</div>
          <div className="u-main">
            <div className="u-name">{u.displayName}{u.isOwner && <span className="badge">{t("Top admin")}</span>}{u.twoFactor && <span className="badge" title={t("Two-factor enabled")}>{t("2FA")}</span>}{u.id === user?.id && !u.isOwner && <span className="you-tag">you</span>}</div>
            <div className="u-email">{u.email}{typeof u.monthSpend === 'number' && u.monthSpend > 0 ? ` · $${u.monthSpend.toFixed(u.monthSpend < 0.01 ? 4 : 2)} this month` : ''}</div>
          </div>
          <div className="u-budget" title={t("Monthly budget override ($). Blank uses the role default.")}>
            <span className="u-budget-prefix">$</span>
            <input type="number" min="0" step="any" placeholder={t("role default")}
              value={u.budget == null ? '' : u.budget}
              onChange={(e) => setUsers(us => us.map(x => x.id === u.id ? { ...x, budget: e.target.value === '' ? null : e.target.value } : x))}
              onBlur={(e) => A.saveBudget(u.id, e.target.value)} />
          </div>
          {!u.isOwner && (
            <div className="seg">
              <button className={u.isAdmin ? '' : 'on'} onClick={() => A.setRole(u.id, false)}>{t("User")}</button>
              <button className={u.isAdmin ? 'on' : ''} onClick={() => A.setRole(u.id, true)}>{t("Admin")}</button>
            </div>
          )}
          {!u.isOwner && u.id !== user?.id && (
            <button className="btn danger" onClick={() => A.removeUser(u.id)}><Trash style={{ width: 15 }} /></button>
          )}
        </div>
      ))}
    </>
  );
}
