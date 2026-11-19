import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { t } from '../../i18n.jsx';
import BrandMark from '../ui/BrandMark.jsx';

const POLL_MS = 30000;

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

  async function signOut() {
    try { await api.post('/api/auth/logout', {}); } catch {}
    window.location.href = '/';
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