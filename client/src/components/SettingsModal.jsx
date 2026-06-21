import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api.js';
import { applyPrefs, ACCENT_PRESETS } from '../prefs.js';
import { Sun, Moon, Gear, Sliders, Info, Chevron, Clock } from './icons.jsx';
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

export default function SettingsModal({ user, cfg, onClose, onUpdated, onDeleted }) {
  const [tab, setTab] = useState('general');
  const [chatSec, setChatSec] = useState('streaming');
  const [name, setName] = useState(user.displayName);
  const [prefs, setPrefs] = useState({ animations: true, autoscroll: true, theme: 'system', accent: '', density: 'comfortable', messageEntrance: true, streamCursor: false, cursorStyle: 'block', revealMs: 40, chatStagger: true, themeFade: true, microFx: true, composerFx: true, iconGlow: false, focusGlow: false, oledShift: false, ...user.prefs });
  const [saved, setSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delErr, setDelErr] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearMsg, setClearMsg] = useState('');
  const saveTimer = useRef(null);
  const [usageData, setUsageData] = useState(null);
  const [usageErr, setUsageErr] = useState('');
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  useEffect(() => {
    if (tab !== 'usage') return;
    let alive = true; setUsageErr('');
    api.get('/api/me/usage').then(d => { if (alive) setUsageData(d); }).catch(() => { if (alive) setUsageErr('Could not load usage.'); });
    return () => { alive = false; };
  }, [tab]);
  const fmtN = (n) => Number(n || 0).toLocaleString();
  const fmtUsd = (n) => { const v = Number(n || 0); if (!v) return '$0.00'; return '$' + (v < 0.01 ? v.toFixed(6) : v.toFixed(4)); };

  function scheduleSave(nextName, nextPrefs) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const { user: u } = await api.patch('/api/me', { displayName: nextName, prefs: nextPrefs });
        onUpdated(u);
        setSaved(true); setTimeout(() => setSaved(false), 1300);
      } catch {}
    }, 450);
  }
  function changeName(v) { setName(v); scheduleSave(v, prefs); }

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
          {tab === 'version' && (
            <>
              <h2>Version</h2>
              <div className="hint">About this build.</div>
              <div className="version-card">
                {cfg?.uiVersionIcon ? <img className="version-icon" src={cfg.uiVersionIcon} alt="" /> : <div className="version-icon placeholder" />}
                <div className="version-meta">
                  <div className="version-name">{cfg?.appName || 'open-quill'}</div>
                  <div className="version-num">Version {cfg?.uiVersion || cfg?.version || '—'}</div>
                </div>
              </div>
              {(cfg?.uiVersionDesc || '').trim() && (
                <div className="version-desc"><Markdown>{cfg.uiVersionDesc}</Markdown></div>
              )}
            </>
          )}
          {tab === 'appearance' && (
            <>
              <h2>Appearance</h2>
              <div className="hint">Choose how open-quill looks.</div>
              <div className="field row">
                <div><label>Theme</label><div className="muted-note">Follow your system, or pick one.</div></div>
                <Seg value={prefs.theme || 'system'} onPick={(v) => setPref('theme', v)}
                  options={[{ v: 'system', label: 'System' }, { v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }, { v: 'anthropic', label: 'Anthropic' }]} />
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
              {usageErr && <div className="dz-err">{usageErr}</div>}
              {!usageData && !usageErr && <div className="muted-note">Loading…</div>}
              {usageData && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 18 }}>
                    {[['Total tokens', fmtN(usageData.totals.total)], ['Input', fmtN(usageData.totals.prompt)], ['Output', fmtN(usageData.totals.completion)], ['Est. cost', fmtUsd(usageData.totals.cost)]].map(([lbl, val]) => (
                      <div key={lbl} style={{ border: '1px solid rgba(128,128,128,0.22)', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 20, fontWeight: 600 }}>{val}</div>
                        <div className="muted-note" style={{ marginTop: 2 }}>{lbl}</div>
                      </div>
                    ))}
                  </div>
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
                            <td style={{ padding: '8px', textAlign: 'right' }}>{fmtUsd(m.cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="muted-note" style={{ marginTop: 14 }}>Cost is estimated from per-model prices set by your admin. Token counts come from your model backend and may be unavailable for some providers.</div>
                </>
              )}
            </>
          )}
          {tab !== 'version' && tab !== 'usage' && (
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
