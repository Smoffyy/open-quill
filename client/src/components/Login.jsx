import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [exists, setExists] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  async function next() {
    setErr('');
    if (!/.+@.+\..+/.test(email)) { setErr('Enter a valid email address.'); return; }
    setBusy(true);
    try {
      const { exists } = await api.post('/api/auth/check-email', { email });
      setExists(exists);
      setStep('password');
    } catch (e) { setErr(String(e.message)); }
    setBusy(false);
  }

  async function submit() {
    setErr('');
    if (pw.length < 4) { setErr('Password must be at least 4 characters.'); return; }
    setBusy(true);
    try {
      const body = { email, password: pw };
      if (step === 'twofa') { if (useRecovery) body.recovery = code; else body.code = code; }
      const { user } = await api.post('/api/auth/login', body);
      onLogin(user);
    } catch (e) {
      if (e?.message === 'two-factor required' || (e?.message || '').toLowerCase().includes('two-factor')) { setStep('twofa'); setErr(step === 'twofa' ? 'That code was not valid. Try again.' : ''); }
      else setErr(String(e.message));
    }
    setBusy(false);
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo"><img src="/starburst.svg" alt="" /> open-quill</div>
        <h1>Do your best work<br />with <b>open-quill</b></h1>
        <div className="login-box">
          {step === 'email' ? (
            <>
              <div className="lbl">Get started with your email below</div>
              {err && <div className="err">{err}</div>}
              <input autoFocus placeholder="Email address" value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && next()} />
              <button className="primary" onClick={next} disabled={busy}>Continue with email</button>
            </>
          ) : step === 'twofa' ? (
            <>
              <div className="lbl">{useRecovery ? 'Enter a recovery code' : 'Enter your two-factor code'}</div>
              {err && <div className="err">{err}</div>}
              <input autoFocus placeholder={useRecovery ? 'xxxxx-xxxxx' : '123456'} value={code}
                inputMode={useRecovery ? 'text' : 'numeric'}
                onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && submit()} />
              <button className="primary" onClick={submit} disabled={busy}>Verify</button>
              <button className="back" onClick={() => { setUseRecovery(r => !r); setCode(''); setErr(''); }}>{useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}</button>
            </>
          ) : (
            <>
              <div className="lbl">{exists ? 'Enter your password' : 'Create a password for your new account'}</div>
              {err && <div className="err">{err}</div>}
              <input autoFocus type="password" placeholder="Password" value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()} />
              <button className="primary" onClick={submit} disabled={busy}>
                {exists ? 'Sign in' : 'Create account'}
              </button>
              <button className="back" onClick={() => { setStep('email'); setPw(''); setErr(''); }}>← {email}</button>
            </>
          )}
        </div>
        <div className="sub">open-quill is a fully open-source web interface for large language model inference.</div>
        <div className="byline">BY SMOFFYY</div>
      </div>
    </div>
  );
}
