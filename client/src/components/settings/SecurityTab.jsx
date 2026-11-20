import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { t, tp, fmtDateTime, fmtRelative } from '../../i18n.jsx';
import { Skel, SkelRows } from '../ui/Skeleton.jsx';
import { browserName, systemName } from '../../lib/useragent.js';
import TotpEnroll, { RecoveryCodes } from './TotpEnroll.jsx';

const MIN_PASSWORD = 8;

function PasswordForm({ email }) {
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState({ text: '', field: '' });
  const [busy, setBusy] = useState(false);

  const edit = (k) => (e) => { setPw(p => ({ ...p, [k]: e.target.value })); if (err.text) setErr({ text: '', field: '' }); setMsg(''); };
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (pw.next !== pw.confirm) { setErr({ text: t('New passwords do not match.'), field: 'confirm' }); return; }
    if (pw.next.length < MIN_PASSWORD) { setErr({ text: t('New password must be at least 8 characters.'), field: 'next' }); return; }
    setBusy(true);
    try {
      await api.post('/api/me/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setMsg(t('Password updated. Other sessions were signed out.'));
    } catch (e2) {
      setErr({ text: e2?.message || t('Could not change password.'), field: 'current' });
    }
    setBusy(false);
  }
  const invalid = (k) => (err.field === k ? { 'aria-invalid': true, 'aria-describedby': 'set-pw-err' } : {});

  return (
    <form className="field stack" onSubmit={submit} noValidate>
      <input type="email" className="sr-only" autoComplete="username" value={email || ''} readOnly tabIndex={-1} aria-hidden="true" />
      <input type="password" placeholder={t("Current password")} aria-label={t("Current password")} autoComplete="current-password"
        value={pw.current} onChange={edit('current')} {...invalid('current')} />
      <input type="password" placeholder={t("New password")} aria-label={t("New password")} autoComplete="new-password"
        value={pw.next} onChange={edit('next')} {...invalid('next')} />
      <input type="password" placeholder={t("Confirm new password")} aria-label={t("Confirm new password")} autoComplete="new-password"
        value={pw.confirm} onChange={edit('confirm')} {...invalid('confirm')} />
      <div id="set-pw-err" className="dz-err" role="alert">{err.text}</div>
      {msg && <div className="muted-note ok-note" role="status">{msg}</div>}
      <div>
        <button type="submit" className="btn" disabled={busy || !pw.current || !pw.next}>
          {busy && <span className="btn-spin" aria-hidden="true" />}{t("Update password")}
        </button>
      </div>
    </form>
  );
}

function TwoFactor({ user, onUpdated }) {
  const [on, setOn] = useState(!!user.twoFactor);
  const [enrolling, setEnrolling] = useState(false);
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [left, setLeft] = useState(user.recoveryLeft || 0);
  const [err, setErr] = useState('');

  async function run(fn, fallback) {
    setErr('');
    try { await fn(); }
    catch (e) { setErr(e?.message || fallback); }
  }
  function enabled(r) {
    setEnrolling(false); setOn(true); setRecovery(r.recoveryCodes); setLeft(r.recoveryCodes.length);
    onUpdated?.(r.user || { ...user, twoFactor: true });
  }
  const disable = () => run(async () => {
    await api.post('/api/me/2fa/disable', { password });
    setOn(false); setPassword(''); setRecovery(null); setLeft(0);
    onUpdated?.({ ...user, twoFactor: false, recoveryLeft: 0 });
  }, t('Could not disable.'));
  const regenerate = () => run(async () => {
    const r = await api.post('/api/me/2fa/recovery', { password });
    setPassword(''); setRecovery(r.recoveryCodes); setLeft(r.recoveryCodes.length);
  }, t('Could not regenerate codes.'));

  return (
    <div className="sec-block">
      <div className="me-section-h">{t("Two-factor authentication")} {on && <span className="you-tag">{t("enabled")}</span>}</div>
      <div className="dz-err" role="alert">{err}</div>
      {recovery && <RecoveryCodes codes={recovery} />}
      {!on && !enrolling && (
        <>
          <div className="muted-note">
            {user.twoFactorRequired ? t('Your organization requires two-factor authentication.') : t("Require a code from an authenticator app as a second step at login.")}
          </div>
          <button className="btn" onClick={() => { setRecovery(null); setEnrolling(true); }}>{t("Set up two-factor")}</button>
        </>
      )}
      {!on && enrolling && <TotpEnroll onEnabled={enabled} onCancel={() => setEnrolling(false)} />}
      {on && (
        <>
          <div className="muted-note">
            {tp(left, '{n} recovery code left.', '{n} recovery codes left.')}{' '}
            {user.twoFactorRequired
              ? t('Your organization requires two-factor authentication, so it cannot be turned off. Enter your password to regenerate recovery codes.')
              : t("Enter your password to regenerate recovery codes or turn off two-factor.")}
          </div>
          <input type="password" className="short-input" placeholder={t("Password")} aria-label={t("Password")} autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="edit-actions">
            <button className="btn ghost" onClick={regenerate} disabled={!password}>{t("Regenerate recovery codes")}</button>
            {!user.twoFactorRequired && <button className="btn ghost" onClick={disable} disabled={!password}>{t("Disable two-factor")}</button>}
          </div>
        </>
      )}
    </div>
  );
}

