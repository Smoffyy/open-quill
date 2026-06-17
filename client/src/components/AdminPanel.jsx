import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { Cube, Sliders, Plus, Trash, Users, Sparkles, Chevron, Shield, Globe } from './icons.jsx';
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

function Toggle({ m, set, k, label, note, inverted }) {
  const on = inverted ? m[k] !== 0 : !!m[k];
  return (
    <div className="field row">
      <div><label>{label}</label>{note && <div className="muted-note">{note}</div>}</div>
      <div className={'switch' + (on ? ' on' : '')} onClick={() => set(k, on ? 0 : 1)} />
    </div>
  );
}

function Accordion({ title, sub, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={'me-acc' + (open ? ' open' : '')}>
      <button type="button" className="me-acc-head" onClick={() => setOpen(o => !o)}>
        <span className="me-acc-titles"><span className="me-acc-title">{title}</span>{sub && <span className="me-acc-sub">{sub}</span>}</span>
        <Chevron className="me-acc-chev" />
      </button>
      {open && <div className="me-acc-body">{children}</div>}
    </div>
  );
}

function ModelEditor({ m, onChange, onDelete, autosaveState, providers = [], providerTypes = {} }) {
  const [spOpen, setSpOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState('');
  const set = (k, v) => onChange({ ...m, [k]: v });
  const curProvider = providers.find(p => p.id === m.provider_id) || providers[0];
  const curType = curProvider ? providerTypes[curProvider.type] : null;
  const allowedSamplers = curType?.samplers || ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'];
  async function detect() {
    setDetecting(true); setDetectMsg('');
    try {
      const r = await api.get('/api/admin/detect-ctx?model=' + encodeURIComponent(m.internal_name || '') + '&provider=' + encodeURIComponent(m.provider_id || ''));
      if (r.ok && r.numCtx) { set('num_ctx', r.numCtx); setDetectMsg('Detected ' + r.numCtx.toLocaleString() + ' tokens.'); }
      else setDetectMsg('Could not detect from the server — enter it manually.');
    } catch { setDetectMsg('Could not detect from the server — enter it manually.'); }
    setDetecting(false);
  }
  return (
    <div className="model-editor">
      <div className="me-head">
        <div className="me-title">
          <img className="me-title-icon" src={m.static_icon || '/starburst.svg'} alt="" />
          <span className="mc-title">{m.display_name || 'Untitled model'}</span>
          <span className="mc-sub">{m.internal_name}</span>
        </div>
        <button className="btn danger" onClick={() => onDelete(m.id)}><Trash style={{ width: 15 }} /></button>
      </div>
      <div className="me-body">
        <div className="me-essentials">
          <div className="two-col">
            <div className="field"><label>Display name</label>
              <input value={m.display_name || ''} onChange={(e) => set('display_name', e.target.value)} /></div>
            <div className="field"><label>Model ID</label>
              <input value={m.internal_name || ''} onChange={(e) => set('internal_name', e.target.value)} placeholder="llama-3.1-8b-instruct" /></div>
          </div>
          <div className="field"><label>Provider</label>
            <select value={m.provider_id || (providers[0]?.id || '')} onChange={(e) => set('provider_id', e.target.value)}>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name} ({providerTypes[p.type]?.label || p.type})</option>)}
            </select>
            <div className="muted-note">The connection this model runs through. Add or edit providers in the Providers tab.</div>
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
          <Toggle m={m} set={set} k="is_default" label="Set as default" note="Pre-selected for users on first login. Only one model can be the default." />
          <Toggle m={m} set={set} k="has_reasoning" label="Extended thinking" note="Adds the Extended toggle so users can request deeper reasoning. Configure it under Reasoning below." />
          <div className="field row">
            <div><label>Hidden</label><div className="muted-note">Stays in your admin list but is removed from every user's model picker.</div></div>
            <div className={'switch' + (!m.enabled ? ' on' : '')} onClick={() => set('enabled', m.enabled ? 0 : 1)} />
          </div>
        </div>

        <Accordion title="Visibility & access" sub="Grouping and availability">
          <Toggle m={m} set={set} k="in_more_models" label={'Group under "More models"'} note="Moves the model out of the main list into a collapsible group." />
          {!!m.in_more_models && (
            <div className="field"><label>Group label</label>
              <input value={m.more_models_label || ''} onChange={(e) => set('more_models_label', e.target.value)} placeholder="More models" /></div>
          )}
          <Toggle m={m} set={set} k="unavailable" label="Temporarily unavailable" note="The model stays visible in the picker but users can't select it, and a banner explains why. Admins can still use it for testing." />
          {!!m.unavailable && (
            <div className="field"><label>Unavailability message <span className="muted-note" style={{ display: 'inline' }}>(shown in the banner's “Learn more”)</span></label>
              <textarea rows={3} value={m.unavailable_reason || ''} onChange={(e) => set('unavailable_reason', e.target.value)} placeholder="e.g. Down for maintenance — back shortly. Use Quillku 2 in the meantime." /></div>
          )}
        </Accordion>

        <Accordion title="Reasoning" sub="Mode triggers, output tags & visibility">
          {!!m.has_reasoning && <>
            <div className="two-col">
              <div className="field"><label>Extended-mode trigger</label>
                <input value={m.reasoning_token || ''} onChange={(e) => set('reasoning_token', e.target.value)} placeholder="/think" /></div>
              <div className="field"><label>Standard-mode trigger</label>
                <input value={m.non_reasoning_token || ''} onChange={(e) => set('non_reasoning_token', e.target.value)} placeholder="/no_think" /></div>
            </div>
            <div className="muted-note">Appended to the system prompt, on its own line, depending on whether the user has Extended turned on.</div>
          </>}
          <div className="two-col" style={{ marginTop: 12 }}>
            <div className="field"><label>Reasoning start tag</label>
              <input value={m.think_open || ''} onChange={(e) => set('think_open', e.target.value)} placeholder="<think>" /></div>
            <div className="field"><label>Reasoning end tag</label>
              <input value={m.think_close || ''} onChange={(e) => set('think_close', e.target.value)} placeholder="</think>" /></div>
          </div>
          <div className="muted-note">How the model delimits its reasoning in the output stream. Leave blank to use the default {'<think>…</think>'}.</div>
          <div style={{ marginTop: 14 }}>
            <Toggle m={m} set={set} k="reasoning_collapsible" inverted label="Show reasoning to users" note="When on, users can expand and read the thought process. When off, they see only a 'Thinking…' status." />
          </div>
        </Accordion>

        <Accordion title="Capabilities & tools" sub="Image input, sandbox, picker badges">
          <Toggle m={m} set={set} k="has_vision" label="Image input" note="Let users attach images for the model to see. Off = non-image files only." />
          <Toggle m={m} set={set} k="sandbox_allowed" inverted label="Allow sandbox tools" note="Lets users enable code and file tools for this model. Off means sandbox can't be turned on." />
          {m.sandbox_allowed !== 0 && <Toggle m={m} set={set} k="sandbox_auto" label="Enable sandbox by default" note="New chats with this model start with sandbox tools on." />}
          <div className="field"><label>Tool-call limit</label>
            <input type="number" min="0" value={m.agent_steps || ''} placeholder="Unlimited" onChange={(e) => set('agent_steps', e.target.value)} style={{ maxWidth: 140 }} />
            <div className="muted-note">Maximum tool rounds per response. Leave blank or 0 for unlimited.</div>
          </div>
          <div className="cap-icons-block">
            <label>Picker badges</label>
            <div className="muted-note" style={{ marginBottom: 8 }}>Cosmetic labels shown beside the model in the picker. They don't change behaviour — set them to reflect the model's real capabilities.</div>
            <Toggle m={m} set={set} k="cap_text" label="Text-only badge" note="Marks the model as accepting text input only." />
            <Toggle m={m} set={set} k="cap_vision" label="Image badge" note="Marks the model as accepting images." />
            <Toggle m={m} set={set} k="cap_reasoning" label="Reasoning badge" note="Marks the model as able to reason." />
            <Toggle m={m} set={set} k="cap_compact" label="Combine into a single badge" note="Collapse the badges into one ⓘ that reveals them on hover." />
          </div>
        </Accordion>

        <Accordion title="Context management" sub="Auto-summarize long conversations">
          <Toggle m={m} set={set} k="enable_summaries" label="Auto-summarize long chats" note="When a conversation nears the context window, older turns are compacted into a summary so it can keep going." />
          {!!m.enable_summaries && <>
            <div className="field"><label>Context window</label>
              <div className="ctx-row">
                <input type="number" min="0" value={m.num_ctx ?? ''} onChange={(e) => set('num_ctx', e.target.value)} placeholder="e.g. 32768" />
                <button className="btn" type="button" onClick={detect} disabled={detecting}>{detecting ? 'Detecting…' : 'Detect'}</button>
              </div>
              <div className="muted-note">{detectMsg || 'The model\u2019s maximum context in tokens. Detect asks the provider; otherwise enter it manually.'}</div>
            </div>
            <div className="field"><label>Context headroom <span className="muted-note" style={{ display: 'inline' }}>(%)</span></label>
              <input type="number" step="1" min="3" max="60" value={Math.round((m.summary_padding ?? 0.125) * 100)} onChange={(e) => set('summary_padding', (parseFloat(e.target.value) || 0) / 100)} style={{ maxWidth: 140 }} />
              <div className="muted-note">Summarize once the chat fills past this much of the context window's free space. 12% leaves a safety margin before the limit.</div>
            </div>
          </>}
        </Accordion>

        <Accordion title="Appearance" sub="Logos, icon size & position">
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
          <div className="field">
            <label>Icon size <span className="muted-note" style={{ display: 'inline' }}>{(m.icon_size || 40)}px</span></label>
            <div className="icon-size-row">
              <input type="range" min="14" max="64" value={m.icon_size || 40} onChange={(e) => set('icon_size', parseInt(e.target.value))} />
              <button className="btn ghost icon-size-reset" disabled={!m.icon_size} onClick={() => set('icon_size', 0)}>Reset</button>
            </div>
            <div className="muted-note">Size of the model's icon shown beside its messages. Default is 40px. Legacy is 26px.</div>
          </div>
          <Toggle m={m} set={set} k="dropdown_icon" inverted label="Show logo in picker" note="Display this model's static logo next to its name in the model picker." />
          <div className="field">
            <label>Logo position</label>
            <div className="seg">
              <button className={(m.icon_position || 'below') === 'above' ? 'on' : ''} onClick={() => set('icon_position', 'above')}>Above text</button>
              <button className={(m.icon_position || 'below') === 'below' ? 'on' : ''} onClick={() => set('icon_position', 'below')}>Below text</button>
            </div>
            <div className="muted-note">Where the logo sits relative to the message it generates.</div>
          </div>
        </Accordion>

        <Accordion title="Sampling" sub={curType ? curType.label : 'Provider parameters'}>
          <div className="muted-note">Optional overrides sent with each request. Leave a field blank to use the provider's default. Only parameters supported by {curType?.label || 'this provider'} are shown.</div>
          <div className="sampling-grid">
            {[
              ['temperature', 'Temperature', '0.0 \u2013 2.0'], ['top_p', 'Top P', '0.0 \u2013 1.0'],
              ['top_k', 'Top K', 'e.g. 40'], ['min_p', 'Min P', '0.0 \u2013 1.0'],
              ['repetition_penalty', 'Repetition penalty', 'e.g. 1.1'], ['presence_penalty', 'Presence penalty', '-2.0 \u2013 2.0'],
              ['frequency_penalty', 'Frequency penalty', '-2.0 \u2013 2.0'], ['seed', 'Seed', 'integer'],
              ['max_tokens', 'Max tokens', 'e.g. 2048']
            ].filter(([k]) => allowedSamplers.includes(k)).map(([k, label, ph]) => (
              <div className="samp-field" key={k}>
                <label>{label}</label>
                <input type="number" step="any" placeholder={ph} value={m[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
          </div>
        </Accordion>
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
  const [providers, setProviders] = useState([]);
  const [providerTypes, setProviderTypes] = useState({});
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
  const readyRef = useRef(false);
  const setSaveTimer = useRef(null);
  const cfgSaveTimer = useRef(null);
  const [setAutoStatus, setSetAutoStatus] = useState('idle');
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
    try { const p = await api.get('/api/admin/providers'); setProviders(p.providers || []); setProviderTypes(p.types || {}); } catch {}
    try {
      const c = await api.get('/api/app-config');
      setCfg({ appName: c.appName || '', disclaimer: c.disclaimer || '', greetings: c.greetings?.length ? c.greetings : [''], appIcon: c.appIcon || '', quickPrompts: Array.isArray(c.quickPrompts) ? c.quickPrompts : [] });
    } catch {}
    loadUsers();
  }
  async function loadUsers() { try { setUsersList(await api.get('/api/admin/users')); } catch {} }
  async function refreshPubState() { try { setPub(await api.get('/api/admin/models/publish-state')); } catch {} }
  useEffect(() => { load().then(() => { readyRef.current = true; }); refreshPubState(); }, []);

  useEffect(() => {
    if (!readyRef.current) return;
    if (setSaveTimer.current) clearTimeout(setSaveTimer.current);
    setSetAutoStatus('saving');
    setSaveTimer.current = setTimeout(async () => {
      try { await api.patch('/api/admin/settings', settings); setPub(p => ({ ...p, dirty: true })); setSetAutoStatus('saved'); }
      catch { setSetAutoStatus('idle'); }
    }, 500);
  }, [settings]);

  useEffect(() => {
    if (!readyRef.current) return;
    if (cfgSaveTimer.current) clearTimeout(cfgSaveTimer.current);
    setSetAutoStatus('saving');
    cfgSaveTimer.current = setTimeout(async () => {
      try { await api.patch('/api/admin/app-config', { ...cfg, greetings: cfg.greetings.map(g => g.trim()).filter(Boolean), quickPrompts: (cfg.quickPrompts || []).filter(q => (q.label || '').trim() && (q.prompt || '').trim()) }); setPub(p => ({ ...p, dirty: true })); setSetAutoStatus('saved'); }
      catch { setSetAutoStatus('idle'); }
    }, 500);
  }, [cfg]);

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
  const [discover, setDiscover] = useState(null);
  async function openDiscover(providerId) {
    const pid = (typeof providerId === 'string' && providerId) ? providerId : (providers[0]?.id || '');
    setDiscover({ loading: true, error: '', list: [], providerId: pid });
    try {
      const r = await api.get('/api/admin/discover-models?provider=' + encodeURIComponent(pid));
      setDiscover({ loading: false, error: '', list: r.models || [], providerId: pid });
    } catch (e) { setDiscover({ loading: false, error: e?.message || 'Could not reach the backend.', list: [], providerId: pid }); }
  }
  async function addDiscovered(id) {
    setDiscover(d => d ? { ...d, list: d.list.map(x => x.id === id ? { ...x, busy: true } : x) } : d);
    await api.post('/api/admin/models', { display_name: id, internal_name: id, provider_id: discover?.providerId || (providers[0]?.id || undefined) });
    await load();
    setDiscover(d => d ? { ...d, list: d.list.map(x => x.id === id ? { ...x, added: true, busy: false } : x) } : d);
    setPub(p => ({ ...p, dirty: true }));
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
  async function reloadProviders() {
    try { const p = await api.get('/api/admin/providers'); setProviders(p.providers || []); setProviderTypes(p.types || {}); } catch {}
  }
  async function addProvider() {
    await api.post('/api/admin/providers', { type: 'lmstudio' });
    await reloadProviders();
  }
  async function patchProvider(id, patch) {
    setProviders(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
    await api.patch('/api/admin/providers/' + id, patch);
  }
  async function deleteProvider(id) {
    try { await api.del('/api/admin/providers/' + id); await reloadProviders(); await load(); }
    catch (e) { setAsk({ message: e?.message || 'Could not delete provider.', onConfirm: () => setAsk(null) }); }
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
    <div className="admin-page">
      <nav className="admin-rail">
        <div className="ar-brand">Admin Panel</div>
        <button className={'ar-tab' + (tab === 'models' ? ' active' : '')} onClick={() => setTab('models')}><Cube /> Models</button>
        <button className={'ar-tab' + (tab === 'providers' ? ' active' : '')} onClick={() => setTab('providers')}><Sliders /> Providers</button>
        <button className={'ar-tab' + (tab === 'customization' ? ' active' : '')} onClick={() => setTab('customization')}><Sparkles /> Appearance</button>
        <button className={'ar-tab' + (tab === 'users' ? ' active' : '')} onClick={() => setTab('users')}><Users /> Users</button>
        <button className={'ar-tab' + (tab === 'limits' ? ' active' : '')} onClick={() => setTab('limits')}><Shield /> Limits &amp; Safety</button>
        <button className={'ar-tab' + (tab === 'websearch' ? ' active' : '')} onClick={() => setTab('websearch')}><Globe /> Web Search</button>
        <button className="ar-back" onClick={onClose}><Chevron style={{ transform: 'rotate(90deg)', width: 16 }} /> Back to chat</button>
      </nav>
      <div className="admin-content">
        <header className="admin-topbar">
          <div className="atb-status">
            {pubFlash
              ? <span className="saved-flash">Pushed to all clients ✓</span>
              : pub.dirty
                ? <span className="pub-note dirty">Unpublished draft changes</span>
                : <span className="pub-note">{pub.published ? 'Clients are up to date' : 'Nothing published yet'}</span>}
          </div>
          <button className={'btn primary push-btn' + (pub.dirty ? ' dirty' : '')} onClick={publish} disabled={publishing || (!pub.dirty && pub.published)}>
            {publishing ? 'Pushing…' : 'Push to all clients'}
          </button>
        </header>
        <div className={'admin-body' + (tab === 'models' ? ' wide' : '')}>
          {tab === 'models' && (() => {
            const sel = models.find(x => x.id === selModel) || models[0] || null;
            if (!models.length) return (
              <div className="admin-empty">
                <div className="ae-icon"><Cube style={{ width: 30 }} /></div>
                <h2>Add your first model</h2>
                <p>Models are what users pick in the chat. Each one points at a provider (your LLM backend) and carries its own prompt, sampling, and capabilities.</p>
                <div className="ae-actions">
                  <button className="btn primary" onClick={add}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> Add model</button>
                  <button className="btn ghost" onClick={() => openDiscover(providers[0]?.id)}><Cube style={{ width: 14, verticalAlign: '-2px' }} /> Discover from a provider</button>
                </div>
                <div className="ae-hint">No provider set up yet? Head to the <button className="linklike" onClick={() => setTab('providers')}>Providers</button> tab first.</div>
              </div>
            );
            return (
              <>
                <div className="models-head">
                  <div>
                    <h2>Models</h2>
                    <div className="hint">Edits save to your draft automatically and only you (and other admins) see them. Use <strong>Push to all clients</strong> (top right) to make them live for everyone.</div>
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
                        <img className="mr-icon" src={m.static_icon || '/starburst.svg'} alt="" />
                        <div className="mr-meta">
                          <span className="mr-name">{m.display_name || 'Untitled model'}</span>
                          <span className="mr-sub">{m.internal_name}</span>
                        </div>
                        <span className="mr-badges">
                          {!!m.is_default && <span className="mr-badge">default</span>}
                          {!m.enabled && <span className="mr-badge dim">hidden</span>}
                          {!!m.unavailable && <span className="mr-badge warn">unavailable</span>}
                          {!!m.in_more_models && <span className="mr-badge dim">grouped</span>}
                        </span>
                      </div>
                    ))}
                    <button className="btn add-model" onClick={add}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> Add model</button>
                    <button className="btn ghost discover-btn" onClick={openDiscover}><Cube style={{ width: 14, verticalAlign: '-2px' }} /> Discover from backend</button>
                  </div>
                  <div className="models-detail">
                    {sel
                      ? <ModelEditor key={sel.id} m={sel} onChange={change} onDelete={del} autosaveState={autosave} providers={providers} providerTypes={providerTypes} />
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
              <div className="settings-autosave">
                <span className={'autosave-dot' + (setAutoStatus === 'saved' ? ' flash' : '')} />
                {setAutoStatus === 'saving' ? 'Saving…' : setAutoStatus === 'saved' ? 'Saved to draft — use Push to all clients to make it live' : 'Changes save automatically to your draft'}
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
          {tab === 'providers' && (
            <>
              <h2>Providers</h2>
              <div className="hint">Add one or more providers. Each model runs through the provider you assign it (in the model's General tab).</div>
              <div className="provider-list">
                {providers.map(p => {
                  const t = providerTypes[p.type] || {};
                  return (
                    <div className="provider-card" key={p.id}>
                      <div className="two-col">
                        <div className="field"><label>Name</label>
                          <input value={p.name || ''} onChange={(e) => patchProvider(p.id, { name: e.target.value })} placeholder="My provider" /></div>
                        <div className="field"><label>Provider type</label>
                          <select value={p.type} onChange={(e) => patchProvider(p.id, { type: e.target.value })}>
                            {Object.entries(providerTypes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select></div>
                      </div>
                      <div className="field"><label>API base URL</label>
                        <input value={p.base_url || ''} onChange={(e) => patchProvider(p.id, { base_url: e.target.value })} placeholder={t.defaultBaseUrl || ''} /></div>
                      <div className="field"><label>API key {t.keyOptional && <span className="muted-note" style={{ display: 'inline' }}>(optional)</span>}</label>
                        <input value={p.api_key || ''} onChange={(e) => patchProvider(p.id, { api_key: e.target.value })} placeholder={t.keyOptional ? 'Not required for local servers' : 'Required'} /></div>
                      <div className="btn-row">
                        <button className="btn ghost" onClick={() => openDiscover(p.id)}><Cube style={{ width: 13, verticalAlign: '-2px' }} /> Discover models</button>
                        <button className="btn danger" disabled={providers.length <= 1} onClick={() => deleteProvider(p.id)}><Trash style={{ width: 13 }} /></button>
                      </div>
                    </div>
                  );
                })}
                <button className="btn add-model" onClick={addProvider}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> Add provider</button>
              </div>
            </>
          )}
          {tab === 'limits' && (
            <>
              <h2>Limits &amp; Safety</h2>
              <div className="hint">Guardrails applied across the app. These take effect immediately — no publish needed.</div>
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
              <div className="settings-autosave">
                <span className={'autosave-dot' + (setAutoStatus === 'saved' ? ' flash' : '')} />
                {setAutoStatus === 'saving' ? 'Saving…' : setAutoStatus === 'saved' ? 'Saved — applies immediately' : 'Changes save automatically'}
              </div>
            </>
          )}
          {tab === 'websearch' && (
            <>
              <h2>Web Search</h2>
              <div className="hint">Give models a web search tool backed by your own SearXNG instance. Everything stays local — the server queries your instance and reads the result pages itself. Takes effect immediately, no publish needed.</div>
              <div className="field row">
                <div><label>Enable web search</label><div className="muted-note">When on, users get a Web Search toggle in the + menu. The model can call the tool whenever it's enabled for a chat.</div></div>
                <div className={'switch' + (settings.webSearchEnabled ? ' on' : '')} onClick={() => setSettings(s => ({ ...s, webSearchEnabled: !s.webSearchEnabled }))} />
              </div>
              {settings.webSearchEnabled && <>
                <div className="field"><label>Search engine</label>
                  <select value={settings.webSearchEngine || 'searxng'} onChange={(e) => setSettings(s => ({ ...s, webSearchEngine: e.target.value }))}>
                    <option value="searxng">SearXNG</option>
                  </select>
                </div>
                {(settings.webSearchEngine || 'searxng') === 'searxng' && (
                  <div className="field"><label>SearXNG query URL</label>
                    <input value={settings.searxngUrl || ''} onChange={(e) => setSettings(s => ({ ...s, searxngUrl: e.target.value }))} placeholder="http://localhost:8888" />
                    <div className="muted-note">Base URL of your SearXNG instance. The server calls <code>/search?q=…&amp;format=json</code>, so JSON output must be enabled in your SearXNG settings.</div>
                  </div>
                )}
                <div className="field"><label>Result count limit</label>
                  <input type="number" min="1" max="20" value={settings.webSearchCount ?? 5} onChange={(e) => setSettings(s => ({ ...s, webSearchCount: e.target.value }))} style={{ maxWidth: 140 }} />
                  <div className="muted-note">How many result pages to fetch and read per search (1–20). Higher means more context but slower and heavier.</div>
                </div>
                <div className="field"><label>Allowed domains</label>
                  <textarea rows={3} value={settings.webSearchDomains || ''} onChange={(e) => setSettings(s => ({ ...s, webSearchDomains: e.target.value }))} placeholder={'wikipedia.org\narxiv.org'} />
                  <div className="muted-note">One domain per line (or comma-separated). When set, the assistant can only read results from these domains and their subdomains — everything else is dropped. Leave empty to allow any site.</div>
                </div>
                <div className="field"><label>Web search system prompt</label>
                  <textarea rows={6} value={settings.webSearchPrompt ?? ''} onChange={(e) => setSettings(s => ({ ...s, webSearchPrompt: e.target.value }))} />
                  <div className="muted-note">Appended to a model's system prompt only when web search is enabled for the chat. Use it to tell the model to search only when asked or when information is missing or outdated.</div>
                </div>
              </>}
              <div className="settings-autosave">
                <span className={'autosave-dot' + (setAutoStatus === 'saved' ? ' flash' : '')} />
                {setAutoStatus === 'saving' ? 'Saving…' : setAutoStatus === 'saved' ? 'Saved — applies immediately' : 'Changes save automatically'}
              </div>
            </>
          )}
        </div>
      </div>
      {discover && (
        <div className="overlay sp-overlay" onMouseDown={(e) => e.target.classList.contains('sp-overlay') && setDiscover(null)}>
          <div className="sp-modal" style={{ maxHeight: '80vh' }}>
            <div className="sp-head">
              <div>
                <h3>Discover models</h3>
                <div className="muted-note">Models your backend currently exposes. Add the ones you want — added models can be hidden or deleted like any other.</div>
              </div>
              <button className="modal-close" style={{ position: 'static' }} onClick={() => setDiscover(null)}>✕</button>
            </div>
            <div className="discover-list">
              {discover.loading && <div className="muted-note" style={{ padding: 14 }}>Reaching the backend…</div>}
              {discover.error && <div className="dz-err">{discover.error}</div>}
              {!discover.loading && !discover.error && discover.list.length === 0 && <div className="muted-note" style={{ padding: 14 }}>No models returned by the backend.</div>}
              {discover.list.map(x => (
                <div key={x.id} className="discover-row">
                  <span className="discover-id">{x.id}</span>
                  {x.added
                    ? <span className="discover-added">Added ✓</span>
                    : <button className="btn" disabled={x.busy} onClick={() => addDiscovered(x.id)}>{x.busy ? 'Adding…' : 'Add'}</button>}
                </div>
              ))}
            </div>
            <div className="sp-foot">
              <button className="btn ghost" onClick={() => openDiscover(discover.providerId)} disabled={discover.loading}>Refresh</button>
              <button className="btn primary" onClick={() => setDiscover(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
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
