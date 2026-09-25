import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { t, fmtDateTime, fmtRelative } from '../../i18n.jsx';
import { Skel, SkelRows } from '../ui/Skeleton.jsx';
import { browserName, systemName } from '../../lib/useragent.js';

const MIN_PASSWORD = 4;

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
    if (pw.next.length < MIN_PASSWORD) { setErr({ text: t('New password must be at least 4 characters.'), field: 'next' }); return; }
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
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [err, setErr] = useState('');

  async function run(fn, fallback) {
    setErr('');
    try { await fn(); }
    catch (e) { setErr(e?.message || fallback); }
  }
  const start = () => run(async () => { setRecovery(null); setSetup(await api.post('/api/me/2fa/setup', {})); }, t('Could not start setup.'));
  const confirm = (e) => {
    e.preventDefault();
    if (code.length !== 6) return;
    run(async () => {
      const r = await api.post('/api/me/2fa/enable', { code });
      setSetup(null); setCode(''); setOn(true); setRecovery(r.recoveryCodes);
      onUpdated?.({ ...user, twoFactor: true });
    }, t('Invalid code.'));
  };
  const disable = () => run(async () => {
    await api.post('/api/me/2fa/disable', { password });
    setOn(false); setPassword(''); setRecovery(null);
    onUpdated?.({ ...user, twoFactor: false });
  }, t('Could not disable.'));
  const regenerate = () => run(async () => {
    const r = await api.post('/api/me/2fa/recovery', { password });
    setPassword(''); setRecovery(r.recoveryCodes);
  }, t('Could not regenerate codes.'));

  return (
    <div className="sec-block">
      <div className="me-section-h">{t("Two-factor authentication")} {on && <span className="you-tag">{t("enabled")}</span>}</div>
      <div className="dz-err" role="alert">{err}</div>
      {recovery && (
        <div className="recovery-box">
          <div className="muted-note">{t("Save these recovery codes somewhere safe. Each works once if you lose your authenticator. They will not be shown again.")}</div>
          <div className="recovery-grid">{recovery.map(c => <code key={c}>{c}</code>)}</div>
        </div>
      )}
      {!on && !setup && (
        <>
          <div className="muted-note">{t("Require a code from an authenticator app as a second step at login.")}</div>
          <button className="btn" onClick={start}>{t("Set up two-factor")}</button>
        </>
      )}
      {!on && setup && (
        <form onSubmit={confirm}>
          <div className="muted-note">{t("In your authenticator app, add an account using this key, then enter the 6-digit code it shows.")}</div>
          <div className="field"><label className="sub">{t("Secret key")}</label><code className="totp-secret">{setup.secret}</code></div>
          <div className="field"><label className="sub">{t("Or paste this setup URL")}</label><code className="totp-uri">{setup.otpauth}</code></div>
          <input className="code-input" placeholder="123456" inputMode="numeric" autoComplete="one-time-code" aria-label={t("Two-factor code")}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <div className="edit-actions">
            <button type="button" className="btn ghost" onClick={() => { setSetup(null); setCode(''); }}>{t("Cancel")}</button>
            <button type="submit" className="btn primary" disabled={code.length !== 6}>{t("Verify & enable")}</button>
          </div>
        </form>
      )}
      {on && (
        <>
          <div className="muted-note">{t("Enter your password to regenerate recovery codes or turn off two-factor.")}</div>
          <input type="password" className="short-input" placeholder={t("Password")} aria-label={t("Password")} autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="edit-actions">
            <button className="btn ghost" onClick={regenerate} disabled={!password}>{t("Regenerate recovery codes")}</button>
            <button className="btn danger" onClick={disable} disabled={!password}>{t("Disable two-factor")}</button>
          </div>
        </>
      )}
    </div>
  );
}

function Sessions() {
  const [sessions, setSessions] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    setErr('');
    api.get('/api/me/sessions').then(d => setSessions(d.sessions || [])).catch(() => setErr(t('Could not load sessions.')));
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
      <div className="sec-note">{t("Devices signed in to your account. Sessions expire after 30 days idle.")}</div>
      <div className="dz-err" role="alert">{err}</div>
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
          {!s.current && <button className="btn danger" onClick={() => revoke(s.id)}>{t("Revoke")}</button>}
        </div>
      ))}
      {sessions && sessions.some(s => !s.current) && (
        <div className="field row">
          <div><label>{t("Revoke all other sessions")}</label><div className="muted-note">{t("Keeps this device signed in and ends every other session.")}</div></div>
          <button className="btn danger" onClick={revokeOthers}>{t("Revoke others")}</button>
        </div>
      )}
    </div>
  );
}

export default function SecurityTab({ user, onUpdated }) {
  return (
    <>
      <div className="hint">{t("Change your password and manage two-factor authentication.")}</div>
      <div className="me-section-h">{t("Password")}</div>
      <PasswordForm email={user.email} />
      <TwoFactor user={user} onUpdated={onUpdated} />
      <Sessions />
    </>
  );
}
