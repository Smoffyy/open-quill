import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import '../styles/playground.css';
import { api } from '../api.js';
import { t, tk } from '../i18n.jsx';
import { Trash, Plus, Chevron, Panel, Gear, Copy, Check, Retry, Refresh, Stop, X, Flask, Sparkles, Expand, Pencil } from './icons.jsx';
import { KwargControl } from './ModelDropdown.jsx';
import { Switch } from './settingsui.jsx';
import { resolveKwargValues, kwargPayload, kwargValuesArr, defaultValueOf } from '../kwargs.js';
import {
  SAMPLING_PRESETS, activePreset, applyPreset, clearSamplers, runStats, statTiles,
  fmtDuration, historyFor, transcriptJson, pickedText, isUnset, seedFrom, groupModels, capsOf
} from '../lib/playground.js';

const NUM_FIELDS = [
  { k: 'temperature', label: tk('Temperature'), hint: '0.7', min: 0, max: 2, step: 0.01, slider: true },
  { k: 'top_p', label: tk('Top P'), hint: '1', min: 0, max: 1, step: 0.01, slider: true },
  { k: 'top_k', label: tk('Top K'), hint: '40', min: 0, max: 200, step: 1, slider: true },
  { k: 'min_p', label: tk('Min P'), hint: '0.05', min: 0, max: 1, step: 0.01, slider: true },
  { k: 'repetition_penalty', label: tk('Repetition penalty'), hint: '1.1', min: 0, max: 2, step: 0.01, slider: true },
  { k: 'presence_penalty', label: tk('Presence penalty'), hint: '0', min: -2, max: 2, step: 0.01, slider: true },
  { k: 'frequency_penalty', label: tk('Frequency penalty'), hint: '0', min: -2, max: 2, step: 0.01, slider: true }
];

const LIMIT_FIELDS = [
  { k: 'max_tokens', label: tk('Max tokens'), hint: '2048' },
  { k: 'num_ctx', label: tk('Context window'), hint: '8192' },
  { k: 'seed', label: tk('Seed'), hint: '0', seed: true }
];

const ALL_NUM = [...NUM_FIELDS, ...LIMIT_FIELDS];

const OVERRIDE_FIELDS = [
  'system_prompt', 'has_reasoning', 'reasoning_token', 'non_reasoning_token', 'kwargs',
  ...ALL_NUM.map(f => f.k)
];

const PROBES = [
  { label: tk('Baseline'), text: tk('In one short paragraph, explain what a context window is.') },
  { label: tk('Instruction following'), text: tk('Reply with exactly five words, no punctuation.') },
  { label: tk('Structured output'), text: tk('Return only JSON: {"city":string,"country":string} for Kyoto. No prose, no code fence.') },
  { label: tk('Reasoning'), text: tk('A bat and a ball cost 1.10 together. The bat costs 1.00 more than the ball. What does the ball cost? Show your working.') }
];

const STORE_KEY = 'oq.playground.v1';
const STORE_MAX = 200000;

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
    else out[k] = model?.[k] ?? '';
  }
  for (const f of ALL_NUM) out[f.k] = model?.[f.k] ?? '';
  out.system_prompt = model?.system_prompt || '';
  out.reasoning_token = model?.reasoning_token || '';
  out.non_reasoning_token = model?.non_reasoning_token || '';
  return out;
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || null; } catch { return null; }
}

function writeStore(state) {
  try {
    const raw = JSON.stringify(state);
    if (raw.length > STORE_MAX) return;
    localStorage.setItem(STORE_KEY, raw);
  } catch { /* private windows and quota limits are not worth a broken screen */ }
}

function CopyButton({ text, label, className = 'pg-mini' }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const id = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button type="button" className={className} title={label || t('Copy')} aria-label={label || t('Copy')}
      onClick={() => { navigator.clipboard?.writeText(text || '').then(() => setDone(true), () => {}); }}>
      {done ? <Check style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
    </button>
  );
}

