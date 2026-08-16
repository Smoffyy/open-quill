import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { t } from '../i18n.jsx';
import { isTouch } from '../lib/touch.js';

export default function Login({ onLogin, cfg }) {
  const firstRun = !!cfg?.firstRun;
  const signupsAllowed = firstRun || cfg?.allowSignups !== false;
  const [mode, setMode] = useState(firstRun ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [twofa, setTwofa] = useState(false);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const appName = cfg?.appName || 'open-quill';

  useEffect(() => { if (firstRun) setMode('signup'); }, [firstRun]);

  function switchMode(next) {
    setMode(next);
    setErr('');
    setPw('');
    setConfirm('');
    setTwofa(false);
    setCode('');
  }

  async function signIn() {
    setErr('');
    if (!email.trim() || !pw) { setErr(t('Enter your email and password.')); return; }
    setBusy(true);
    try {
      const body = { email: email.trim(), password: pw };
      if (twofa) { if (useRecovery) body.recovery = code; else body.code = code; }
      const { user } = await api.post('/api/auth/login', body);
      onLogin(user);
    } catch (e) {
      const m = String(e?.message || '');
      if (/two-factor required/i.test(m)) { setTwofa(true); setErr(''); }
      else if (/two-factor code/i.test(m)) { setTwofa(true); setErr(t('That code was not valid. Try again.')); }
      else setErr(m);
    }
    setBusy(false);
  }

  async function signUp() {
    setErr('');
    if (!/.+@.+\..+/.test(email.trim())) { setErr(t('Enter a valid email address.')); return; }
    if (pw.length < 8) { setErr(t('Password must be at least 8 characters.')); return; }
    if (pw !== confirm) { setErr(t('Those passwords do not match.')); return; }
    setBusy(true);
    try {
      const { user } = await api.post('/api/auth/register', { email: email.trim(), password: pw });
      onLogin(user);
    } catch (e) { setErr(String(e?.message || '')); }
    setBusy(false);
  }

  const submit = mode === 'signup' ? signUp : signIn;
  const onEnter = (e) => { if (e.key === 'Enter' && !busy) submit(); };

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo"><img src={cfg?.appIcon || '/starburst.svg'} alt="" /> {appName}</div>
        <h1>{(() => {
          const parts = t('Do your best work with {app}', { app: '\u0000' }).split('\u0000');
          return <>{parts[0]}<b>{appName}</b>{parts[1] || ''}</>;
        })()}</h1>
        <div className="login-box">
          {twofa ? (
            <>
              <div className="lbl">{useRecovery ? t('Enter a recovery code') : t('Enter your two-factor code')}</div>
              {!!err && <div className="err">{err}</div>}
              <input autoFocus placeholder={useRecovery ? 'xxxxx-xxxxx' : '123456'} value={code}
                inputMode={useRecovery ? 'text' : 'numeric'}
                onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={onEnter} />
              <button className="primary" onClick={signIn} disabled={busy}>{t('Verify')}</button>
              <button className="back" onClick={() => { setUseRecovery(r => !r); setCode(''); setErr(''); }}>
                {useRecovery ? t('Use authenticator code instead') : t('Use a recovery code instead')}
              </button>
            </>
          ) : (
            <>
              {!firstRun && signupsAllowed && (
                <div className="login-tabs" role="tablist">
                  <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => switchMode('signin')}>{t('Sign in')}</button>
                  <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchMode('signup')}>{t('Create account')}</button>
                </div>
              )}
              <div className="lbl">
                {firstRun ? t('Create the owner account for this server.')
                  : mode === 'signup' ? t('Create an account to get started.')
                  : t('Sign in to continue.')}
              </div>
              {!!err && <div className="err">{err}</div>}
              <input autoFocus={!isTouch()} type="email" autoComplete="email" placeholder={t('Email address')} value={email}
                onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
              <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={t('Password')} value={pw}
                onChange={(e) => setPw(e.target.value)} onKeyDown={onEnter} />
              {mode === 'signup' && (
                <input type="password" autoComplete="new-password" placeholder={t('Confirm password')} value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} onKeyDown={onEnter} />
              )}
              <button className="primary" onClick={submit} disabled={busy}>
                {mode === 'signup' ? (firstRun ? t('Create owner account') : t('Create account')) : t('Sign in')}
              </button>
              {!firstRun && !signupsAllowed && mode === 'signin' && (
                <div className="login-note">{t('New accounts are turned off on this server.')}</div>
              )}
            </>
          )}
        </div>
        <div className="sub">{t('{app} is a fully open-source web interface for large language model inference.', { app: appName })}</div>
        <div className="byline">{t("BY SMOFFYY")}</div>
      </div>
    </div>
  );
}
