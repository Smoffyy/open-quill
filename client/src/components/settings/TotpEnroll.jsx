import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { t } from '../../i18n.jsx';
import { Skel, SkelLines } from '../ui/Skeleton.jsx';

export default function TotpEnroll({ onEnabled, onCancel }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.post('/api/me/2fa/setup', {})
      .then(d => { if (alive) setSetup(d); })
      .catch(e => { if (alive) setErr(e?.message || t('Could not start setup.')); });
    return () => { alive = false; };
  }, []);

  async function confirm(e) {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setErr('');
    try {
      onEnabled(await api.post('/api/me/2fa/enable', { code }));
    } catch (e2) {
      setErr(e2?.message || t('Invalid code.'));
      setBusy(false);
    }
  }

  return (
    <form className="totp-enroll" onSubmit={confirm} noValidate>
      <div className="muted-note">{t('Scan this code with an authenticator app, or type the key into it, then enter the 6-digit code it shows.')}</div>
      {setup ? (
        <div className="totp-setup">
          <img className="totp-qr" src={'data:image/svg+xml;utf8,' + encodeURIComponent(setup.qr)} alt={t('QR code for your authenticator app')} />
          <div className="field">
            <label className="sub" htmlFor="totp-key">{t('Secret key')}</label>
            <code id="totp-key" className="totp-secret">{setup.secret}</code>
          </div>
        </div>
      ) : !err && <Skel when><SkelLines count={3} /></Skel>}
      <div id="totp-err" className="dz-err" role="alert">{err}</div>
      <input className="code-input" placeholder="123456" inputMode="numeric" autoComplete="one-time-code" aria-label={t('Two-factor code')}
        aria-invalid={err ? true : undefined} aria-describedby={err ? 'totp-err' : undefined}
        value={code} onChange={(e) => { setErr(''); setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); }} />
      <div className="edit-actions">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>{t('Cancel')}</button>}
        <button type="submit" className="btn primary" disabled={code.length !== 6 || busy || !setup} aria-busy={busy}>
          {busy && <span className="btn-spin" aria-hidden="true" />}{busy ? t('Verifying…') : t('Verify & enable')}
        </button>
      </div>
    </form>
  );
}

export function RecoveryCodes({ codes }) {
  return (
    <div className="recovery-box">
      <div className="muted-note">{t('Save these recovery codes somewhere safe. Each works once if you lose your authenticator. They will not be shown again.')}</div>
      <div className="recovery-grid">{codes.map(c => <code key={c}>{c}</code>)}</div>
    </div>
  );
}