import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { Cube, Sliders, Plus, Trash, Users, Sparkles, Chevron } from './icons.jsx';
import { QP_ICON_LIST, QpIcon } from '../qpIcons.jsx';

function QpIconPicker({ value, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="qp-iconpick" ref={ref}>
      <button type="button" className="qp-iconbtn" onClick={() => setOpen(o => !o)} title="Choose an icon">
        {value && value !== 'none' ? <QpIcon name={value} style={{ width: 16, height: 16 }} /> : <span className="qp-iconnone">—</span>}
      </button>
      {open && (
        <div className="qp-iconmenu">
          {QP_ICON_LIST.map(name => (
            <button type="button" key={name} className={'qp-iconopt' + (name === (value || 'none') ? ' on' : '')}
              onClick={() => { onPick(name); setOpen(false); }} title={name}>
              {name === 'none' ? <span className="qp-iconnone">—</span> : <QpIcon name={name} style={{ width: 16, height: 16 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

function SystemPromptEditor({ value, onChange, onClose }) {
  const taRef = useRef(null);
  const dt = '{{currentDateTime}}';
  const cu = '{{currentUser}}';
  function insert(token) {
    const ta = taRef.current;
    const v = value || '';
    if (!ta) { onChange(v + token); return; }
    const s = ta.selectionStart ?? v.length, e = ta.selectionEnd ?? v.length;
    const next = v.slice(0, s) + token + v.slice(e);
    onChange(next);
    requestAnimationFrame(() => { ta.focus(); const p = s + token.length; ta.setSelectionRange(p, p); });
  }
  return (
    <div className="overlay sp-overlay" onMouseDown={(e) => e.target.classList.contains('sp-overlay') && onClose()}>
      <div className="sp-modal">
        <div className="sp-head">
          <div>
            <h3>System prompt</h3>
            <div className="muted-note">Define how this model behaves. Variables below are filled in locally on each message.</div>
          </div>
          <button className="modal-close" style={{ position: 'static' }} onClick={onClose}>✕</button>
        </div>
        <div className="sp-vars">
          <button className="sp-chip" onClick={() => insert(dt)}><code>{dt}</code> Insert local date &amp; time</button>
          <button className="sp-chip" onClick={() => insert(cu)}><code>{cu}</code> Insert the user's name</button>
        </div>
        <textarea ref={taRef} className="sp-text" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="You are a helpful assistant…" autoFocus />
        <div className="sp-tips">
          <div className="sp-tip"><b>{dt}</b> — replaced with the current date and time from this device, in your local timezone.</div>
          <div className="sp-tip"><b>{cu}</b> — replaced with the signed-in user's name. Everything stays on your machine.</div>
        </div>
        <div className="sp-foot">
          <span className="muted-note">Edits save to your draft automatically.</span>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ModelEditor({ m, onChange, onDelete, autosaveState }) {
  const [section, setSection] = useState('general');
  const [spOpen, setSpOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState('');
  const set = (k, v) => onChange({ ...m, [k]: v });
  async function detect() {
    setDetecting(true); setDetectMsg('');
    try {
      const r = await api.get('/api/admin/detect-ctx?model=' + encodeURIComponent(m.internal_name || ''));
      if (r.ok && r.numCtx) { set('num_ctx', r.numCtx); setDetectMsg('Detected ' + r.numCtx.toLocaleString() + ' tokens.'); }
      else setDetectMsg('Could not detect from the server — enter it manually.');
    } catch { setDetectMsg('Could not detect from the server — enter it manually.'); }
    setDetecting(false);
  }
  const Toggle = ({ k, label, note, inverted }) => (
    <div className="field row">
      <div><label>{label}</label>{note && <div className="muted-note">{note}</div>}</div>
      <div className={'switch' + ((inverted ? m[k] !== 0 : !!m[k]) ? ' on' : '')} onClick={() => set(k, (inverted ? m[k] !== 0 : !!m[k]) ? 0 : 1)} />
    </div>
  );
  const sections = [
    ['general', 'General'], ['reasoning', 'Reasoning'], ['capabilities', 'Capabilities'],
    ['context', 'Context'], ['appearance', 'Appearance'], ['sampling', 'Sampling']
  ];
  return (
    <div className="model-editor">
      <div className="me-head">
        <div className="me-title">
          <span className="mc-title">{m.display_name || 'Untitled model'}</span>
          <span className="mc-sub">{m.internal_name}</span>
        </div>
        <button className="btn danger" onClick={() => onDelete(m.id)}><Trash style={{ width: 15 }} /></button>
      </div>
      <div className="me-sections">
        {sections.map(([k, label]) => (
          <button key={k} className={'me-sec' + (section === k ? ' on' : '')} onClick={() => setSection(k)}>{label}</button>
        ))}
      </div>
      <div className="me-body">
        {section === 'general' && <>
          <div className="two-col">
            <div className="field"><label>Model name (shown in dropdown)</label>
              <input value={m.display_name || ''} onChange={(e) => set('display_name', e.target.value)} /></div>
            <div className="field"><label>Internal model name (API id)</label>
              <input value={m.internal_name || ''} onChange={(e) => set('internal_name', e.target.value)} /></div>
          </div>
          <div className="field"><label>Description</label>
            <input value={m.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="For complex tasks" /></div>
          <div className="field"><label>System prompt</label>
            <button type="button" className="sp-preview" onClick={() => setSpOpen(true)}>
              {(m.system_prompt || '').trim()
                ? <><div className="sp-preview-text">{m.system_prompt}</div><div className="sp-preview-fade" /></>
                : <div className="sp-preview-empty">Click to write a system prompt…</div>}
              <div className="sp-preview-hint">Click to edit</div>
            </button>
          </div>
          {spOpen && <SystemPromptEditor value={m.system_prompt || ''} onChange={(v) => set('system_prompt', v)} onClose={() => setSpOpen(false)} />}
          <Toggle k="in_more_models" label={'Tuck under "More models"'} note="Hidden from the main list" />
          {!!m.in_more_models && (
            <div className="field"><label>More-models label</label>
              <input value={m.more_models_label || ''} onChange={(e) => set('more_models_label', e.target.value)} placeholder="Other models" /></div>
          )}
          <Toggle k="is_default" label="Default model" note="Pre-selected when a user first logs in. Only one model can be the default." />
          <Toggle k="unavailable" label="Mark as unavailable" note="Keeps the model in the dropdown but blocks clients from using it, with a banner. Admins can still use it for testing." />
          {!!m.unavailable && (
            <div className="field"><label>Unavailable reason <span className="muted-note" style={{ display: 'inline' }}>(shown in the banner's “Learn more”)</span></label>
              <textarea rows={3} value={m.unavailable_reason || ''} onChange={(e) => set('unavailable_reason', e.target.value)} placeholder="e.g. Down for maintenance — back shortly. Use Quillku 2 in the meantime." /></div>
          )}
        </>}
        {section === 'reasoning' && <>
          <Toggle k="has_reasoning" label="Model has reasoning capability" note="Enables the Extended button" />
          {!!m.has_reasoning && <>
            <div className="two-col">
              <div className="field"><label>Reasoning token</label>
                <input value={m.reasoning_token || ''} onChange={(e) => set('reasoning_token', e.target.value)} /></div>
              <div className="field"><label>Non-reasoning token</label>
                <input value={m.non_reasoning_token || ''} onChange={(e) => set('non_reasoning_token', e.target.value)} /></div>
            </div>
            <div className="muted-note">Tokens are appended to the end of the system prompt on a new line.</div>
          </>}
          <div className="two-col" style={{ marginTop: 12 }}>
            <div className="field"><label>Thinking open tag</label>
              <input value={m.think_open || ''} onChange={(e) => set('think_open', e.target.value)} placeholder="<think>" /></div>
            <div className="field"><label>Thinking close tag</label>
              <input value={m.think_close || ''} onChange={(e) => set('think_close', e.target.value)} placeholder="</think>" /></div>
          </div>
          <div className="muted-note">Override the tags used to detect inline reasoning in the stream. Leave blank to use the default {'<think>…</think>'}.</div>
        </>}
        {section === 'capabilities' && <>
          <Toggle k="has_vision" label="Vision supported" note="Allow image uploads (sent to the model). Off = files only." />
          <div className="cap-icons-block">
            <label>Dropdown capability icons</label>
            <div className="muted-note" style={{ marginBottom: 8 }}>Small icons shown to the right of this model in the picker. Each is independent — off by default.</div>
            <Toggle k="cap_text" label="Text-Only icon" note="T icon — indicates the model takes text input only." />
            <Toggle k="cap_vision" label="Vision icon" note="Vison icon — indicates the model accepts images." />
            <Toggle k="cap_reasoning" label="Reasoning icon" note="Brain icon — indicates the model can reason." />
            <Toggle k="cap_compact" label="Compact capabilities" note="Collapse the icons into a single ⓘ that reveals the capabilities on hover." />
          </div>
          <Toggle k="sandbox_allowed" inverted label="Sandbox tools available" note="Allow users to enable sandbox tools for this model. If off, sandbox can't be turned on." />
          {m.sandbox_allowed !== 0 && <Toggle k="sandbox_auto" label="Sandbox tools auto-enabled" note="Start new chats with this model in sandbox mode." />}
          <div className="field"><label>Agent step cap</label>
            <input type="number" min="1" value={m.agent_steps ?? 10} onChange={(e) => set('agent_steps', e.target.value)} style={{ maxWidth: 140 }} />
            <div className="muted-note">Max tool rounds per response (default 10, no upper limit).</div>
          </div>
        </>}
        {section === 'context' && <>
          <Toggle k="enable_summaries" label="Enable conversation summaries" note="Compact older turns when the chat nears the context window so it can keep going." />
          {!!m.enable_summaries && <>
            <div className="field"><label>Context window (tokens)</label>
              <div className="ctx-row">
                <input type="number" min="0" value={m.num_ctx ?? ''} onChange={(e) => set('num_ctx', e.target.value)} placeholder="e.g. 32768" />
                <button className="btn" type="button" onClick={detect} disabled={detecting}>{detecting ? 'Detecting…' : 'Detect'}</button>
              </div>
              <div className="muted-note">{detectMsg || 'The model’s max context. Detect tries LM Studio; otherwise enter it manually.'}</div>
            </div>
            <div className="field"><label>Safety padding (fraction)</label>
              <input type="number" step="0.01" min="0.03" max="0.6" value={m.summary_padding ?? 0.125} onChange={(e) => set('summary_padding', e.target.value)} style={{ maxWidth: 140 }} />
              <div className="muted-note">Summarize when the conversation reaches (1 − padding) × context. 0.125 leaves 12.5% headroom.</div>
            </div>
          </>}
        </>}
        {section === 'appearance' && <>
          <div className="field"><label>Model logos</label>
            <div className="icon-grid">
              <IconSlot label="Static" value={m.static_icon} def="/starburst.svg" onChange={(v) => set('static_icon', v)} />
              <IconSlot label="Generating" value={m.generating_icon} def="/starburst-generating.svg" anim={(m.generating_anim || 'spin') === 'none' ? '' : (m.generating_anim || 'spin')} onChange={(v) => set('generating_icon', v)} />
              <IconSlot label="Thinking" value={m.thinking_icon} def="/starburst-thinking.svg" anim={(m.thinking_anim || 'pulse') === 'none' ? '' : (m.thinking_anim || 'pulse')} onChange={(v) => set('thinking_icon', v)} />
            </div>
            <div className="icon-grid anim-row">
              <div />
              <select className="anim-sel" value={m.generating_anim || 'spin'} onChange={(e) => set('generating_anim', e.target.value)}>
                <option value="spin">Spin</option><option value="pulse">Breathe</option><option value="bounce">Bounce</option><option value="wobble">Wobble</option><option value="fade">Fade</option><option value="none">No motion</option>
              </select>
              <select className="anim-sel" value={m.thinking_anim || 'pulse'} onChange={(e) => set('thinking_anim', e.target.value)}>
                <option value="pulse">Breathe</option><option value="spin">Spin</option><option value="bounce">Bounce</option><option value="wobble">Wobble</option><option value="fade">Fade</option><option value="none">No motion</option>
              </select>
            </div>
            <div className="muted-note">Click an icon to upload a png, svg, jpeg, or gif. Previews animate as they will in chat.</div>
          </div>
          <Toggle k="dropdown_icon" inverted label="Show icon in model dropdown" note="Display this model's static icon next to its name in the model picker." />
          <div className="field">
            <label>Model icon position</label>
            <div className="seg">
              <button className={(m.icon_position || 'below') === 'above' ? 'on' : ''} onClick={() => set('icon_position', 'above')}>Above text</button>
              <button className={(m.icon_position || 'below') === 'below' ? 'on' : ''} onClick={() => set('icon_position', 'below')}>Below text</button>
            </div>
            <div className="muted-note">Where the logo sits relative to the message it generates.</div>
          </div>
        </>}
        {section === 'sampling' && <>
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
        </>}
      </div>
      <div className="btn-row me-foot">
        <span className="autosave-status">
          {autosaveState === 'saving' ? 'Saving…' : autosaveState === 'saved' ? 'All changes saved to draft ✓' : 'Edits save automatically to your draft'}
        </span>
      </div>
    </div>
  );
}

export default function AdminPanel({ user, onClose }) {
  const [tab, setTab] = useState('models');
  const [models, setModels] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [cfg, setCfg] = useState({ appName: '', disclaimer: '', greetings: [''], appIcon: '', quickPrompts: [] });
  const [cfgSaved, setCfgSaved] = useState(false);
  const [settings, setSettings] = useState({ apiBaseUrl: '', apiKey: '', uploadLimitAdminMb: 8, uploadLimitUserMb: 8, sandboxLimitAdminMb: 1024, sandboxLimitUserMb: 256, modelQueue: false });
  const [selModel, setSelModel] = useState(null);
  const [setSavedFlash, setSetSaved] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const [ask, setAsk] = useState(null); // { message, danger, onConfirm }
  const [autosave, setAutosave] = useState('idle'); // idle | saving | saved
  const [pub, setPub] = useState({ dirty: false, publishedAt: null });
  const [publishing, setPublishing] = useState(false);
  const [pubFlash, setPubFlash] = useState(false);
  const saveTimers = useRef({});
  const pendingIds = useRef(new Set());
  const selModelRef = useRef(null);
  const dragIndex = useRef(null);
  const modelsRef = useRef([]);
  useEffect(() => { modelsRef.current = models; }, [models]);
  useEffect(() => { selModelRef.current = selModel; }, [selModel]);

  useEffect(() => {
    async function onConfig() {
      try {
        const fresh = await api.get('/api/admin/models');
        setModels(cur => fresh.map(fm => (pendingIds.current.has(fm.id) ? (cur.find(c => c.id === fm.id) || fm) : fm)));
        refreshPubState();
      } catch {}
    }
    window.addEventListener('oq-config', onConfig);
    return () => window.removeEventListener('oq-config', onConfig);
  }, []);

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
  async function refreshPubState() { try { setPub(await api.get('/api/admin/models/publish-state')); } catch {} }
  useEffect(() => { load(); refreshPubState(); }, []);

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

  function change(updated) {
    setModels(ms => ms.map(m => {
      if (m.id === updated.id) return updated;
      if (updated.is_default && m.is_default) return { ...m, is_default: 0 };
      return m;
    }));
    setAutosave('saving');
    pendingIds.current.add(updated.id);
    clearTimeout(saveTimers.current[updated.id]);
    saveTimers.current[updated.id] = setTimeout(async () => {
      try {
        await api.patch('/api/admin/models/' + updated.id, updated);
        setAutosave('saved');
        setPub(p => ({ ...p, dirty: true }));
        setTimeout(() => setAutosave(s => s === 'saved' ? 'idle' : s), 1600);
      } catch { setAutosave('idle'); }
      finally { pendingIds.current.delete(updated.id); }
    }, 500);
  }
  async function add() {
    const { id } = await api.post('/api/admin/models', { display_name: 'New model', internal_name: 'local-model' });
    await load(); setSelModel(id); setPub(p => ({ ...p, dirty: true }));
  }
  async function publish() {
    setPublishing(true);
    try {
      const r = await api.post('/api/admin/models/publish', {});
      setPub({ dirty: false, published: true, publishedAt: r.publishedAt });
      setPubFlash(true); setTimeout(() => setPubFlash(false), 2200);
    } finally { setPublishing(false); }
  }
  function del(id) {
    setAsk({
      message: 'Delete this model? This cannot be undone.', danger: 'Delete model',
      onConfirm: async () => { await api.del('/api/admin/models/' + id); setModels(ms => ms.filter(m => m.id !== id)); setSelModel(s => s === id ? null : s); setPub(p => ({ ...p, dirty: true })); }
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
      setPub(p => ({ ...p, dirty: true }));
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
          {tab === 'models' && (() => {
            const sel = models.find(x => x.id === selModel) || models[0] || null;
            return (
              <>
                <div className="models-head">
                  <div>
                    <h2>Models</h2>
                    <div className="hint">Edits save to your draft automatically and only you (and other admins) see them. Use <strong>Push to all Clients</strong> to make them live for everyone.</div>
                  </div>
                  <div className="publish-area">
                    <button className={'btn primary push-btn' + (pub.dirty ? ' dirty' : '')} onClick={publish} disabled={publishing || (!pub.dirty && pub.published)}>
                      {publishing ? 'Pushing…' : 'Push to all Clients'}
                    </button>
                    {pubFlash
                      ? <span className="saved-flash">Pushed to all clients ✓</span>
                      : pub.dirty
                        ? <span className="pub-note dirty">Unpublished draft changes</span>
                        : <span className="pub-note">{pub.published ? 'Clients are up to date' : 'Nothing published yet'}</span>}
                  </div>
                </div>
                <div className="models-split">
                  <div className="models-list">
                    {models.map((m, i) => (
                      <div key={m.id}
                        className={'model-row' + (sel && sel.id === m.id ? ' active' : '') + (drag.dragging === i ? ' dragging' : '') + (drag.over === i ? ' drag-over' : '')}
                        draggable onDragStart={() => drag.onStart(i)} onDragEnd={drag.onEnd}
                        onDragOver={(e) => { e.preventDefault(); drag.onOver(i); }}
                        onDrop={(e) => { e.preventDefault(); drag.onDrop(i); }}
                        onClick={() => setSelModel(m.id)}>
                        <span className="grip"><Grip /></span>
                        <div className="mr-meta">
                          <span className="mr-name">{m.display_name || 'Untitled model'}</span>
                          <span className="mr-sub">{m.internal_name}</span>
                        </div>
                        <span className="mr-badges">
                          {!!m.is_default && <span className="mr-badge">default</span>}
                          {!!m.unavailable && <span className="mr-badge warn">unavailable</span>}
                          {!!m.in_more_models && <span className="mr-badge dim">hidden</span>}
                        </span>
                      </div>
                    ))}
                    <button className="btn add-model" onClick={add}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> Add model</button>
                  </div>
                  <div className="models-detail">
                    {sel
                      ? <ModelEditor key={sel.id} m={sel} onChange={change} onDelete={del} autosaveState={autosave} />
                      : <div className="muted-note" style={{ padding: 20 }}>No models yet — add one to get started.</div>}
                  </div>
                </div>
              </>
            );
          })()}
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
                    <QpIconPicker value={q.icon || 'none'} onPick={(name) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, icon: name } : x) }))} />
                    <input className="qp-label" value={q.label || ''} placeholder="Button label" onChange={(e) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                    <input className="qp-prompt" value={q.prompt || ''} placeholder="Prompt sent when clicked" onChange={(e) => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.map((x, j) => j === i ? { ...x, prompt: e.target.value } : x) }))} />
                    <button className="btn danger" onClick={() => setCfg(c => ({ ...c, quickPrompts: c.quickPrompts.filter((_, j) => j !== i) }))}><Trash style={{ width: 14 }} /></button>
                  </div>
                ))}
                {(cfg.quickPrompts || []).length < 8 && <button className="btn" style={{ marginTop: 8 }} onClick={() => setCfg(c => ({ ...c, quickPrompts: [...(c.quickPrompts || []), { icon: 'none', label: '', prompt: '' }] }))}><Plus style={{ width: 14, verticalAlign: '-2px' }} /> Add button</button>}
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
              <div className="field"><label>Upload size limit (MB)</label>
                <div className="muted-note">Max size for files attached to messages, per role. 0 = unlimited.</div>
                <div className="two-col">
                  <div className="field"><label className="sub">Admins</label>
                    <input type="number" min="0" step="1" value={settings.uploadLimitAdminMb ?? 8} onChange={(e) => setSettings(s => ({ ...s, uploadLimitAdminMb: e.target.value }))} placeholder="8" /></div>
                  <div className="field"><label className="sub">Users</label>
                    <input type="number" min="0" step="1" value={settings.uploadLimitUserMb ?? 8} onChange={(e) => setSettings(s => ({ ...s, uploadLimitUserMb: e.target.value }))} placeholder="8" /></div>
                </div></div>
              <div className="field"><label>Sandbox storage limit (MB)</label>
                <div className="muted-note">Max total size of a chat's sandbox files, per role. Writes beyond it are rejected. 0 = unlimited.</div>
                <div className="two-col">
                  <div className="field"><label className="sub">Admins</label>
                    <input type="number" min="0" step="1" value={settings.sandboxLimitAdminMb ?? 1024} onChange={(e) => setSettings(s => ({ ...s, sandboxLimitAdminMb: e.target.value }))} placeholder="1024" /></div>
                  <div className="field"><label className="sub">Users</label>
                    <input type="number" min="0" step="1" value={settings.sandboxLimitUserMb ?? 256} onChange={(e) => setSettings(s => ({ ...s, sandboxLimitUserMb: e.target.value }))} placeholder="256" /></div>
                </div></div>
              <div className="field row">
                <div><label>Model queue</label><div className="muted-note">Only one model runs at a time. Requests for the same model run together; a request for a different model waits until the current one finishes, instead of swapping it out mid-response. Useful for local servers that load a single model.</div></div>
                <div className={'switch' + (settings.modelQueue ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, modelQueue: !s.modelQueue }))} /></div>
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