function Section({ id, title, count, open, onToggle, children }) {
  return (
    <section className={'pg-section' + (open ? ' open' : '')}>
      <button type="button" className="pg-section-head" onClick={() => onToggle(id)} aria-expanded={open}>
        <Chevron className="pg-section-chev" style={{ width: 12, height: 12 }} />
        <span className="pg-section-title">{title}</span>
        {count > 0 && <span className="pg-count" title={t('Fields changed from the saved model')}>{count}</span>}
      </button>
      {open && <div className="pg-section-body">{children}</div>}
    </section>
  );
}

function Field({ label, changed, onReset, children, note, action }) {
  return (
    <div className={'pg-field' + (changed ? ' changed' : '')}>
      <div className="pg-field-head">
        <label>{label}</label>
        <span className="pg-field-acts">
          {changed && <button type="button" className="pg-revert" onClick={onReset}>{t('revert')}</button>}
          {action}
        </span>
      </div>
      {children}
      {note && <div className="pg-note">{note}</div>}
    </div>
  );
}

function NumRow({ f, raw, changed, onSet, onReset }) {
  const unset = isUnset(raw);
  const num = unset ? f.min : Number(raw);
  return (
    <Field label={t(f.label)} changed={changed} onReset={onReset}>
      <div className={'pg-num' + (f.slider ? '' : ' solo') + (unset ? ' unset' : '')}>
        {f.slider && (
          <input type="range" min={f.min} max={f.max} step={f.step} aria-label={t(f.label)}
            value={Number.isFinite(num) ? num : f.min}
            onChange={(e) => onSet(e.target.value)} />
        )}
        <div className="pg-num-cell">
          <input className="pg-num-in" inputMode="decimal" value={raw ?? ''} aria-label={t(f.label)}
            placeholder={f.hint} onChange={(e) => onSet(e.target.value)} />
          {unset
            ? <span className="pg-num-tag">{t('off')}</span>
            : <button type="button" className="pg-num-x" title={t('Leave out of the request')} onClick={() => onSet('')}>
                <X style={{ width: 10, height: 10 }} />
              </button>}
        </div>
        {f.seed && (
          <button type="button" className="pg-mini pg-seed" title={t('Random seed')} onClick={() => onSet(String(seedFrom()))}>
            <Refresh style={{ width: 13, height: 13 }} />
          </button>
        )}
      </div>
    </Field>
  );
}

function ReasoningBlock({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={'pg-reason' + (open ? ' open' : '')}>
      <button type="button" className="pg-reason-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <Chevron style={{ width: 11, height: 11 }} />
        {open ? t('Hide reasoning') : t('Reasoning')}
      </button>
      {open && <pre>{text}</pre>}
    </div>
  );
}

