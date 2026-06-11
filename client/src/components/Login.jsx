import React, { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [exists, setExists] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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
      const { user } = await api.post('/api/auth/login', { email, password: pw });
      onLogin(user);
    } catch (e) { setErr(String(e.message)); }
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
        <div className="sub">open-quill is an fully open-sourced webUI for inference<br />with large language models.</div>
        <div className="byline">BY SMOFFYY</div>
      </div>
    </div>
  );
}
