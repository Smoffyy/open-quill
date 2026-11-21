import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { t } from '../../i18n.jsx';
import { isTouch } from '../../lib/touch.js';
import BrandMark from '../ui/BrandMark.jsx';
import { ssoMessage } from '../../lib/ssomessages.js';

export default function Login({ onLogin, cfg }) {
  const firstRun = !!cfg?.firstRun;
  const signupsAllowed = firstRun || (cfg?.signup || 'open') !== 'closed';
  const approval = !firstRun && cfg?.signup === 'approval';
  const [mode, setMode] = useState(firstRun ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [bad, setBad] = useState('');
  const [busy, setBusy] = useState(false);
  const [twofa, setTwofa] = useState(false);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [setupToken, setSetupToken] = useState('');
  const appName = cfg?.appName || 'open-quill';
  const providers = cfg?.providers || [];
  const directory = !!cfg?.ldap && !firstRun && mode === 'signin';
  const loginLabel = directory ? t('Email or username') : t('Email address');

  useEffect(() => { if (firstRun) setMode('signup'); }, [firstRun]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const token = q.get('setup');
    if (token) setSetupToken(token);
    if (q.get('mfa') === '1') setTwofa(true);
    if (q.get('sso_error')) { setBad('credentials'); setErr(ssoMessage(q.get('sso_error'))); }
    if (q.has('mfa') || q.has('sso_error')) history.replaceState({}, '', window.location.pathname);
  }, []);

  async function continueWith(p) {
    setErr(''); setBad('');
    setBusy(true);
    try {
      const { url } = await api.post(`/api/auth/sso/${p.id}/start`, { returnTo: '/' });
      window.location.href = url;
    } catch (e) {
      setErr(String(e?.message || ''));
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setErr('');
    setBad('');
    setPw('');
    setConfirm('');
    setTwofa(false);
    setCode('');
  }

  async function signIn() {
    setErr(''); setBad('');
    if (!email.trim()) { setBad('email'); setErr(t('Enter your email and password.')); return; }
    if (!pw) { setBad('pw'); setErr(t('Enter your email and password.')); return; }
    setBusy(true);
    try {
      const r = await api.post('/api/auth/login', { email: email.trim(), password: pw });
      if (r.mfa) { setTwofa(true); setCode(''); setUseRecovery(false); }
      else onLogin(r.user);
    } catch (e) {
      setBad('credentials');
      setErr(String(e?.message || ''));
    }
    setBusy(false);
  }

  async function verify() {
    setErr(''); setBad('');
    if (!code.trim()) { setBad('code'); setErr(useRecovery ? t('Enter a recovery code') : t('Enter your two-factor code')); return; }
    setBusy(true);
    try {
      const { user } = await api.post('/api/auth/mfa', useRecovery ? { recovery: code } : { code });
      onLogin(user);
    } catch (e) {
      if (e?.body?.restart) { setTwofa(false); setCode(''); setPw(''); setBad('credentials'); }
      else setBad('code');
      setErr(String(e?.message || ''));
    }
    setBusy(false);
  }

  async function signUp() {
    setErr(''); setBad('');
    if (!/.+@.+\..+/.test(email.trim())) { setBad('email'); setErr(t('Enter a valid email address.')); return; }
    if (pw.length < 8) { setBad('pw'); setErr(t('Password must be at least 8 characters.')); return; }
    if (pw !== confirm) { setBad('confirm'); setErr(t('Those passwords do not match.')); return; }
    setBusy(true);
    try {
      const { user } = await api.post('/api/auth/register', { email: email.trim(), password: pw, ...(firstRun ? { setupToken: setupToken.trim() } : {}) });
      if (firstRun) history.replaceState({}, '', window.location.pathname);
      onLogin(user);
    } catch (e) { setBad(e?.body?.setup ? 'setup' : 'email'); setErr(String(e?.message || '')); }
    setBusy(false);
  }

  const submit = twofa ? verify : mode !== 'signup' ? signIn : signUp;
  const onSubmit = (e) => { e.preventDefault(); if (!busy) submit(); };
  const clear = () => { if (err || bad) { setErr(''); setBad(''); } };
  const errId = 'login-err';
  const flag = (field) => (bad === field || bad === 'credentials'
    ? { 'aria-invalid': true, 'aria-describedby': errId, className: 'bad' }
    : {});

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo"><BrandMark src={cfg?.appIcon} /> {appName}</div>
        <h1>{(() => {
          const parts = t('Do your best work with {app}', { app: '\u0000' }).split('\u0000');
          return <>{parts[0]}<b>{appName}</b>{parts[1] || ''}</>;
        })()}</h1>
        <form className="login-box" onSubmit={onSubmit} noValidate>
          {twofa ? (
            <>
              <div className="lbl">{useRecovery ? t('Enter a recovery code') : t('Enter your two-factor code')}</div>
              <div className="err" id={errId} role="alert">{err}</div>
              <input autoFocus placeholder={useRecovery ? 'xxxxx-xxxxx' : '123456'} value={code}
                inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code"
                aria-label={useRecovery ? t('Recovery code') : t('Two-factor code')} {...flag('code')}
                onChange={(e) => { clear(); setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6)); }} />
              <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
                {busy && <span className="btn-spin" aria-hidden="true" />}{busy ? t('Verifying…') : t('Verify')}
              </button>
              <button type="button" className="back" onClick={() => { setUseRecovery(r => !r); setCode(''); setErr(''); setBad(''); }}>
                {useRecovery ? t('Use authenticator code instead') : t('Use a recovery code instead')}
              </button>
              <button type="button" className="back" onClick={() => switchMode('signin')}>{t('Back to sign in')}</button>
            </>
          ) : (
            <>
              {!firstRun && signupsAllowed && (
                <div className="login-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => switchMode('signin')}>{t('Sign in')}</button>
                  <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchMode('signup')}>{t('Create account')}</button>
                </div>
              )}
              <div className="lbl">
                {firstRun ? t('Create the owner account for this server.')
                  : mode === 'signup' ? t('Create an account to get started.')
                  : t('Sign in to continue.')}
              </div>
              <div className="err" id={errId} role="alert">{err}</div>
              {firstRun && (
                <input autoComplete="off" spellCheck={false} placeholder={t('Setup token')} value={setupToken}
                  aria-label={t('Setup token')} {...flag('setup')}
                  onChange={(e) => { clear(); setSetupToken(e.target.value); }} />
              )}
              <input autoFocus={!isTouch()} type={directory ? 'text' : 'email'} autoComplete={directory ? 'username' : 'email'} spellCheck={false}
                autoCapitalize="none" placeholder={loginLabel} value={email} aria-label={loginLabel} {...flag('email')}
                onChange={(e) => { clear(); setEmail(e.target.value); }} />
              <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={t('Password')} value={pw} aria-label={t('Password')} {...flag('pw')}
                onChange={(e) => { clear(); setPw(e.target.value); }} />
              {mode === 'signup' && (
                <input type="password" autoComplete="new-password" placeholder={t('Confirm password')} value={confirm}
                  aria-label={t('Confirm password')} {...flag('confirm')}
                  onChange={(e) => { clear(); setConfirm(e.target.value); }} />
              )}
              <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
                {busy && <span className="btn-spin" aria-hidden="true" />}
                {busy ? (mode === 'signup' ? t('Creating account…') : t('Signing in…'))
                  : mode === 'signup' ? (firstRun ? t('Create owner account') : t('Create account')) : t('Sign in')}
              </button>
              {mode === 'signin' && !firstRun && providers.length > 0 && (
                <div className="login-sso">
                  <div className="login-or"><span>{t('or')}</span></div>
                  {providers.map(p => (
                    <button key={p.id} type="button" className="sso-btn" disabled={busy} onClick={() => continueWith(p)}>
                      {t('Continue with {name}', { name: p.label })}
                    </button>
                  ))}
                </div>
              )}
              {!firstRun && !signupsAllowed && mode === 'signin' && (
                <div className="login-note">{t('New accounts are turned off on this server.')}</div>
              )}
              {firstRun && (
                <div className="login-note">{t('The setup token is printed in the server console while no owner account exists.')}</div>
              )}
              {approval && mode === 'signup' && (
                <div className="login-note">{t('New accounts wait for an administrator to approve them.')}</div>
              )}
            </>
          )}
        </form>
        <div className="sub">{t('{app} is a fully open-source web interface for large language model inference.', { app: appName })}</div>
        <div className="byline">{t("BY SMOFFYY")}</div>
      </div>
    </div>
  );
}