function Sessions() {
  const [sessions, setSessions] = useState(null);
  const [idleDays, setIdleDays] = useState(0);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    setErr('');
    api.get('/api/me/sessions').then(d => { setSessions(d.sessions || []); setIdleDays(d.idleDays || 0); }).catch(() => setErr(t('Could not load sessions.')));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function revoke(id) {
    try { await api.del('/api/me/sessions/' + id); setSessions(s => (s || []).filter(x => x.id !== id)); }
    catch { setErr(t('Could not revoke that session.')); }
  }
  async function revokeOthers() {
    try { await api.del('/api/me/sessions'); load(); }
    catch { setErr(t('Could not revoke other sessions.')); }
  }

  return (
    <div className="sec-block">
      <div className="me-section-h">{t("Active sessions")}</div>
      <div className="sec-note">{idleDays ? tp(idleDays, 'Devices signed in to your account. A session ends after {n} day without use.', 'Devices signed in to your account. A session ends after {n} days without use.') : t('Devices signed in to your account.')}</div>
      <div className="dz-err" role="alert">{err}</div>
      {sessions && sessions.some(s => !s.current) && (
        <div className="field row">
          <div><label>{t("Revoke all other sessions")}</label><div className="muted-note">{t("Keeps this device signed in and ends every other session.")}</div></div>
          <button className="btn ghost" onClick={revokeOthers}>{t("Revoke others")}</button>
        </div>
      )}
      {!sessions && !err && <Skel when><SkelRows count={3} /></Skel>}
      {sessions && sessions.map(s => (
        <div className="field row" key={s.id}>
          <div>
            <label>
              {t("{device} on {os}", { device: browserName(s.userAgent) || t('Browser'), os: systemName(s.userAgent) || t('Unknown OS') })}
              {s.current && <> <span className="you-tag">{t("this device")}</span></>}
            </label>
            <div className="muted-note">
              {[s.ip, s.lastSeen && t('Active {when}', { when: fmtRelative(s.lastSeen) }), s.createdAt && t('Signed in {when}', { when: fmtDateTime(s.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) })]
                .filter(Boolean).join(' · ')}
            </div>
          </div>
          {!s.current && <button className="btn ghost" onClick={() => revoke(s.id)}>{t("Revoke")}</button>}
        </div>
      ))}
    </div>
  );
}

export default function SecurityTab({ user, onUpdated, reviewNotice = false }) {
  return (
    <>
      <div className="hint">{t("Change your password and manage two-factor authentication.")}</div>
      {reviewNotice && (
        <div className="muted-note review-notice" role="note">
          {t('Replies on this workspace are reviewed automatically for quality. An admin can open one of your conversations only when a reply in it is flagged by a check, rated, or saved as a test case, and every time they do it is recorded. Incognito chats are never reviewed.')}
        </div>
      )}
      <div className="me-section-h">{t("Password")}</div>
      <PasswordForm email={user.email} />
      <TwoFactor user={user} onUpdated={onUpdated} />
      <Sessions />
    </>
  );
}