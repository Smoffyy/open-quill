import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { Cube, Sliders, Plus, Trash, Chevron, Users, Sparkles } from './icons.jsx';

const Grip = (p) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" {...p}>
    <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
    <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
  </svg>
);

function IconSlot({ label, value, def, anim, onChange }) {
  const ref = useRef(null);
  async function pick(e) {
    const f = e.target.files?.[0]; if (!f) return;
    const { url } = await api.upload(f);
    onChange(url); e.target.value = '';
  }
  return (
    <div className="icon-slot">
      <div className="preview-wrap">
        <button type="button" className="preview" onClick={() => ref.current?.click()} title="Click to upload (png, svg, jpeg, gif)">
          <img src={value || def} className={anim} alt="" />
        </button>
        {value && (
          <button type="button" className="reset-icon" title="Reset to default logo" onClick={() => onChange('')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        )}
      </div>
      <input ref={ref} type="file" hidden onChange={pick}
        accept=".png,.svg,.jpg,.jpeg,.gif,image/png,image/svg+xml,image/jpeg,image/gif" />
      <div className="up">{label}</div>
    </div>
  );
}

function ModelCard({ m, index, onChange, onSave, onDelete, saved, drag }) {
  const [open, setOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState('');
  const set = (k, v) => onChange({ ...m, [k]: v });
  async function detect() {
    setDetecting(true); setDetectMsg('');
    try {
      const r = await api.get('/api/admin/detect-ctx?model=' + encodeURIComponent(m.internal_name || ''));
      if (r.ok && r.numCtx) { set('num_ctx', r.numCtx); setDetectMsg('Detected ' + r.numCtx.toLocaleString() + ' tokens. Remember to save.'); }
      else setDetectMsg('Could not detect from the server — enter it manually.');
    } catch { setDetectMsg('Could not detect from the server — enter it manually.'); }
    setDetecting(false);
  }
  return (
    <div className={'model-card' + (drag.dragging === index ? ' dragging' : '') + (drag.over === index ? ' drag-over' : '')}
      onDragOver={(e) => { e.preventDefault(); drag.onOver(index); }}
      onDrop={(e) => { e.preventDefault(); drag.onDrop(index); }}>
      <div className="model-card-head"
        draggable onDragStart={() => drag.onStart(index)} onDragEnd={drag.onEnd}
        onClick={() => setOpen(o => !o)}>
        <span className="grip" onClick={(e) => e.stopPropagation()}><Grip /></span>
        <Chevron className={'mc-chev' + (open ? ' open' : '')} style={{ width: 16 }} />
        <div className="mc-left">
          <span className="mc-title">{m.display_name || 'Untitled model'}</span>
          <span className="mc-sub">{m.internal_name}</span>
        </div>
        <button className="btn danger" onClick={(e) => { e.stopPropagation(); onDelete(m.id); }}><Trash style={{ width: 15 }} /></button>
      </div>

      {open && (
        <div className="model-card-body">
          <div className="two-col">
            <div className="field"><label>Model name (shown in dropdown)</label>
              <input value={m.display_name} onChange={(e) => set('display_name', e.target.value)} /></div>
            <div className="field"><label>Internal model name (API id)</label>
              <input value={m.internal_name} onChange={(e) => set('internal_name', e.target.value)} /></div>
          </div>
          <div className="field"><label>Description</label>
            <input value={m.description} onChange={(e) => set('description', e.target.value)} /></div>
          <div className="field"><label>System prompt</label>
            <textarea value={m.system_prompt} onChange={(e) => set('system_prompt', e.target.value)} /></div>

          <div className="field row">
            <div><label>Tuck under "More models"</label><div className="muted-note">Hidden from the main list</div></div>
            <div className={'switch' + (m.in_more_models ? ' on' : '')} onClick={() => set('in_more_models', m.in_more_models ? 0 : 1)} />
          </div>
          {!!m.in_more_models && (
            <div className="field"><label>More-models label</label>
              <input value={m.more_models_label} onChange={(e) => set('more_models_label', e.target.value)} /></div>
          )}

          <div className="field row">
            <div><label>Model has reasoning capability</label><div className="muted-note">Enables the Extended button</div></div>
            <div className={'switch' + (m.has_reasoning ? ' on' : '')} onClick={() => set('has_reasoning', m.has_reasoning ? 0 : 1)} />
          </div>
          {!!m.has_reasoning && (
            <div className="two-col">
              <div className="field"><label>Reasoning token</label>
                <input value={m.reasoning_token} onChange={(e) => set('reasoning_token', e.target.value)} placeholder="/think" /></div>
              <div className="field"><label>Non-reasoning token</label>
                <input value={m.non_reasoning_token} onChange={(e) => set('non_reasoning_token', e.target.value)} placeholder="/no_think" /></div>
            </div>
          )}
          <div className="muted-note">Tokens are appended to the end of the system prompt on a new line.</div>

          <div className="two-col" style={{ marginTop: 12 }}>
            <div className="field"><label>Thinking open tag</label>
              <input value={m.think_open || ''} onChange={(e) => set('think_open', e.target.value)} placeholder="<think>" /></div>
            <div className="field"><label>Thinking close tag</label>
              <input value={m.think_close || ''} onChange={(e) => set('think_close', e.target.value)} placeholder="</think>" /></div>
          </div>
          <div className="muted-note">Override the tags used to detect inline reasoning in the stream. Leave blank to use the default {'<think>…</think>'}.</div>

          <div className="field row">
            <div><label>Vision supported</label><div className="muted-note">Allow image uploads (sent to the model). Off = files only.</div></div>
            <div className={'switch' + (m.has_vision ? ' on' : '')} onClick={() => set('has_vision', m.has_vision ? 0 : 1)} />
          </div>

          <div className="field row">
            <div><label>Sandbox tools available</label><div className="muted-note">Allow users to enable sandbox tools for this model. If off, sandbox can't be turned on.</div></div>
            <div className={'switch' + (m.sandbox_allowed !== 0 ? ' on' : '')} onClick={() => set('sandbox_allowed', m.sandbox_allowed !== 0 ? 0 : 1)} />
          </div>
          {m.sandbox_allowed !== 0 && (
            <div className="field row">
              <div><label>Sandbox tools auto-enabled</label><div className="muted-note">Start new chats with this model in sandbox mode.</div></div>
              <div className={'switch' + (m.sandbox_auto ? ' on' : '')} onClick={() => set('sandbox_auto', m.sandbox_auto ? 0 : 1)} />
            </div>
          )}
          <div className="field"><label>Agent step cap</label>
            <input type="number" min="1" max="30" value={m.agent_steps ?? 10} onChange={(e) => set('agent_steps', parseInt(e.target.value) || 10)} />
            <div className="muted-note">Max tool rounds per response (default 10).</div>
          </div>

          <div className="field row">
            <div><label>Enable conversation summaries</label><div className="muted-note">Compact older turns when the chat nears the context window so it can keep going.</div></div>
            <div className={'switch' + (m.enable_summaries ? ' on' : '')} onClick={() => set('enable_summaries', m.enable_summaries ? 0 : 1)} />
          </div>
          {!!m.enable_summaries && (
            <>
              <div className="field"><label>Context window (tokens)</label>
                <div className="ctx-row">
                  <input type="number" min="0" value={m.num_ctx ?? 0} onChange={(e) => set('num_ctx', parseInt(e.target.value) || 0)} placeholder="e.g. 8192" />
                  <button className="btn" type="button" onClick={detect} disabled={detecting}>{detecting ? 'Detecting…' : 'Detect'}</button>
                </div>
                <div className="muted-note">{detectMsg || 'The model’s max context. Detect tries LM Studio; otherwise enter it manually.'}</div>
              </div>
              <div className="field"><label>Safety padding (fraction)</label>
                <input type="number" step="0.005" min="0.03" max="0.6" value={m.summary_padding ?? 0.125} onChange={(e) => set('summary_padding', parseFloat(e.target.value) || 0.125)} />
                <div className="muted-note">
                  {m.num_ctx ? `Summarizes when usage passes ${Math.floor(m.num_ctx * (1 - (m.summary_padding || 0.125))).toLocaleString()} tokens` : 'Set a context window above'} (= context × (1 − padding)). Default 0.125 = 1/8.
                </div>
              </div>
            </>
          )}

          <div className="field" style={{ marginTop: 14 }}><label>Model logos</label>
            <div className="icon-grid">
              <IconSlot label="Static" value={m.static_icon} def="/starburst.svg" anim="" onChange={(v) => set('static_icon', v)} />
              <IconSlot label="Generating" value={m.generating_icon} def="/starburst-generating.svg" anim="spin" onChange={(v) => set('generating_icon', v)} />
              <IconSlot label="Thinking" value={m.thinking_icon} def="/starburst-thinking.svg" anim="pulse" onChange={(v) => set('thinking_icon', v)} />
            </div>
            <div className="muted-note">Click an icon to upload a png, svg, jpeg, or gif. Previews animate as they will in chat.</div>
          </div>

          <div className="field row">
            <div><label>Show icon in model dropdown</label><div className="muted-note">Display this model's static icon next to its name in the model picker.</div></div>
            <div className={'switch' + (m.dropdown_icon !== 0 ? ' on' : '')} onClick={() => set('dropdown_icon', m.dropdown_icon !== 0 ? 0 : 1)} />
          </div>

          <div className="field"><label>Sampling parameters</label>
            <div className="muted-note">Override what's sent to the API. Leave blank to use the server/model default. Non-standard params (top_k, min_p, repetition_penalty) apply on servers that support them, e.g. LM Studio.</div>
            <div className="sampling-grid">
              {[
                ['temperature', 'Temperature', '0.0 – 2.0'], ['top_p', 'Top P', '0.0 – 1.0'],
                ['top_k', 'Top K', 'e.g. 40'], ['min_p', 'Min P', '0.0 – 1.0'],
                ['repetition_penalty', 'Repetition penalty', 'e.g. 1.1'], ['presence_penalty', 'Presence penalty', '-2.0 – 2.0'],
                ['frequency_penalty', 'Frequency penalty', '-2.0 – 2.0'], ['seed', 'Seed', 'integer']
              ].map(([k, label, ph]) => (
                <div className="samp-field" key={k}>
                  <label>{label}</label>
                  <input type="number" step="any" placeholder={ph} value={m[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Model icon position</label>
            <div className="seg">
              <button className={(m.icon_position || 'below') === 'above' ? 'on' : ''} onClick={() => set('icon_position', 'above')}>Above text</button>
              <button className={(m.icon_position || 'below') === 'below' ? 'on' : ''} onClick={() => set('icon_position', 'below')}>Below text</button>
            </div>
            <div className="muted-note">Where the logo sits relative to the message it generates.</div>
          </div>

          <div className="btn-row">
            <button className="btn primary" onClick={() => onSave(m)}>Save</button>
            {saved === m.id && <span className="saved-flash" style={{ alignSelf: 'center' }}>Saved — pushed to all clients ✓</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel({ user, onClose }) {
  const [tab, setTab] = useState('models');
  const [models, setModels] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [cfg, setCfg] = useState({ appName: '', disclaimer: '', greetings: [''], appIcon: '', quickPrompts: [] });
  const [cfgSaved, setCfgSaved] = useState(false);
  const [settings, setSettings] = useState({ apiBaseUrl: '', apiKey: '' });
  const [saved, setSaved] = useState(null);
  const [setSavedFlash, setSetSaved] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const [ask, setAsk] = useState(null); // { message, danger, onConfirm }
  const dragIndex = useRef(null);
  const modelsRef = useRef([]);
  useEffect(() => { modelsRef.current = models; }, [models]);

  async function load() {
    setModels(await api.get('/api/admin/models'));
    setSettings(await api.get('/api/admin/settings'));
    try {
      const c = await api.get('/api/app-config');
      setCfg({ appName: c.appName || '', disclaimer: c.disclaimer || '', greetings: c.greetings?.length ? c.greetings : [''], appIcon: c.appIcon || '', quickPrompts: Array.isArray(c.quickPrompts) ? c.quickPrompts : [] });
    } catch {}
    loadUsers();
  }
  async function loadUsers() { try { setUsersList(await api.get('/api/admin/users')); } catch {} }
  useEffect(() => { load(); }, []);

  async function saveCfg() {
    await api.patch('/api/admin/app-config', { ...cfg, greetings: cfg.greetings.map(g => g.trim()).filter(Boolean), quickPrompts: (cfg.quickPrompts || []).filter(q => (q.label || '').trim() && (q.prompt || '').trim()) });
    setCfgSaved(true); setTimeout(() => setCfgSaved(false), 1600);
  }

  async function setRole(id, isAdmin) {
    await api.patch('/api/admin/users/' + id, { isAdmin });
    setUsersList(us => us.map(u => u.id === id ? { ...u, isAdmin } : u));
  }
  function removeUser(id) {
    setAsk({
      message: 'Remove this user and all their chats? This cannot be undone.', danger: 'Remove user',
      onConfirm: async () => { await api.del('/api/admin/users/' + id); setUsersList(us => us.filter(u => u.id !== id)); }
    });
  }

  function change(updated) { setModels(ms => ms.map(m => m.id === updated.id ? updated : m)); }
  async function save(m) { await api.patch('/api/admin/models/' + m.id, m); setSaved(m.id); setTimeout(() => setSaved(null), 1800); }
  async function add() {
    const { id } = await api.post('/api/admin/models', { display_name: 'New model', internal_name: 'local-model' });
    await load(); setSaved(id);
  }
  function del(id) {
    setAsk({
      message: 'Delete this model? This cannot be undone.', danger: 'Delete model',
      onConfirm: async () => { await api.del('/api/admin/models/' + id); setModels(ms => ms.filter(m => m.id !== id)); }
    });
  }
  async function saveSettings() {
    await api.patch('/api/admin/settings', settings);
    setSetSaved(true); setTimeout(() => setSetSaved(false), 1500);
  }

  const drag = {
    dragging: dragIndex.current, over: dragOver,
    onStart: (i) => { dragIndex.current = i; },
    onOver: (i) => setDragOver(i),
    onEnd: () => { dragIndex.current = null; setDragOver(null); },
    onDrop: (to) => {
      const from = dragIndex.current; dragIndex.current = null; setDragOver(null);
      if (from == null || from === to) return;
      const arr = modelsRef.current.slice();
      const [item] = arr.splice(from, 1); arr.splice(to, 0, item);
      setModels(arr);
      api.post('/api/admin/models/reorder', { ids: arr.map(m => m.id) }).catch(() => {});
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="modal" style={{ position: 'relative' }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-side">
          <div className="ms-label">Admin Panel</div>
          <button className={'modal-tab' + (tab === 'models' ? ' active' : '')} onClick={() => setTab('models')}><Cube /> Models</button>
          <button className={'modal-tab' + (tab === 'customization' ? ' active' : '')} onClick={() => setTab('customization')}><Sparkles /> Customization</button>
          <button className={'modal-tab' + (tab === 'users' ? ' active' : '')} onClick={() => setTab('users')}><Users /> Users</button>
          <button className={'modal-tab' + (tab === 'connection' ? ' active' : '')} onClick={() => setTab('connection')}><Sliders /> Connection</button>
        </div>
        <div className="modal-main">
          {tab === 'models' && (
            <>
              <h2>Models</h2>
              <div className="hint">Drag to reorder. Changes save instantly and push to every connected client in real time.</div>
              {models.map((m, i) => <ModelCard key={m.id} m={m} index={i} onChange={change} onSave={save} onDelete={del} saved={saved} drag={drag} />)}
              <button className="btn" onClick={add}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> Add model</button>
            </>
          )}
          {tab === 'customization' && (
            <>
              <h2>Customization</h2>
              <div className="hint">Brand the app. Changes save instantly and push to every connected client.</div>
              <div className="field"><label>App name</label>
                <input value={cfg.appName} onChange={(e) => setCfg(c => ({ ...c, appName: e.target.value }))} placeholder="open-quill" /></div>
              <div className="field"><label>Bottom disclaimer</label>
                <input value={cfg.disclaimer} onChange={(e) => setCfg(c => ({ ...c, disclaimer: e.target.value }))} placeholder="Assistants can make mistakes, double-check responses." /></div>
              <div className="field">
                <label>Greetings <span className="muted-note" style={{ display: 'inline' }}>(one is shown at random each visit)</span></label>
                {cfg.greetings.map((g, i) => (
                  <div key={i} className="greeting-row">
                    <input value={g} onChange={(e) => setCfg(c => ({ ...c, greetings: c.greetings.map((x, j) => j === i ? e.target.value : x) }))} placeholder="How can I help you?" />
                    <button className="btn danger" onClick={() => setCfg(c => ({ ...c, greetings: c.greetings.filter((_, j) => j !== i).length ? c.greetings.filter((_, j) => j !== i) : [''] }))}><Trash style={{ width: 14 }} /></button>
                  </div>
                ))}
                <button className="btn" style={{ marginTop: 8 }} onClick={() => setCfg(c => ({ ...c, greetings: [...c.greetings, ''] }))}><Plus style={{ width: 14, verticalAlign: '-2px' }} /> Add greeting</button>
              </div>
              <div className="field">
                <label>Quick prompt buttons <span className="muted-note" style={{ display: 'inline' }}>(shown under the input on the home screen; clicking sends the prompt)</span></label>
                {(cfg.quickPrompts || []).map((q, i) => (
                  <div key={i} className="qp-row">
                    <input className="qp-emoji" value={q.icon || ''} maxLength={4} placeholder="🔮" onChange={(e) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, icon: e.target.value } : x) }))} />
                    <input className="qp-label" value={q.label || ''} placeholder="Button label" onChange={(e) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                    <input className="qp-prompt" value={q.prompt || ''} placeholder="Prompt sent when clicked" onChange={(e) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, prompt: e.target.value } : x) }))} />
                    <button className="btn danger" onClick={() => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.filter((_, j) => j !== i) }))}><Trash style={{ width: 14 }} /></button>
                  </div>
                ))}
                {(cfg.quickPrompts || []).length < 8 && <button className="btn" style={{ marginTop: 8 }} onClick={() => setCfg(c => ({ ...c, quickPrompts: [...(c.quickPrompts || []), { icon: '', label: '', prompt: '' }] }))}><Plus style={{ width: 14, verticalAlign: '-2px' }} /> Add button</button>}
              </div>
              <div className="field"><label>App icon (browser tab + greeting)</label>
                <div className="icon-grid" style={{ gridTemplateColumns: '1fr' }}>
                  <IconSlot label="Click to upload (png, svg, jpeg, gif)" value={cfg.appIcon} def="/starburst.svg" anim="" onChange={(v) => setCfg(c => ({ ...c, appIcon: v }))} />
                </div>
              </div>
              <div className="btn-row">
                <button className="btn primary" onClick={saveCfg}>Save</button>
                {cfgSaved && <span className="saved-flash" style={{ alignSelf: 'center' }}>Saved — pushed to all clients ✓</span>}
              </div>
            </>
          )}
          {tab === 'users' && (
            <>
              <h2>Users</h2>
              <div className="hint">Everyone who has signed in. Toggle admin rights or remove accounts.</div>
              {usersList.map(u => (
                <div className="user-row" key={u.id}>
                  <div className="avatar">{(u.displayName || u.email)[0].toUpperCase()}</div>
                  <div className="u-main">
                    <div className="u-name">{u.displayName}{u.isOwner && <span className="badge">Top admin</span>}{u.id === user?.id && !u.isOwner && <span className="you-tag">you</span>}</div>
                    <div className="u-email">{u.email}</div>
                  </div>
                  {!u.isOwner && (
                    <div className="seg">
                      <button className={u.isAdmin ? '' : 'on'} onClick={() => setRole(u.id, false)}>User</button>
                      <button className={u.isAdmin ? 'on' : ''} onClick={() => setRole(u.id, true)}>Admin</button>
                    </div>
                  )}
                  {!u.isOwner && u.id !== user?.id && (
                    <button className="btn danger" onClick={() => removeUser(u.id)}><Trash style={{ width: 15 }} /></button>
                  )}
                </div>
              ))}
            </>
          )}
          {tab === 'connection' && (
            <>
              <h2>Connection</h2>
              <div className="hint">Point this at any OpenAI-compatible server (LM Studio, llama.cpp, vLLM, etc.).</div>
              <div className="field"><label>API base URL</label>
                <input value={settings.apiBaseUrl || ''} onChange={(e) => setSettings(s => ({ ...s, apiBaseUrl: e.target.value }))} placeholder="http://localhost:1234/v1" /></div>
              <div className="field"><label>API key</label>
                <input value={settings.apiKey || ''} onChange={(e) => setSettings(s => ({ ...s, apiKey: e.target.value }))} placeholder="lm-studio" /></div>
              <div className="btn-row">
                <button className="btn primary" onClick={saveSettings}>Save</button>
                {setSavedFlash && <span className="saved-flash" style={{ alignSelf: 'center' }}>Saved ✓</span>}
              </div>
            </>
          )}
        </div>
      </div>
      {ask && (
        <div className="confirm-overlay" onMouseDown={(e) => e.target.classList.contains('confirm-overlay') && setAsk(null)}>
          <div className="confirm-box">
            <div className="confirm-msg">{ask.message}</div>
            <div className="confirm-actions">
              <button className="btn" onClick={() => setAsk(null)}>Cancel</button>
              <button className="btn danger-solid" onClick={async () => { const fn = ask.onConfirm; setAsk(null); await fn(); }}>{ask.danger || 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
