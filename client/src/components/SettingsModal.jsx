import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api.js';
import { applyPrefs, ACCENT_PRESETS } from '../prefs.js';
import { Sun, Moon, Gear, Sliders, Info, Chevron, Clock, Download, Upload, Shield, Trash } from './icons.jsx';
import Markdown from './Markdown.jsx';

function Toggle({ prefs, setPref, k, label, desc }) {
  return (
    <div className="field row">
      <div><label>{label}</label><div className="muted-note">{desc}</div></div>
      <div className={'switch' + (prefs[k] ? ' on' : '')} onClick={() => setPref(k, !prefs[k])} />
    </div>
  );
}

function Seg({ value, options, onPick }) {
  return (
    <div className="seg">
      {options.map(o => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onPick(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

function parseVersion(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const [base, ...restArr] = s.split('-');
  const rest = restArr.join('-');
  let channel = '', build = '';
  if (rest) {
    const mm = rest.match(/^([a-z]+)[.\-_]?(\d+)?$/i);
    if (mm) { channel = mm[1]; build = mm[2] || ''; }
    else channel = rest;
  }
  const year = (base.match(/^(\d{4})/) || [])[1] || '';
  return { full: s, base, channel, build, year };
}

export default function SettingsModal({ user, cfg, onClose, onUpdated, onDeleted, onExportChats, onImportChats }) {
  const [tab, setTab] = useState('general');
  const [chatSec, setChatSec] = useState('streaming');
  const [name, setName] = useState(user.displayName);
  const [instructions, setInstructions] = useState(user.instructions || '');
  const instrRef = useRef(user.instructions || '');
  const importRef = useRef(null);
  const [prefs, setPrefs] = useState({ animations: true, autoscroll: true, theme: 'system', accent: '', density: 'comfortable', messageEntrance: true, streamCursor: false, cursorStyle: 'block', revealMs: 40, chatStagger: true, themeFade: true, microFx: true, composerFx: true, iconGlow: false, focusGlow: false, oledShift: false, ...user.prefs });
  const [saved, setSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delErr, setDelErr] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearMsg, setClearMsg] = useState('');
  const saveTimer = useRef(null);
  const [usageData, setUsageData] = useState(null);
  const [usageErr, setUsageErr] = useState('');
  const [usageWindow, setUsageWindow] = useState('all');
  const [sessions, setSessions] = useState(null);
  const [sessionErr, setSessionErr] = useState('');
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  useEffect(() => {
    if (tab !== 'usage') return;
    let alive = true; setUsageErr(''); setUsageData(null);
    const q = usageWindow === 'all' ? '' : '?days=' + usageWindow;
    api.get('/api/me/usage' + q).then(d => { if (alive) setUsageData(d); }).catch(() => { if (alive) setUsageErr('Could not load usage.'); });
    return () => { alive = false; };
  }, [tab, usageWindow]);
  function loadSessions() {
    setSessionErr('');
    api.get('/api/me/sessions').then(d => setSessions(d.sessions || [])).catch(() => setSessionErr('Could not load sessions.'));
  }
  useEffect(() => { if (tab === 'sessions') loadSessions(); }, [tab]);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [twoFa, setTwoFa] = useState(user.twoFactor ? 'on' : 'off');
  const [setup, setSetup] = useState(null);
  const [setupCode, setSetupCode] = useState('');
  const [secErr, setSecErr] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [disablePw, setDisablePw] = useState('');
  async function changePassword() {
    setPwErr(''); setPwMsg('');
    if (pw.next !== pw.confirm) { setPwErr('New passwords do not match.'); return; }
    if (pw.next.length < 4) { setPwErr('New password must be at least 4 characters.'); return; }
    try { await api.post('/api/me/password', { current: pw.current, next: pw.next }); setPw({ current: '', next: '', confirm: '' }); setPwMsg('Password updated. Other sessions were signed out.'); }
    catch (e) { setPwErr(e?.message || 'Could not change password.'); }
  }
  async function start2fa() {
    setSecErr(''); setRecovery(null);
    try { setSetup(await api.post('/api/me/2fa/setup', {})); }
    catch (e) { setSecErr(e?.message || 'Could not start setup.'); }
  }
  async function confirm2fa() {
    setSecErr('');
    try { const r = await api.post('/api/me/2fa/enable', { code: setupCode }); setSetup(null); setSetupCode(''); setTwoFa('on'); setRecovery(r.recoveryCodes); onUpdated?.({ ...user, twoFactor: true }); }
    catch (e) { setSecErr(e?.message || 'Invalid code.'); }
  }
  async function disable2fa() {
    setSecErr('');
    try { await api.post('/api/me/2fa/disable', { password: disablePw }); setTwoFa('off'); setDisablePw(''); setRecovery(null); onUpdated?.({ ...user, twoFactor: false }); }
    catch (e) { setSecErr(e?.message || 'Could not disable.'); }
  }
  async function regenRecovery() {
    setSecErr('');
    try { const r = await api.post('/api/me/2fa/recovery', { password: disablePw }); setDisablePw(''); setRecovery(r.recoveryCodes); }
    catch (e) { setSecErr(e?.message || 'Could not regenerate codes.'); }
  }
  const _securityAnchor = null;
  async function revokeSession(id) {
    try { await api.del('/api/me/sessions/' + id); setSessions(s => (s || []).filter(x => x.id !== id)); }
    catch { setSessionErr('Could not revoke that session.'); }
  }
  async function revokeOthers() {
    try { await api.del('/api/me/sessions'); loadSessions(); }
    catch { setSessionErr('Could not revoke other sessions.'); }
  }
  const fmtN = (n) => Number(n || 0).toLocaleString();
  const fmtUsd = (n) => { const v = Number(n || 0); if (!v) return '$0.00'; return '$' + (v < 0.01 ? v.toFixed(6) : v.toFixed(4)); };
  const fmtWhen = (ts) => { if (!ts) return 'unknown'; const d = new Date(ts); const diff = Date.now() - ts; if (diff < 60000) return 'just now'; if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'; if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'; return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  const deviceLabel = (ua) => { const s = String(ua || ''); if (/edg/i.test(s)) return 'Edge'; if (/chrome|crios/i.test(s)) return 'Chrome'; if (/firefox|fxios/i.test(s)) return 'Firefox'; if (/safari/i.test(s)) return 'Safari'; return 'Browser'; };
  const osLabel = (ua) => { const s = String(ua || ''); if (/windows/i.test(s)) return 'Windows'; if (/android/i.test(s)) return 'Android'; if (/iphone|ipad|ios/i.test(s)) return 'iOS'; if (/mac os|macintosh/i.test(s)) return 'macOS'; if (/linux/i.test(s)) return 'Linux'; return 'Unknown OS'; };

  function scheduleSave(nextName, nextPrefs) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const { user: u } = await api.patch('/api/me', { displayName: nextName, prefs: nextPrefs, instructions: instrRef.current });
        onUpdated(u);
        setSaved(true); setTimeout(() => setSaved(false), 1300);
      } catch {}
    }, 450);
  }
  function changeName(v) { setName(v); scheduleSave(v, prefs); }
  function changeInstructions(v) { setInstructions(v); instrRef.current = v; scheduleSave(name, prefs); }

  async function clearChats() {
    setClearMsg('');
    try { const r = await api.del('/api/me/chats'); setConfirmClear(false); setClearMsg(`Deleted ${r.deleted || 0} chat${r.deleted === 1 ? '' : 's'}.`); setTimeout(() => { location.href = '/'; }, 700); }
    catch { setClearMsg('Could not delete chats.'); }
  }
  async function deleteAccount() {
    setDelErr('');
    try { await api.del('/api/me'); onDeleted?.(); }
    catch (e) { setDelErr(e?.message || 'Could not delete account.'); }
  }

  function setPref(k, v) { setPrefs(p => { const next = { ...p, [k]: v }; applyPrefs(next); scheduleSave(name, next); return next; }); }

  return (
    <div className="overlay" onMouseDown={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="modal" style={{ position: 'relative' }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-side">
          <div className="ms-label">Settings</div>
          <button className={'modal-tab has-sub' + (tab === 'general' ? ' active' : '') + ((tab === 'general' || tab === 'version') ? ' open' : '')} onClick={() => setTab('general')}><Gear /> General <Chevron className="tab-chev" style={{ width: 13 }} /></button>
          {(tab === 'general' || tab === 'version') && (
            <button className={'modal-tab sub' + (tab === 'version' ? ' active' : '')} onClick={() => setTab('version')}><Info /> Version</button>
          )}
          <button className={'modal-tab' + (tab === 'appearance' ? ' active' : '')} onClick={() => setTab('appearance')}><Sun /> Appearance</button>
          <button className={'modal-tab' + (tab === 'chat' ? ' active' : '')} onClick={() => setTab('chat')}><Sliders /> Chat</button>
          <button className={'modal-tab' + (tab === 'usage' ? ' active' : '')} onClick={() => setTab('usage')}><Clock /> Usage</button>
          <button className={'modal-tab' + (tab === 'sessions' ? ' active' : '')} onClick={() => setTab('sessions')}><Shield /> Sessions</button>
          <button className={'modal-tab' + (tab === 'security' ? ' active' : '')} onClick={() => setTab('security')}><Gear /> Security</button>
        </div>
        <div className="modal-main">
          {tab === 'general' && (
            <>
              <h2>General</h2>
              <div className="hint">Your account basics.</div>
              <div className="field">
                <label>What should we call you?</label>
                <input value={name} onChange={(e) => changeName(e.target.value)} />
              </div>
              <div className="field">
                <label>Instructions for Claude</label>
                <div className="muted-note" style={{ marginBottom: 10 }}>Added to the system prompt for every chat. Use it for things to remember about you or how you'd like responses. Leave empty for none.</div>
                <textarea className="instr-area" value={instructions} maxLength={8000} rows={5}
                  placeholder="e.g. I'm a backend developer. Keep answers concise and skip the preamble."
                  onChange={(e) => changeInstructions(e.target.value)} />
                <div className="muted-note" style={{ textAlign: 'right' }}>{instructions.length}/8000</div>
              </div>
              <div className="field row">
                <div><label>Export your chats</label><div className="muted-note">Download every saved chat as a single JSON file.</div></div>
                <button className="btn ghost" onClick={onExportChats}><Download style={{ width: 14, verticalAlign: '-2px' }} /> Export</button>
              </div>
              <div className="field row">
                <div><label>Import chats</label><div className="muted-note">Restore chats from a previously exported JSON file.</div></div>
                <button className="btn ghost" onClick={() => importRef.current?.click()}><Upload style={{ width: 14, verticalAlign: '-2px' }} /> Import</button>
                <input ref={importRef} type="file" accept="application/json" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportChats(f); e.target.value = ''; }} />
              </div>
              <div className="danger-zone">
                  <div className="dz-title">Danger zone</div>
                  {!confirmClear ? (
                    <div className="field row">
                      <div><label>Delete all saved chats</label><div className="muted-note">Removes every chat and its files. Your account stays.</div></div>
                      <button className="btn danger" onClick={() => { setConfirmClear(true); setClearMsg(''); }}>Delete all chats</button>
                    </div>
                  ) : (
                    <div className="dz-confirm">
                      <div className="muted-note" style={{ marginBottom: 10 }}>Delete every saved chat? This can't be undone.</div>
                      <div className="edit-actions">
                        <button className="btn ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
                        <button className="btn danger" onClick={clearChats}>Yes, delete all chats</button>
                      </div>
                    </div>
                  )}
                  {clearMsg && <div className="muted-note" style={{ marginTop: 8 }}>{clearMsg}</div>}
                  {!user.isOwner && (!confirmDel ? (
                    <div className="field row" style={{ marginTop: 14 }}>
                      <div><label>Delete account</label><div className="muted-note">Permanently removes your account, all chats, and files. This cannot be undone.</div></div>
                      <button className="btn danger" onClick={() => setConfirmDel(true)}>Delete account</button>
                    </div>
                  ) : (
                    <div className="dz-confirm" style={{ marginTop: 14 }}>
                      <div className="muted-note" style={{ marginBottom: 10 }}>Are you absolutely sure? This permanently deletes your account and everything in it.</div>
                      {delErr && <div className="dz-err">{delErr}</div>}
                      <div className="edit-actions">
                        <button className="btn ghost" onClick={() => setConfirmDel(false)}>Cancel</button>
                        <button className="btn danger" onClick={deleteAccount}>Yes, delete my account</button>
                      </div>
                    </div>
                  ))}
                </div>
            </>
          )}
          {tab === 'version' && (() => {
            const vp = parseVersion(cfg?.uiVersion || cfg?.version || '');
            const icon = cfg?.uiVersionIcon || cfg?.appIcon || '';
            const notes = (cfg?.uiVersionDesc || '').trim();
            const channel = vp?.channel ? vp.channel[0].toUpperCase() + vp.channel.slice(1) : '';
            return (
              <div className="vh">
                <div className="vh-top">
                  <div className="vh-badge">
                    {icon ? <img src={icon} alt="" /> : <img className="vh-badge-fallback" src="/starburst.svg" alt="" />}
                  </div>
                  <div className="vh-id">
                    <div className="vh-name">{cfg?.appName || 'open-quill'}</div>
                    <div className="vh-version">Version {vp ? vp.full : '—'}</div>
                    {channel && <div className="vh-channel">{channel} channel</div>}
                  </div>
                </div>
                {vp && (
                  <div className="vh-list">
                    <div className="vh-li"><span className="vh-li-k">Release</span><span className="vh-li-v">{vp.base || '—'}</span></div>
                    <div className="vh-li"><span className="vh-li-k">Channel</span><span className="vh-li-v">{channel || 'Stable'}</span></div>
                    {vp.build && <div className="vh-li"><span className="vh-li-k">Build</span><span className="vh-li-v">{vp.build}</span></div>}
                  </div>
                )}
                {notes ? (
                  <div className="vh-notes">
                    <div className="vh-notes-h">What's new</div>
                    <div className="version-desc"><Markdown>{notes}</Markdown></div>
                  </div>
                ) : (
                  <div className="vh-empty">No release notes for this build.</div>
                )}
              </div>
            );
          })()}
          {tab === 'appearance' && (
            <>
              <h2>Appearance</h2>
              <div className="hint">Choose how open-quill looks.</div>
              <div className="field row">
                <div><label>Theme</label><div className="muted-note">Follow your system, or pick one.</div></div>
                <Seg value={prefs.theme || 'system'} onPick={(v) => setPref('theme', v)}
                  options={[{ v: 'system', label: 'System' }, { v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }, { v: 'oled', label: 'OLED' }]} />
              </div>
              <div className="field">
                <label>Accent color</label>
                <div className="muted-note">Tints buttons, links, and highlights throughout the app.</div>
                <div className="accent-row">
                  {ACCENT_PRESETS.map(c => (
                    <button key={c} className={'accent-swatch' + (prefs.accent === c ? ' on' : '')} style={{ background: c }} onClick={() => setPref('accent', c)} title={c} />
                  ))}
                  <label className="accent-swatch custom" title="Custom color">
                    <input type="color" value={prefs.accent || '#d97757'} onChange={(e) => setPref('accent', e.target.value)} />
                    <span>+</span>
                  </label>
                  {prefs.accent && <button className="btn ghost accent-reset" onClick={() => setPref('accent', '')}>Reset</button>}
                </div>
              </div>
              <div className="field row">
                <div><label>Message density</label><div className="muted-note">Vertical spacing between messages.</div></div>
                <Seg value={prefs.density || 'comfortable'} onPick={(v) => setPref('density', v)}
                  options={[{ v: 'comfortable', label: 'Comfortable' }, { v: 'compact', label: 'Compact' }]} />
              </div>
              <div className="field row">
                <div><label>OLED screen protection</label><div className="muted-note">Periodically nudges the interface a few pixels and eases peak brightness to limit burn-in on OLED displays.</div></div>
                <div className={'switch' + (prefs.oledShift ? ' on' : '')} onClick={() => setPref('oledShift', !prefs.oledShift)} />
              </div>
            </>
          )}
          {tab === 'chat' && (() => {
            const rv = prefs.revealMs == null || isNaN(parseInt(prefs.revealMs)) ? 40 : Math.max(0, Math.min(100, parseInt(prefs.revealMs)));
            return (
              <>
                <h2>Chat</h2>
                <div className="hint">How responses look, move, and feel.</div>
                <div className="me-sections" style={{ marginBottom: 14 }}>
                  {[['streaming', 'Streaming'], ['motion', 'Motion'], ['effects', 'Effects']].map(([k, label]) => (
                    <button key={k} className={'me-sec' + (chatSec === k ? ' on' : '')} onClick={() => setChatSec(k)}>{label}</button>
                  ))}
                </div>
                {chatSec === 'streaming' && <>
                  <Toggle prefs={prefs} setPref={setPref} k="animations" label="Typewriter reveal" desc="Reveal each response gradually as it generates, instead of all at once." />
                  {prefs.animations !== false && (
                    <div className="field">
                      <label>Reveal speed</label>
                      <div className="reveal-row">
                        <input type="range" min="0" max="100" step="5" value={rv} onChange={(e) => setPref('revealMs', parseInt(e.target.value))} />
                        <span className="reveal-val">{rv === 0 ? 'Instant' : rv + ' ms'}</span>
                      </div>
                      <div className="muted-note">Delay between reveal steps. Lower is faster; 0 shows responses instantly. Default 40 ms.</div>
                    </div>
                  )}
                  <Toggle prefs={prefs} setPref={setPref} k="autoscroll" label="Auto-scroll" desc="Keep the latest text in view unless you scroll up." />
                  <div className="field row">
                    <div><label>Streaming cursor</label><div className="muted-note">Show a soft cursor at the write position as text streams in.</div></div>
                    <div className={'switch' + (prefs.streamCursor ? ' on' : '')} onClick={() => setPref('streamCursor', !prefs.streamCursor)} />
                  </div>
                  {!!prefs.streamCursor && (
                    <div className="field">
                      <label>Cursor style</label>
                      <div className="seg">
                        <button className={(prefs.cursorStyle || 'block') === 'block' ? 'on' : ''} onClick={() => setPref('cursorStyle', 'block')}>Block</button>
                        <button className={prefs.cursorStyle === 'circle' ? 'on' : ''} onClick={() => setPref('cursorStyle', 'circle')}>Circle</button>
                      </div>
                    </div>
                  )}
                </>}
                {chatSec === 'motion' && <>
                  <div className="field row">
                    <div><label>Message entrance</label><div className="muted-note">Slide new messages into view — yours from the right, replies from the left.</div></div>
                    <div className={'switch' + (prefs.messageEntrance !== false ? ' on' : '')} onClick={() => setPref('messageEntrance', prefs.messageEntrance === false)} />
                  </div>
                  {prefs.messageEntrance !== false && (
                    <Toggle prefs={prefs} setPref={setPref} k="chatStagger" label="Staggered open" desc="When opening a chat, messages assemble into view one after another." />
                  )}
                </>}
                {chatSec === 'effects' && <>
                  <Toggle prefs={prefs} setPref={setPref} k="microFx" label="Micro-interactions" desc="Subtle feedback on hover, copy, and button presses." />
                  <div className="field row">
                    <div><label>Model logo glow</label><div className="muted-note">Soft glow on the model's logo while it generates or thinks, tinted to match.</div></div>
                    <div className={'switch' + (prefs.iconGlow ? ' on' : '')} onClick={() => setPref('iconGlow', !prefs.iconGlow)} />
                  </div>
                  <Toggle prefs={prefs} setPref={setPref} k="composerFx" label="Input bar effects" desc="Attachment animations and press feedback in the message bar." />
                  <div className="field row">
                    <div><label>Input focus ring</label><div className="muted-note">Soft accent ring around the message bar while it's focused.</div></div>
                    <div className={'switch' + (prefs.focusGlow ? ' on' : '')} onClick={() => setPref('focusGlow', !prefs.focusGlow)} />
                  </div>
                </>}
              </>
            );
          })()}
          {tab === 'usage' && (
            <>
              <h2>Usage</h2>
              <div className="hint">Tokens and estimated cost for your account, across every chat.</div>
              <div className="seg" style={{ marginBottom: 14, width: 'fit-content' }}>
                {[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All time']].map(([v, l]) => (
                  <button key={v} className={usageWindow === v ? 'on' : ''} onClick={() => setUsageWindow(v)}>{l}</button>
                ))}
              </div>
              {usageErr && <div className="dz-err">{usageErr}</div>}
              {!usageData && !usageErr && <div className="muted-note">Loading…</div>}
              {usageData && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 18 }}>
                    {[['Total tokens', fmtN(usageData.totals.total)], ['Input', fmtN(usageData.totals.prompt)], ['Output', fmtN(usageData.totals.completion)], ['Est. cost', usageData.totals.cost ? fmtUsd(usageData.totals.cost) : (usageData.totals.costKnown ? '$0.00' : '—')]].map(([lbl, val]) => (
                      <div key={lbl} style={{ border: '1px solid rgba(128,128,128,0.22)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 20, fontWeight: 600 }}>{val}</div>
                        <div className="muted-note" style={{ marginTop: 2 }}>{lbl}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>{fmtN(usageData.totals.generations)} generation{usageData.totals.generations === 1 ? '' : 's'} in this window.</div>
                  {usageData.models.length === 0 ? (
                    <div className="muted-note">No usage recorded yet. Token counts appear here after you chat with a model whose backend reports usage.</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: 'inherit', opacity: 0.6 }}>
                          <th style={{ padding: '6px 8px' }}>Model</th>
                          <th style={{ padding: '6px 8px', textAlign: 'right' }}>Input</th>
                          <th style={{ padding: '6px 8px', textAlign: 'right' }}>Output</th>
                          <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageData.models.map((m, i) => (
                          <tr key={i} style={{ borderTop: '1px solid rgba(128,128,128,0.18)' }}>
                            <td style={{ padding: '8px' }}>{m.modelName}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{fmtN(m.prompt)}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{fmtN(m.completion)}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{m.priced ? fmtUsd(m.cost) : <span className="muted-note">no price</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="muted-note" style={{ marginTop: 14 }}>Cost is estimated from per-model prices set by your admin. Models marked "no price" are local or free, so no cost is counted. Token counts come from your model backend and may be unavailable for some providers.</div>
                </>
              )}
            </>
          )}
          {tab === 'sessions' && (
            <>
              <h2>Sessions</h2>
              <div className="hint">Devices currently signed in to your account. Sessions expire after 30 days of inactivity.</div>
              {sessionErr && <div className="dz-err">{sessionErr}</div>}
              {!sessions && !sessionErr && <div className="muted-note">Loading…</div>}
              {sessions && (
                <>
                  {sessions.map(s => (
                    <div className="field row" key={s.id} style={{ alignItems: 'center' }}>
                      <div>
                        <label>{deviceLabel(s.userAgent)} on {osLabel(s.userAgent)} {s.current && <span className="you-tag">this device</span>}</label>
                        <div className="muted-note">{s.ip ? s.ip + ' • ' : ''}active {fmtWhen(s.lastSeen)} • signed in {fmtWhen(s.createdAt)}</div>
                      </div>
                      {!s.current && <button className="btn danger" onClick={() => revokeSession(s.id)}>Revoke</button>}
                    </div>
                  ))}
                  {sessions.filter(s => !s.current).length > 0 && (
                    <div className="danger-zone">
                      <div className="dz-title">Sign out everywhere else</div>
                      <div className="field row">
                        <div><label>Revoke all other sessions</label><div className="muted-note">Keeps this device signed in and ends every other session.</div></div>
                        <button className="btn danger" onClick={revokeOthers}>Revoke others</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {tab === 'security' && (
            <>
              <h2>Security</h2>
              <div className="hint">Change your password and manage two-factor authentication.</div>
              <div className="field"><label>Change password</label>
                <input type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw(p => ({ ...p, current: e.target.value }))} style={{ marginBottom: 8 }} />
                <input type="password" placeholder="New password" value={pw.next} onChange={(e) => setPw(p => ({ ...p, next: e.target.value }))} style={{ marginBottom: 8 }} />
                <input type="password" placeholder="Confirm new password" value={pw.confirm} onChange={(e) => setPw(p => ({ ...p, confirm: e.target.value }))} style={{ marginBottom: 8 }} />
                {pwErr && <div className="dz-err">{pwErr}</div>}
                {pwMsg && <div className="muted-note" style={{ color: 'var(--accent)' }}>{pwMsg}</div>}
                <button className="btn" onClick={changePassword} disabled={!pw.current || !pw.next}>Update password</button>
              </div>
              <div className="danger-zone" style={{ borderColor: 'var(--border-soft)' }}>
                <div className="dz-title" style={{ color: 'var(--text)' }}>Two-factor authentication {twoFa === 'on' && <span className="you-tag">enabled</span>}</div>
                {secErr && <div className="dz-err">{secErr}</div>}
                {recovery && (
                  <div className="recovery-box">
                    <div className="muted-note" style={{ marginBottom: 8 }}>Save these recovery codes somewhere safe. Each works once if you lose your authenticator. They will not be shown again.</div>
                    <div className="recovery-grid">{recovery.map(c => <code key={c}>{c}</code>)}</div>
                  </div>
                )}
                {twoFa === 'off' && !setup && (
                  <>
                    <div className="muted-note" style={{ marginBottom: 8 }}>Add a time-based one-time code from an authenticator app (Aegis, Google Authenticator, 1Password, and so on) as a second step at login.</div>
                    <button className="btn" onClick={start2fa}>Set up two-factor</button>
                  </>
                )}
                {twoFa === 'off' && setup && (
                  <>
                    <div className="muted-note" style={{ marginBottom: 8 }}>In your authenticator app, add an account using this key, then enter the 6-digit code it shows.</div>
                    <div className="field"><label className="sub">Secret key</label><code className="totp-secret">{setup.secret}</code></div>
                    <div className="field"><label className="sub">Or paste this setup URL</label><code className="totp-uri">{setup.otpauth}</code></div>
                    <input placeholder="123456" inputMode="numeric" value={setupCode} onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ marginBottom: 8, maxWidth: 160 }} />
                    <div className="edit-actions">
                      <button className="btn ghost" onClick={() => { setSetup(null); setSetupCode(''); }}>Cancel</button>
                      <button className="btn primary" onClick={confirm2fa} disabled={setupCode.length !== 6}>Verify & enable</button>
                    </div>
                  </>
                )}
                {twoFa === 'on' && (
                  <>
                    <div className="muted-note" style={{ marginBottom: 8 }}>Enter your password to regenerate recovery codes or turn off two-factor.</div>
                    <input type="password" placeholder="Password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} style={{ marginBottom: 8, maxWidth: 240 }} />
                    <div className="edit-actions">
                      <button className="btn ghost" onClick={regenRecovery} disabled={!disablePw}>Regenerate recovery codes</button>
                      <button className="btn danger" onClick={disable2fa} disabled={!disablePw}>Disable two-factor</button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          {tab !== 'version' && tab !== 'usage' && tab !== 'sessions' && tab !== 'security' && (
            <div className="autosave-note">
              <span className={'autosave-dot' + (saved ? ' flash' : '')} />
              {saved ? 'Saved' : 'Changes save automatically'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