function StatStrip({ stats, compact }) {
  const tiles = statTiles(stats);
  if (!tiles.length) return null;
  return (
    <div className={'pg-stats' + (compact ? ' compact' : '')}>
      {tiles.map(s => (
        <div key={s.id} className="pg-stat">
          <span className="pg-stat-k">{t(s.label)}</span>
          <span className="pg-stat-v">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

function Waiting({ since, phase }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="pg-waiting">
      <span className="pg-pulse" aria-hidden="true" />
      <span>{phase === 'reasoning' ? t('Thinking') : t('Waiting for the first token')}</span>
      <span className="pg-waiting-t">{fmtDuration(Math.max(0, now - since))}</span>
    </div>
  );
}

function Variant({ v, streaming, single, picked, onPick }) {
  const waiting = streaming && !v.content && !v.reasoning && !v.error;
  return (
    <div className={'pg-variant' + (single ? ' single' : '') + (picked ? ' picked' : '')}>
      {!single && (
        <div className="pg-variant-head">
          <span className="pg-model-tag">{v.name}</span>
          {picked
            ? <span className="pg-kept"><Check style={{ width: 11, height: 11 }} /> {t('kept')}</span>
            : <button type="button" className="pg-mini pg-keep" onClick={onPick}>{t('Keep this one')}</button>}
        </div>
      )}
      {v.reasoning ? <ReasoningBlock text={v.reasoning} /> : null}
      {v.error ? <div className="pg-variant-err">{v.error}</div> : null}
      {waiting
        ? <Waiting since={v.startedAt} phase={v.reasoning ? 'reasoning' : 'wait'} />
        : <div className="pg-variant-text">{v.content || (v.error ? '' : <span className="pg-dim">{t('Empty reply.')}</span>)}</div>}
      {v.stats && !waiting && <StatStrip stats={v.stats} compact />}
    </div>
  );
}

function Row({ msg, index, streaming, onChange, onRole, onDelete, onRerun, onPick }) {
  const ref = useRef(null);
  const [editing, setEditing] = useState(false);
  const multi = Array.isArray(msg.variants) && msg.variants.length > 1;
  const text = pickedText(msg);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 520) + 'px';
  }, [text, editing]);
  const roles = ['user', 'assistant', 'system'];
  const editable = !multi && !streaming;
  return (
    <div className={'pg-msg pg-' + msg.role}>
      <div className="pg-msg-bar">
        <button type="button" className={'pg-role r-' + msg.role} title={t('Change role')}
          onClick={() => onRole(roles[(roles.indexOf(msg.role) + 1) % roles.length])}>{t(msg.role)}</button>
        {msg.role === 'assistant' && !multi && msg.variants?.[0]?.name && (
          <span className="pg-model-tag">{msg.variants[0].name}</span>
        )}
        <div className="pg-msg-acts">
          <CopyButton text={text} label={t('Copy message')} />
          {msg.role === 'assistant' && !streaming && (
            <button type="button" className="pg-mini" onClick={onRerun} title={t('Run again from here')}>
              <Retry style={{ width: 13, height: 13 }} />
            </button>
          )}
          <button type="button" className="pg-mini" onClick={onDelete} title={t('Delete message')}>
            <Trash style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </div>
      {multi ? (
        <div className="pg-variants" style={{ '--pg-cols': msg.variants.length }}>
          {msg.variants.map((v, i) => (
            <Variant key={v.modelId + ':' + i} v={v} streaming={streaming} single={false}
              picked={(msg.pick || 0) === i} onPick={() => onPick(i)} />
          ))}
        </div>
      ) : msg.role === 'assistant' && streaming && !text ? (
        <div className="pg-msg-body">
          {msg.variants?.[0]?.reasoning ? <ReasoningBlock text={msg.variants[0].reasoning} /> : null}
          <Waiting since={msg.variants?.[0]?.startedAt || Date.now()} phase={msg.variants?.[0]?.reasoning ? 'reasoning' : 'wait'} />
        </div>
      ) : (
        <>
          {msg.variants?.[0]?.reasoning ? <div className="pg-msg-body"><ReasoningBlock text={msg.variants[0].reasoning} /></div> : null}
          {msg.variants?.[0]?.error ? <div className="pg-msg-body"><div className="pg-variant-err">{msg.variants[0].error}</div></div> : null}
          <textarea ref={ref} value={text} rows={1} spellCheck={false} readOnly={!editable}
            placeholder={msg.role === 'assistant' ? t('Assistant reply, editable') : t('Message text')}
            onFocus={() => setEditing(true)} onBlur={() => setEditing(false)}
            onChange={(e) => onChange(e.target.value)} />
          {msg.variants?.[0]?.stats && <div className="pg-msg-foot"><StatStrip stats={msg.variants[0].stats} compact /></div>}
        </>
      )}
      <span className="pg-msg-i" aria-hidden="true">{index + 1}</span>
    </div>
  );
}

export default function Playground({ onClose }) {
  const [models, setModels] = useState([]);
  const [providers, setProviders] = useState([]);
  const [modelId, setModelId] = useState('');
  const [compareId, setCompareId] = useState('');
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
  const [open, setOpen] = useState({ prompt: true, sampling: true, limits: true, kwargs: true, reasoning: false });
  const [restored, setRestored] = useState(false);
  const [promptFull, setPromptFull] = useState(false);
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const model = useMemo(() => models.find(m => m.id === modelId) || null, [models, modelId]);
  const rival = useMemo(() => models.find(m => m.id === compareId) || null, [models, compareId]);
  const base = useMemo(() => baseOf(model), [model]);
  const merged = useMemo(() => ({ ...base, ...draft }), [base, draft]);
  const kwDefs = useMemo(() => (Array.isArray(merged.kwargs) ? merged.kwargs : []), [merged]);
  const kwActive = useMemo(() => resolveKwargValues(kwDefs, kwargValues, true), [kwDefs, kwargValues]);
  const changedKeys = useMemo(() => OVERRIDE_FIELDS.filter(k => k in draft && !sameValue(draft[k], base[k])), [draft, base]);
  const preset = useMemo(() => activePreset(merged), [merged]);
  const groups = useMemo(() => groupModels(models, providers), [models, providers]);
  const caps = useMemo(() => capsOf(model), [model]);
  const lastStats = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const v = messages[i].variants;
      if (v && v.length === 1 && v[0].stats) return v[0].stats;
    }
    return null;
  }, [messages]);

  const load = useCallback(async () => {
    try {
      const [list, prov] = await Promise.all([
        api.get('/api/admin/models'),
        api.get('/api/admin/providers').catch(() => ({ providers: [] }))
      ]);
      setModels(list);
      setProviders(prov?.providers || []);
      setModelId(prev => (prev && list.some(m => m.id === prev)) ? prev : (list[0]?.id || ''));
    } catch (e) { setErr(String(e.message || e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The session is restored once models are in, so a reload in the middle of a
  // comparison does not throw away the run it took a minute to produce.
  useEffect(() => {
    if (restored || !models.length) return;
    setRestored(true);
    const s = readStore();
    if (!s) return;
    if (s.modelId && models.some(m => m.id === s.modelId)) setModelId(s.modelId);
    if (s.compareId && models.some(m => m.id === s.compareId)) setCompareId(s.compareId);
    if (s.draft && typeof s.draft === 'object') setDraft(s.draft);
    if (s.kwargValues && typeof s.kwargValues === 'object') setKwargValues(s.kwargValues);
    if (Array.isArray(s.messages)) setMessages(s.messages);
    if (typeof s.input === 'string') setInput(s.input);
    if (typeof s.extended === 'boolean') setExtended(s.extended);
  }, [models, restored]);

  useEffect(() => {
    if (!restored) return;
    writeStore({ modelId, compareId, draft, kwargValues, extended, messages, input });
  }, [restored, modelId, compareId, draft, kwargValues, extended, messages, input]);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
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
  }, [messages.length, streaming]);

  useEffect(() => {
    const h = (e) => {
      if (e.key !== 'Escape') return;
      if (promptFull) { setPromptFull(false); return; }
      if (!streaming) onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose, streaming, promptFull]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const revert = (k) => setDraft(d => { const n = { ...d }; delete n[k]; return n; });
  const toggleSection = (id) => setOpen(o => ({ ...o, [id]: !o[id] }));

  const setSamplers = (values) => setDraft(d => {
    const n = { ...d };
    for (const f of NUM_FIELDS) n[f.k] = values[f.k] ?? '';
    return n;
  });

  const patchMsg = (i, patch) => setMessages(ms => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const dropMsg = (i) => setMessages(ms => ms.filter((_, j) => j !== i));

  const editMsg = (i, text) => setMessages(ms => ms.map((m, j) => {
    if (j !== i) return m;
    if (Array.isArray(m.variants) && m.variants.length) {
      const at = Math.min(Math.max(0, m.pick || 0), m.variants.length - 1);
      return { ...m, content: text, variants: m.variants.map((v, k) => (k === at ? { ...v, content: text } : v)) };
    }
    return { ...m, content: text };
  }));

  // One request per model under test. They share the history and the overrides,
  // so the only difference between two columns is the model itself.
  async function streamOne(target, history, signal, onPatch) {
    const startedAt = Date.now();
    let firstAt = 0, content = '', reasoning = '', usage = null;
    const paint = (extra) => onPatch({
      content, reasoning, startedAt, firstAt,
      stats: runStats({ startedAt, firstAt, endedAt: Date.now(), usage }),
      ...extra
    });
    paint();
    const overrides = {};
    for (const k of changedKeys) overrides[k] = merged[k];
    try {
      const res = await fetch('/api/admin/playground/stream', {
        method: 'POST', credentials: 'same-origin', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: target.id, overrides, kwargValues, extended, messages: history })
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || t('Upstream error {status}', { status: res.status }));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
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
          if (ev.type === 'start') { if (target.primary) setRequest(ev.request); }
          else if (ev.type === 'content') { if (!firstAt) firstAt = Date.now(); content += ev.text; paint(); }
          else if (ev.type === 'reasoning') { if (!firstAt) firstAt = Date.now(); reasoning += ev.text; paint(); }
          else if (ev.type === 'usage') { usage = ev.usage; paint(); }
          else if (ev.type === 'error') paint({ error: ev.error });
        }
      }
      paint();
    } catch (e) {
      if (e.name === 'AbortError') paint({ error: t('Stopped.') });
      else paint({ error: String(e.message || e) });
    }
  }

  async function run(history) {
    if (!modelId || streaming) return;
    setErr('');
    setSaved('');
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const targets = [{ id: modelId, name: model?.display_name || t('Model'), primary: true }];
    if (compareId && compareId !== modelId) targets.push({ id: compareId, name: rival?.display_name || t('Model B'), primary: false });
    const idx = history.length;
    const wire = historyFor(history);
    setMessages([...history, {
      role: 'assistant', content: '', pick: 0,
      variants: targets.map(tg => ({ modelId: tg.id, name: tg.name, content: '', reasoning: '', startedAt: Date.now(), stats: null }))
    }]);
    const patchVariant = (vi) => (patch) => setMessages(ms => ms.map((m, j) => {
      if (j !== idx) return m;
      const variants = m.variants.map((v, k) => (k === vi ? { ...v, ...patch } : v));
      return { ...m, variants, content: variants[Math.min(m.pick || 0, variants.length - 1)]?.content || '' };
    }));
    await Promise.all(targets.map((tg, i) => streamOne(tg, wire, controller.signal, patchVariant(i))));
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

  function rerunFrom(i) { run(messages.slice(0, i)); }

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
  const promptSize = useMemo(() => {
    const raw = merged.system_prompt || '';
    const lines = raw ? raw.split(/\r?\n/).length : 0;
    return { chars: raw.length.toLocaleString('en-US'), lines: lines.toLocaleString('en-US') };
  }, [merged.system_prompt]);
  const promptCount = useMemo(() => changedKeys.filter(k => ['system_prompt', 'reasoning_token', 'non_reasoning_token'].includes(k)).length, [changedKeys]);
  const samplingCount = useMemo(() => changedKeys.filter(k => NUM_FIELDS.some(f => f.k === k)).length, [changedKeys]);
  const limitCount = useMemo(() => changedKeys.filter(k => LIMIT_FIELDS.some(f => f.k === k)).length, [changedKeys]);

  const picker = (value, onChange, ariaLabel) => (
    <div className="pg-select">
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
        {!value && <option value="">{t('Choose a model')}</option>}
        {groups.map(g => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map(m => <option key={m.id} value={m.id}>{m.display_name}{m.unavailable ? ' · ' + t('unavailable') : ''}</option>)}
          </optgroup>
        ))}
      </select>
      <Chevron className="pg-select-chev" style={{ width: 12, height: 12 }} />
    </div>
  );

  return (
    <div className="pg-root">
      <header className="pg-top">
        <div className="pg-top-left">
          <button className={'pg-icon' + (railOpen ? ' on' : '')} title={t('Settings panel')} aria-pressed={railOpen}
            onClick={() => setRailOpen(o => !o)}><Panel /></button>
          <div className="pg-brand">
            <Flask style={{ width: 16, height: 16 }} />
            <span className="pg-title">{t('Playground')}</span>
          </div>
          <div className="pg-pickers">
            {picker(modelId, setModelId, t('Model'))}
            {compareId ? (
              <>
                <span className="pg-vs">{t('vs')}</span>
                {picker(compareId, setCompareId, t('Comparison model'))}
                <button className="pg-icon sm" title={t('Stop comparing')} onClick={() => setCompareId('')}><X /></button>
              </>
            ) : (
              <button className="btn ghost sm" disabled={models.length < 2}
                title={t('Run the same prompt against a second model')}
                onClick={() => setCompareId(models.find(m => m.id !== modelId)?.id || '')}>
                {t('Compare')}
              </button>
            )}
          </div>
          {caps.length > 0 && !compareId && (
            <div className="pg-caps">{caps.map(c => <span key={c} className={'pg-cap' + (c === 'Unavailable' ? ' warn' : '')}>{t(c)}</span>)}</div>
          )}
        </div>
        <div className="pg-top-right">
          {changedKeys.length > 0 && (
            <>
              <span className="pg-dirty">{changedKeys.length} {t(changedKeys.length === 1 ? 'change' : 'changes')}</span>
              <button className="btn ghost" onClick={() => setDraft({})}>{t('Discard')}</button>
              <button className="btn" onClick={() => save(false)}>{t('Save to model')}</button>
              <button className="btn primary" onClick={() => save(true)}>{t('Save and push live')}</button>
            </>
          )}
          <button className={'pg-icon' + (showRequest ? ' on' : '')} title={t('Show what was sent')} aria-pressed={showRequest}
            onClick={() => setShowRequest(s => !s)}><Gear /></button>
          <button className="pg-icon" title={t('Close')} aria-label={t('Close')} onClick={onClose}><X /></button>
        </div>
      </header>

      {(err || saved) && (
        <div className={'pg-banner' + (err ? ' bad' : '')}>
          <span>{err || saved}</span>
          <button type="button" aria-label={t('Dismiss')} onClick={() => { setErr(''); setSaved(''); }}><X style={{ width: 13, height: 13 }} /></button>
        </div>
      )}

      <div className={'pg-body' + (railOpen ? '' : ' no-rail') + (showRequest ? ' with-req' : '')}>
        {railOpen && (
          <aside className="pg-rail">
            <Section id="prompt" title={t('Prompt')} count={promptCount} open={open.prompt} onToggle={toggleSection}>
              <Field label={t('System prompt')} changed={changedKeys.includes('system_prompt')} onReset={() => revert('system_prompt')}
                note={t('Sent as the system message. Nothing else is added, so what you see here is what the model gets.')}
                action={
                  <button type="button" className="pg-ta-expand" onClick={() => setPromptFull(true)}>
                    <Expand style={{ width: 12, height: 12 }} /> {t('Full editor')}
                  </button>
                }>
                <textarea className="pg-ta" rows={10} value={merged.system_prompt || ''} spellCheck={false}
                  aria-label={t('System prompt')}
                  onChange={(e) => set('system_prompt', e.target.value)} />
                <div className="pg-ta-foot">
                  <span>{promptSize.lines} {t('lines')} · {promptSize.chars} {t('characters')}</span>
                  <CopyButton text={merged.system_prompt || ''} label={t('Copy system prompt')} />
                </div>
              </Field>
            </Section>

            <Section id="sampling" title={t('Sampling')} count={samplingCount} open={open.sampling} onToggle={toggleSection}>
              <div className="pg-presets">
                {SAMPLING_PRESETS.map(p => (
                  <button key={p.id} type="button" title={t(p.hint)}
                    className={'pg-preset' + (preset === p.id ? ' on' : '')}
                    onClick={() => setSamplers(applyPreset(merged, p))}>{t(p.label)}</button>
                ))}
                <button type="button" className="pg-preset" title={t('Leave every sampler out of the request')}
                  onClick={() => setSamplers(clearSamplers(merged))}>{t('None')}</button>
              </div>
              {NUM_FIELDS.map(f => (
                <NumRow key={f.k} f={f} raw={merged[f.k]} changed={changedKeys.includes(f.k)}
                  onSet={(v) => set(f.k, v)} onReset={() => revert(f.k)} />
              ))}
              <div className="pg-note">{t('Leave a field blank and it is left out of the request. Samplers your provider does not support are ignored.')}</div>
            </Section>

            <Section id="limits" title={t('Limits')} count={limitCount} open={open.limits} onToggle={toggleSection}>
              {LIMIT_FIELDS.map(f => (
                <NumRow key={f.k} f={f} raw={merged[f.k]} changed={changedKeys.includes(f.k)}
                  onSet={(v) => set(f.k, v)} onReset={() => revert(f.k)} />
              ))}
            </Section>

            {kwDefs.length > 0 && (
              <Section id="kwargs" title={t('Kwargs')} count={changedKeys.includes('kwargs') ? 1 : 0} open={open.kwargs} onToggle={toggleSection}>
                <div className="pg-kwargs">
                  {kwDefs.filter(d => d.visible !== false).map(d => (
                    <KwargControl key={d.id} def={d} value={kwActive[d.id]} isAdmin
                      onSet={(id, v) => setKwargValues(prev => ({ ...prev, [id]: v }))} />
                  ))}
                </div>
                <div className="pg-code">{JSON.stringify(previewPayload, null, 2)}</div>
              </Section>
            )}

            <Section id="reasoning" title={t('Reasoning')} count={changedKeys.filter(k => ['has_reasoning', 'reasoning_token', 'non_reasoning_token'].includes(k)).length}
              open={open.reasoning} onToggle={toggleSection}>
              <div className="pg-switch-row" onClick={() => set('has_reasoning', merged.has_reasoning ? 0 : 1)}>
                <div>
                  <label>{t('Extended thinking (prompt token)')}</label>
                  <div className="pg-note">{t('Appends the trigger below to the system prompt.')}</div>
                </div>
                <Switch on={!!merged.has_reasoning} label={t('Extended thinking (prompt token)')}
                  onToggle={() => set('has_reasoning', merged.has_reasoning ? 0 : 1)} />
              </div>
              {!!merged.has_reasoning && (
                <>
                  <div className="pg-switch-row" onClick={() => setExtended(x => !x)}>
                    <div><label>{t('Extended is on for this run')}</label></div>
                    <Switch on={extended} label={t('Extended is on for this run')} onToggle={() => setExtended(x => !x)} />
                  </div>
                  <Field label={t('Extended-mode trigger')} changed={changedKeys.includes('reasoning_token')} onReset={() => revert('reasoning_token')}>
                    <input value={merged.reasoning_token || ''} placeholder="/think" aria-label={t('Extended-mode trigger')}
                      onChange={(e) => set('reasoning_token', e.target.value)} />
                  </Field>
                  <Field label={t('Standard-mode trigger')} changed={changedKeys.includes('non_reasoning_token')} onReset={() => revert('non_reasoning_token')}>
                    <input value={merged.non_reasoning_token || ''} placeholder="/no_think" aria-label={t('Standard-mode trigger')}
                      onChange={(e) => set('non_reasoning_token', e.target.value)} />
                  </Field>
                </>
              )}
            </Section>
          </aside>
        )}

        <main className="pg-chat">
          <div className="pg-scroll" ref={scrollRef}>
            {!messages.length && (
              <div className="pg-empty">
                <Sparkles style={{ width: 22, height: 22 }} />
                <div className="pg-empty-title">{t('Nothing sent yet')}</div>
                <div className="pg-note">{t('Every message here is editable, including the model replies. Rewrite one and run again to see how the model reacts. Tools and the sandbox are off in the playground.')}</div>
                <div className="pg-probes">
                  {PROBES.map(p => (
                    <button key={p.label} type="button" className="pg-probe"
                      onClick={() => { setInput(t(p.text)); inputRef.current?.focus(); }}>
                      <span className="pg-probe-k">{t(p.label)}</span>
                      <span className="pg-probe-t">{t(p.text)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <Row key={i} msg={m} index={i} streaming={streaming && i === messages.length - 1}
                onChange={(v) => editMsg(i, v)}
                onRole={(r) => patchMsg(i, { role: r })}
                onDelete={() => dropMsg(i)}
                onRerun={() => rerunFrom(i)}
                onPick={(k) => patchMsg(i, { pick: k, content: m.variants?.[k]?.content || '' })} />
            ))}
          </div>

          {lastStats && !streaming && (
            <div className="pg-runbar">
              <span className="pg-runbar-k">{t('Last run')}</span>
              <StatStrip stats={lastStats} />
            </div>
          )}

          <div className="pg-composer">
            <div className="pg-composer-box">
              <textarea ref={inputRef} value={input} rows={2} placeholder={t('Message the model, Ctrl+Enter to send')}
                aria-label={t('Message the model, Ctrl+Enter to send')}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
            </div>
            <div className="pg-composer-acts">
              <button type="button" className="btn ghost sm" onClick={() => setMessages(ms => [...ms, { role: 'user', content: '' }])}>
                <Plus style={{ width: 13, height: 13 }} /> {t('Add message')}
              </button>
              <button type="button" className="btn ghost sm" disabled={!messages.length}
                onClick={() => { setMessages([]); setRequest(null); }}>{t('Clear chat')}</button>
              {messages.length > 0 && (
                <CopyButton className="btn ghost sm pg-copy-all"
                  text={transcriptJson(messages, { model: model?.display_name, compare: rival?.display_name })}
                  label={t('Copy transcript as JSON')} />
              )}
              <span className="pg-spacer" />
              <span className="pg-hint">{t('Ctrl+Enter')}</span>
              {streaming
                ? <button type="button" className="btn stop" onClick={() => abortRef.current && abortRef.current.abort()}>
                    <Stop style={{ width: 13, height: 13 }} /> {t('Stop')}
                  </button>
                : <button type="button" className="btn primary" disabled={!modelId} onClick={send}>{t('Run')}</button>}
            </div>
          </div>
        </main>

        {showRequest && (
          <aside className="pg-req">
            <div className="pg-req-head">
              <span>{t('Request')}</span>
              <div className="pg-req-acts">
                <CopyButton text={request ? JSON.stringify(request, null, 2) : ''} label={t('Copy request')} />
                <button type="button" className="pg-mini" aria-label={t('Close')} onClick={() => setShowRequest(false)}>
                  <X style={{ width: 13, height: 13 }} />
                </button>
              </div>
            </div>
            <div className="pg-req-body">
              {request
                ? <pre>{JSON.stringify(request, null, 2)}</pre>
                : <div className="pg-note">{t('Send a message first.')}</div>}
            </div>
          </aside>
        )}
      </div>

      {promptFull && (
        <div className="pg-sheet" role="dialog" aria-modal="true" aria-label={t('System prompt')}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPromptFull(false); }}>
          <div className="pg-sheet-box">
            <div className="pg-sheet-head">
              <Pencil style={{ width: 14, height: 14 }} />
              <span className="pg-sheet-title">{t('System prompt')}</span>
              <span className="pg-model-tag">{model?.display_name || ''}</span>
              <span className="pg-spacer" />
              {changedKeys.includes('system_prompt') && (
                <button type="button" className="pg-revert" onClick={() => revert('system_prompt')}>{t('revert')}</button>
              )}
              <CopyButton text={merged.system_prompt || ''} label={t('Copy system prompt')} />
              <button type="button" className="pg-mini" aria-label={t('Close')} onClick={() => setPromptFull(false)}>
                <X style={{ width: 13, height: 13 }} />
              </button>
            </div>
            <textarea className="pg-sheet-ta" value={merged.system_prompt || ''} spellCheck={false} autoFocus
              placeholder={t('Sent as the system message. Nothing else is added, so what you see here is what the model gets.')}
              aria-label={t('System prompt')} onChange={(e) => set('system_prompt', e.target.value)} />
            <div className="pg-sheet-foot">
              <span>{promptSize.lines} {t('lines')} · {promptSize.chars} {t('characters')}</span>
              <span className="pg-spacer" />
              <span className="pg-hint">{t('Esc to close')}</span>
              <button type="button" className="btn primary sm" onClick={() => setPromptFull(false)}>{t('Done')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
