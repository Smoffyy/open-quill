import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import '../styles/playground.css';
import { api } from '../api.js';
import { t } from '../i18n.jsx';
import { Trash, Plus, Chevron, Panel, Gear } from './icons.jsx';
import { KwargControl } from './ModelDropdown.jsx';
import { resolveKwargValues, kwargPayload, kwargValuesArr, defaultValueOf } from '../kwargs.js';

const NUM_FIELDS = [
  { k: 'temperature', label: 'Temperature', hint: '0.7', min: 0, max: 2, step: 0.01, slider: true },
  { k: 'top_p', label: 'Top P', hint: '1', min: 0, max: 1, step: 0.01, slider: true },
  { k: 'top_k', label: 'Top K', hint: '40', min: 0, max: 200, step: 1, slider: true },
  { k: 'min_p', label: 'Min P', hint: '0.05', min: 0, max: 1, step: 0.01, slider: true },
  { k: 'repetition_penalty', label: 'Repetition penalty', hint: '1.1', min: 0, max: 2, step: 0.01, slider: true },
  { k: 'presence_penalty', label: 'Presence penalty', hint: '0', min: -2, max: 2, step: 0.01, slider: true },
  { k: 'frequency_penalty', label: 'Frequency penalty', hint: '0', min: -2, max: 2, step: 0.01, slider: true },
  { k: 'max_tokens', label: 'Max tokens', hint: '2048', slider: false },
  { k: 'num_ctx', label: 'Context window', hint: '8192', slider: false },
  { k: 'seed', label: 'Seed', hint: '0', slider: false }
];

const OVERRIDE_FIELDS = [
  'system_prompt', 'has_reasoning', 'reasoning_token', 'non_reasoning_token', 'kwargs',
  ...NUM_FIELDS.map(f => f.k)
];

const emptyish = (v) => v == null || v === '';
const sameValue = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === 'object') || (b && typeof b === 'object')) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  if (emptyish(a) && emptyish(b)) return true;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a ?? '') === String(b ?? '');
};

function baseOf(model) {
  const out = {};
  for (const k of OVERRIDE_FIELDS) {
    if (k === 'kwargs') out.kwargs = Array.isArray(model?.kwargs) ? model.kwargs : [];
    else if (k === 'has_reasoning') out.has_reasoning = model?.has_reasoning ? 1 : 0;
    else out[k] = model?.[k] ?? (typeof model?.[k] === 'number' ? model[k] : (model?.[k] === 0 ? 0 : (model?.[k] ?? '')));
  }
  for (const f of NUM_FIELDS) out[f.k] = model?.[f.k] ?? '';
  out.system_prompt = model?.system_prompt || '';
  out.reasoning_token = model?.reasoning_token || '';
  out.non_reasoning_token = model?.non_reasoning_token || '';
  return out;
}

function Field({ label, changed, onReset, children, note }) {
  return (
    <div className="pg-field">
      <div className="pg-field-head">
        <label>{t(label)}</label>
        {changed && <button type="button" className="pg-revert" onClick={onReset}>{t('revert')}</button>}
      </div>
      {children}
      {note && <div className="pg-note">{note}</div>}
    </div>
  );
}

