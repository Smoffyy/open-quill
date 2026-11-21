import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { t } from '../../i18n.jsx';
import BrandMark from '../ui/BrandMark.jsx';
import TotpEnroll, { RecoveryCodes } from '../settings/TotpEnroll.jsx';

const POLL_MS = 30000;

async function signOut() {
  try { await api.post('/api/auth/logout', {}); } catch {}
  window.location.href = '/';
}

export function MfaRequired({ user, cfg, onUser }) {
  const [done, setDone] = useState(null);
  const appName = cfg?.appName || 'open-quill';
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo"><BrandMark src={cfg?.appIcon} /> {appName}</div>
        <h1>{t('Set up two-factor')}</h1>
        <div className="login-box mfa-box">
          <div className="lbl">{t('Your organization requires two-factor authentication for {email}.', { email: user.email })}</div>
          {done ? (
            <>
              <RecoveryCodes codes={done.recoveryCodes} />
              <button type="button" className="primary" onClick={() => onUser(done.user)}>{t('Continue')}</button>
            </>
          ) : <TotpEnroll onEnabled={setDone} />}
          <button type="button" className="back" onClick={signOut}>{t('Sign out')}</button>
        </div>
      </div>
    </div>
  );
}

export default function Pending({ user, cfg, onUser }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const appName = cfg?.appName || 'open-quill';

  useEffect(() => {
    const id = setInterval(() => {
      api.get('/api/me').then(({ user: fresh }) => { if (!fresh.gate) onUser(fresh); }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [onUser]);

  async function check() {
    setBusy(true);
    setNote('');
    try {
      const { user: fresh } = await api.get('/api/me');
      if (!fresh.gate) { onUser(fresh); return; }
      setNote(t('Still waiting. You can start as soon as an administrator approves the account.'));
    } catch {
      setNote(t('Could not reach the server. Try again in a moment.'));
    }
    setBusy(false);
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo"><BrandMark src={cfg?.appIcon} /> {appName}</div>
        <h1>{t('Waiting for approval')}</h1>
        <div className="login-box">
          <div className="lbl">{t('The account {email} is ready, but an administrator has to approve it before you can start.', { email: user.email })}</div>
          <div className="login-note" role="status">{note}</div>
          <button type="button" className="primary" onClick={check} disabled={busy} aria-busy={busy}>
            {busy && <span className="btn-spin" aria-hidden="true" />}{busy ? t('Checking…') : t('Check again')}
          </button>
          <button type="button" className="back" onClick={signOut}>{t('Sign out')}</button>
        </div>
      </div>
    </div>
  );
}