function Row({ msg, streaming, onChange, onRole, onDelete, onRerun }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 520) + 'px';
  }, [msg.content]);
  const roles = ['user', 'assistant', 'system'];
  return (
    <div className={'pg-msg pg-' + msg.role}>
      <div className="pg-msg-bar">
        <button type="button" className="pg-role" title={t('Change role')}
          onClick={() => onRole(roles[(roles.indexOf(msg.role) + 1) % roles.length])}>{t(msg.role)}</button>
        {msg.reasoning ? <ReasoningBlock text={msg.reasoning} /> : <span />}
        <div className="pg-msg-acts">
          {msg.stats && <span className="pg-stats">{msg.stats}</span>}
          {msg.role === 'assistant' && !streaming && <button type="button" onClick={onRerun} title={t('Run again from here')}>{t('rerun')}</button>}
          <button type="button" onClick={onDelete} title={t('Delete message')}><Trash style={{ width: 14 }} /></button>
        </div>
      </div>
      <textarea ref={ref} value={msg.content} rows={1} spellCheck={false}
        placeholder={msg.role === 'assistant' ? t('Assistant reply, editable') : t('Message text')}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ReasoningBlock({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className={'pg-reason' + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
      <Chevron style={{ width: 12 }} /> {open ? t('Hide reasoning') : t('Reasoning')}
      {open && <pre>{text}</pre>}
    </button>
  );
}

export default function Playground({ onClose }) {
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState('');
  const [draft, setDraft] = useState({});
  const [kwargValues, setKwargValues] = useState({});
  const [extended, setExtended] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [showRequest, setShowRequest] = useState(false);
  const [request, setRequest] = useState(null);
  const [railOpen, setRailOpen] = useState(true);
  const abortRef = useRef(null);
  const scrollRef = useRef(null);

  const model = useMemo(() => models.find(m => m.id === modelId) || null, [models, modelId]);
  const base = useMemo(() => baseOf(model), [model]);
  const merged = useMemo(() => ({ ...base, ...draft }), [base, draft]);
  const kwDefs = useMemo(() => (Array.isArray(merged.kwargs) ? merged.kwargs : []), [merged]);
  const kwActive = useMemo(() => resolveKwargValues(kwDefs, kwargValues, true), [kwDefs, kwargValues]);
  const changedKeys = useMemo(() => OVERRIDE_FIELDS.filter(k => k in draft && !sameValue(draft[k], base[k])), [draft, base]);

  const load = useCallback(async () => {
    try {
      const list = await api.get('/api/admin/models');
      setModels(list);
      setModelId(prev => (prev && list.some(m => m.id === prev)) ? prev : (list[0]?.id || ''));
    } catch (e) { setErr(String(e.message || e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setDraft({});
    setKwargValues({});
    setSaved('');
  }, [modelId]);

  useEffect(() => {
    const defs = kwDefs.filter(d => !d.parentId);
    if (!defs.length) return;
    setKwargValues(prev => {
      let changed = false;
      const next = { ...prev };
      for (const d of defs) {
        const values = kwargValuesArr(d);
        if (!values.length || values.includes(next[d.id])) continue;
        next[d.id] = defaultValueOf(d);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [kwDefs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const revert = (k) => setDraft(d => { const n = { ...d }; delete n[k]; return n; });

  const patchMsg = (i, patch) => setMessages(ms => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const dropMsg = (i) => setMessages(ms => ms.filter((_, j) => j !== i));

  async function run(history) {
    if (!modelId || streaming) return;
    setErr('');
    setSaved('');
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const started = Date.now();
    let firstAt = 0;
    const idx = history.length;
    setMessages([...history, { role: 'assistant', content: '', reasoning: '', stats: '' }]);
    const overrides = {};
    for (const k of changedKeys) overrides[k] = merged[k];
    try {
      const res = await fetch('/api/admin/playground/stream', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId, overrides, kwargValues, extended,
          messages: history.map(m => ({ role: m.role, content: m.content }))
        })
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || t('Upstream error {status}', { status: res.status }));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let content = '', reasoning = '', usage = null;
      const paint = () => {
        const secs = (Date.now() - started) / 1000;
        const bits = [];
        if (firstAt) bits.push(t('first token') + ' ' + ((firstAt - started) / 1000).toFixed(2) + 's');
        if (usage && usage.completion) bits.push(usage.completion + ' ' + t('out tokens'));
        if (usage && usage.prompt) bits.push(usage.prompt + ' ' + t('in'));
        if (usage && usage.completion && secs > 0) bits.push((usage.completion / secs).toFixed(1) + ' tok/s');
        else if (secs > 0) bits.push(secs.toFixed(1) + 's');
        setMessages(ms => ms.map((m, j) => (j === idx ? { ...m, content, reasoning, stats: bits.join(' \u00b7 ') } : m)));
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith('data:')) continue;
          let ev = null;
          try { ev = JSON.parse(s.slice(5).trim()); } catch { continue; }
          if (ev.type === 'start') setRequest(ev.request);
          else if (ev.type === 'content') { if (!firstAt) firstAt = Date.now(); content += ev.text; paint(); }
          else if (ev.type === 'reasoning') { if (!firstAt) firstAt = Date.now(); reasoning += ev.text; paint(); }
          else if (ev.type === 'usage') { usage = ev.usage; paint(); }
          else if (ev.type === 'error') setErr(ev.error);
        }
      }
      paint();
    } catch (e) {
      if (e.name !== 'AbortError') setErr(String(e.message || e));
    }
    abortRef.current = null;
    setStreaming(false);
  }

  function send() {
    const text = input.trim();
    if (!text && !messages.length) return;
    const history = text ? [...messages, { role: 'user', content: text }] : messages;
    setInput('');
    run(history);
  }

  function rerunFrom(i) {
    run(messages.slice(0, i));
  }

  async function save(publish) {
    if (!model || !changedKeys.length) return;
    const patch = {};
    for (const k of changedKeys) {
      const v = merged[k];
      if (k === 'has_reasoning') patch[k] = v ? 1 : 0;
      else if (k === 'kwargs') patch[k] = v;
      else patch[k] = v === '' ? null : v;
    }
    try {
      await api.patch('/api/admin/models/' + model.id, patch);
      if (publish) await api.post('/api/admin/models/publish', {});
      setDraft({});
      setSaved(publish ? t('Saved and pushed to everyone.') : t('Saved to the admin panel as a draft change.'));
      await load();
    } catch (e) { setErr(String(e.message || e)); }
  }

  const previewPayload = useMemo(() => kwargPayload(kwDefs, kwActive), [kwDefs, kwActive]);

  return (
    <div className="pg-root">
      <header className="pg-top">
        <div className="pg-top-left">
          <button className="pg-icon" title={t('Settings panel')} onClick={() => setRailOpen(o => !o)}><Panel /></button>
          <div>
            <div className="pg-title">{t('Playground')}</div>
            <div className="pg-sub">{t('Try a model and tune it, then keep the changes or throw them away.')}</div>
          </div>
        </div>
        <div className="pg-top-right">
          <select className="pg-model" value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {models.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
          {changedKeys.length > 0 && (
            <>
              <span className="pg-dirty">{changedKeys.length} {t(changedKeys.length === 1 ? 'change' : 'changes')}</span>
              <button className="btn" onClick={() => setDraft({})}>{t('Discard')}</button>
              <button className="btn" onClick={() => save(false)}>{t('Save to model')}</button>
              <button className="btn primary" onClick={() => save(true)}>{t('Save and push live')}</button>
            </>
          )}
          <button className="pg-icon" title={t('Close')} onClick={onClose}>✕</button>
        </div>
      </header>

      {(err || saved) && (
        <div className={'pg-banner' + (err ? ' bad' : '')}>
          <span>{err || saved}</span>
          <button type="button" onClick={() => { setErr(''); setSaved(''); }}>✕</button>
        </div>
      )}

      <div className={'pg-body' + (railOpen ? '' : ' no-rail')}>
        {railOpen && (
          <aside className="pg-rail">
            <div className="pg-group">{t('Prompt')}</div>
            <Field label="System prompt" changed={changedKeys.includes('system_prompt')} onReset={() => revert('system_prompt')}
              note={t('Sent as the system message. Nothing else is added, so what you see here is what the model gets.')}>
              <textarea className="pg-ta" rows={7} value={merged.system_prompt || ''} spellCheck={false}
                onChange={(e) => set('system_prompt', e.target.value)} />
            </Field>

            <div className="pg-group">{t('Sampling')}</div>
            {NUM_FIELDS.map((f) => {
              const raw = merged[f.k];
              const unset = raw === '' || raw == null;
              const num = unset ? f.min : Number(raw);
              return (
                <Field key={f.k} label={f.label} changed={changedKeys.includes(f.k)} onReset={() => revert(f.k)}>
                  <div className={'pg-num' + (f.slider ? '' : ' solo') + (unset ? ' unset' : '')}>
                    {f.slider && (
                      <input type="range" min={f.min} max={f.max} step={f.step}
                        value={Number.isFinite(num) ? num : f.min}
                        onChange={(e) => set(f.k, e.target.value)} />
                    )}
                    <input className="pg-num-in" inputMode="decimal" value={raw ?? ''}
                      placeholder={t('not sent') + ' \u00b7 ' + f.hint}
                      onChange={(e) => set(f.k, e.target.value)} />
                  </div>
                </Field>
              );
            })}
            <div className="pg-note">{t('Leave a field blank and it is left out of the request. Samplers your provider does not support are ignored.')}</div>

            {kwDefs.length > 0 && (
              <>
                <div className="pg-group">{t('Kwargs')}</div>
                <div className="pg-kwargs">
                  {kwDefs.filter(d => d.visible !== false).map(d => (
                    <KwargControl key={d.id} def={d} value={kwActive[d.id]} isAdmin
                      onSet={(id, v) => setKwargValues(prev => ({ ...prev, [id]: v }))} />
                  ))}
                </div>
                <div className="pg-code">{JSON.stringify(previewPayload, null, 2)}</div>
              </>
            )}

            <div className="pg-group">{t('Reasoning')}</div>
            <div className="pg-switch-row" onClick={() => set('has_reasoning', merged.has_reasoning ? 0 : 1)}>
              <div>
                <label>{t('Extended thinking (prompt token)')}</label>
                <div className="pg-note">{t('Appends the trigger below to the system prompt.')}</div>
              </div>
              <div className={'switch' + (merged.has_reasoning ? ' on' : '')} />
            </div>
            {!!merged.has_reasoning && (
              <>
                <div className="pg-switch-row" onClick={() => setExtended(x => !x)}>
                  <div><label>{t('Extended is on for this run')}</label></div>
                  <div className={'switch' + (extended ? ' on' : '')} />
                </div>
                <Field label="Extended-mode trigger" changed={changedKeys.includes('reasoning_token')} onReset={() => revert('reasoning_token')}>
                  <input value={merged.reasoning_token || ''} placeholder="/think" onChange={(e) => set('reasoning_token', e.target.value)} />
                </Field>
                <Field label="Standard-mode trigger" changed={changedKeys.includes('non_reasoning_token')} onReset={() => revert('non_reasoning_token')}>
                  <input value={merged.non_reasoning_token || ''} placeholder="/no_think" onChange={(e) => set('non_reasoning_token', e.target.value)} />
                </Field>
              </>
            )}

            <div className="pg-group">{t('Request')}</div>
            <button type="button" className="btn ghost" onClick={() => setShowRequest(s => !s)}>
              <Gear style={{ width: 14, verticalAlign: '-2px' }} /> {showRequest ? t('Hide what was sent') : t('Show what was sent')}
            </button>
            {showRequest && <div className="pg-code tall">{request ? JSON.stringify(request, null, 2) : t('Send a message first.')}</div>}
          </aside>
        )}

        <main className="pg-chat">
          <div className="pg-scroll" ref={scrollRef}>
            {!messages.length && (
              <div className="pg-empty">
                <div className="pg-empty-title">{t('Empty conversation')}</div>
                <div className="pg-note">{t('Every message here is editable, including the model replies. Rewrite one and run again to see how the model reacts. Tools and the sandbox are off in the playground.')}</div>
              </div>
            )}
            {messages.map((m, i) => (
              <Row key={i} msg={m} streaming={streaming}
                onChange={(v) => patchMsg(i, { content: v })}
                onRole={(r) => patchMsg(i, { role: r })}
                onDelete={() => dropMsg(i)}
                onRerun={() => rerunFrom(i)} />
            ))}
          </div>
          <div className="pg-composer">
            <textarea value={input} rows={2} placeholder={t('Message the model, Ctrl+Enter to send')}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
            <div className="pg-composer-acts">
              <button type="button" className="btn ghost" onClick={() => setMessages(ms => [...ms, { role: 'user', content: '' }])}>
                <Plus style={{ width: 14, verticalAlign: '-2px' }} /> {t('Add message')}
              </button>
              <button type="button" className="btn ghost" disabled={!messages.length} onClick={() => { setMessages([]); setRequest(null); }}>{t('Clear chat')}</button>
              <span className="pg-spacer" />
              {streaming
                ? <button type="button" className="btn" onClick={() => abortRef.current && abortRef.current.abort()}>{t('Stop')}</button>
                : <button type="button" className="btn primary" disabled={!modelId} onClick={send}>{t('Run')}</button>}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
