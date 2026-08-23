import { useState, useEffect, useRef } from 'react';
import { api } from '../../api.js';
import { Copy, Trash, Star } from '../icons.jsx';
import { Toggle, Switch, IconSlot, SystemPromptEditor, PromptField, StatusChips, CopyBtn, SegPick, bgPreviewStyle, BannerPicker } from './widgets.jsx';
import KwargsEditor from './KwargsEditor.jsx';
import { t, tk } from '../../i18n.jsx';
import { BRAND_ICON, BRAND_GENERATING, BRAND_THINKING } from '../../lib/brand.js';

export const ME_SECTIONS = [
  ['general', tk('General')],
  ['behavior', tk('Behavior')],
  ['tools', tk('Tools')],
  ['appearance', tk('Appearance')],
  ['advanced', tk('Advanced')]
];

const FIELD_INDEX = [
  { s: 'general', a: 'identity', label: tk('Name, model ID & provider'), k: tk('display name internal id backend connection rename') },
  { s: 'general', a: 'description', label: tk('Description'), k: tk('tagline subtitle picker text') },
  { s: 'general', a: 'sysprompt', label: tk('System prompt'), k: tk('instructions persona behavior prompt variables date user') },
  { s: 'general', a: 'visibility', label: tk('Visibility & availability'), k: tk('hidden default unavailable picker show hide') },
  { s: 'general', a: 'sunset', label: tk('Retirement date'), k: tk('sunset retire going away deprecate schedule date countdown') },
  { s: 'behavior', a: 'kwargs-list', label: tk('Request controls'), k: tk('kwarg kwargs effort reasoning slider toggle extended levels budget enable_thinking preserve_thinking chat_template_kwargs paired custom values default') },
  { s: 'behavior', a: 'reasoning', label: tk('Reasoning'), k: tk('think no_think token trigger mode open close delimiter stream collapsible hide thinking status expand extended prompt token') },
  { s: 'behavior', a: 'summaries', label: tk('Long conversations & context'), k: tk('summarize compact context window num ctx headroom recent turns detect trim drop prompt cache warm reuse prefill') },
  { s: 'tools', a: 'core-tools', label: tk('Capabilities'), k: tk('vision image input sandbox code files web search') },
  { s: 'tools', a: 'extra-tools', label: tk('Optional features'), k: tk('skills mcp connectors chat search end conversation long reminder') },
  { s: 'tools', a: 'tool-limit', label: tk('Tool-call limit'), k: tk('agent steps rounds maximum tools') },
  { s: 'appearance', a: 'logo', label: tk('Logo & motion'), k: tk('icon static generating thinking upload starburst motion size') },
  { s: 'appearance', a: 'in-chat', label: tk('In conversation'), k: tk('picker logo show name position avatar left above below') },
  { s: 'appearance', a: 'badges', label: tk('Badges'), k: tk('cap text vision reasoning compact labels') },
  { s: 'appearance', a: 'showcase', label: tk('Showcase background'), k: tk('backdrop image gradient css frosted glass') },
  { s: 'appearance', a: 'docs-page', label: tk('Public docs page'), k: tk('docs documentation catalog page intelligence speed modalities cutoff frontier featured compare') },
  { s: 'advanced', a: 'sampling', label: tk('Sampling'), k: tk('temperature top p top k min p penalty seed max tokens stop sequence dry xtc mirostat repetition') },
  { s: 'advanced', a: 'pricing', label: tk('Pricing'), k: tk('cost price input output per million usage preset') },
  { s: 'advanced', a: 'call-prompt', label: tk('Voice call prompt'), k: tk('call phone speech voice override') },
  { s: 'advanced', a: 'router', label: tk('Router'), k: tk('routing rules fallback matcher keyword regex model picker') }
];

const EyeIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" />
  </svg>
);
const EyeOffIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 3l18 18M10 5.9A9.9 9.9 0 0 1 12 5.5c6.5 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.4 6.9A16 16 0 0 0 2 12s3.5 6.5 10 6.5a10 10 0 0 0 3.4-.6" /><path d="M9.9 10.2a2.6 2.6 0 0 0 3.6 3.7" />
  </svg>
);

export function GroupLabel({ anchor, first, children }) {
  return <div className={'med-group' + (first ? ' first' : '')} data-anchor={anchor}>{children}</div>;
}

export function SubLabel({ children }) {
  return <div className="med-subhead">{children}</div>;
}

const MATCHERS = [
  ['keyword', tk('Message contains any of these words')],
  ['regex', tk('Message matches this regular expression')],
  ['hasImage', tk('Message has an image')],
  ['hasFile', tk('Message has an attachment')],
  ['hasCode', tk('Message looks like code')],
  ['shorterThan', tk('Message is shorter than N characters')],
  ['longerThan', tk('Message is longer than N characters')],
  ['always', tk('Always (catch-all)')],
];
const NEEDS_VALUE = new Set(['keyword', 'regex', 'shorterThan', 'longerThan']);

const SAMPLER_GROUPS = [
  [tk('Core'), tk('The ones you reach for most: how random the output is, and how long it runs.'), [
    ['temperature', tk('Temperature'), '0.0 – 2.0'], ['top_p', tk('Top P'), '0.0 – 1.0'],
    ['top_k', tk('Top K'), 'e.g. 40'], ['min_p', tk('Min P'), '0.0 – 1.0'],
    ['max_tokens', tk('Max tokens'), 'e.g. 2048'], ['seed', tk('Seed'), 'integer']
  ]],
  [tk('Repetition control'), tk('Discourage the model from repeating itself. DRY is llama.cpp only.'), [
    ['repetition_penalty', tk('Repetition penalty'), 'e.g. 1.1'], ['presence_penalty', tk('Presence penalty'), '-2.0 – 2.0'],
    ['frequency_penalty', tk('Frequency penalty'), '-2.0 – 2.0'],
    ['dry_multiplier', tk('DRY multiplier'), '0 = off, e.g. 0.8'], ['dry_base', tk('DRY base'), 'e.g. 1.75'],
    ['dry_allowed_length', tk('DRY allowed length'), 'e.g. 2'], ['dry_penalty_last_n', tk('DRY range'), '-1 = whole context']
  ]],
  [tk('Experimental samplers'), tk('XTC and Mirostat change how tokens are picked. Leave them off unless you are tuning deliberately.'), [
    ['xtc_probability', tk('XTC probability'), '0 = off, 0.0 – 1.0'], ['xtc_threshold', tk('XTC threshold'), 'e.g. 0.1'],
    ['mirostat', tk('Mirostat'), '0 off, 1 or 2'], ['mirostat_tau', tk('Mirostat tau'), 'e.g. 5.0'], ['mirostat_eta', tk('Mirostat eta'), 'e.g. 0.1']
  ]]
];

function SamplerGroup({ title, note, fields, m, set, collapsible }) {
  const filled = fields.filter(([k]) => m[k] !== '' && m[k] !== null && m[k] !== undefined).length;
  const [open, setOpen] = useState(!collapsible || filled > 0);
  if (!fields.length) return null;
  return (
    <div className={'samp-group' + (open ? ' open' : '')}>
      {collapsible ? (
        <button type="button" className="samp-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <span className="samp-caret">›</span>
          <span className="samp-title">{t(title)}</span>
          {filled > 0 && <span className="samp-badge">{filled}</span>}
        </button>
      ) : (
        <div className="samp-head static"><span className="samp-title">{t(title)}</span></div>
      )}
      {open && (
        <>
          <div className="muted-note samp-note">{t(note)}</div>
          <div className="sampling-grid">
            {fields.map(([k, label, ph]) => (
              <div className="samp-field" key={k}>
                <label>{t(label)}</label>
                <input type="number" step="any" placeholder={ph} value={m[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RoutingPane({ m, set, models }) {
  const rules = Array.isArray(m.router_rules) ? m.router_rules : [];
  const targets = models.filter(x => x.id !== m.id && x.kind !== 'router');
  const routers = models.filter(x => x.id !== m.id && x.kind === 'router');
  const pickable = [...targets, ...routers];
  const upd = (i, patch) => set('router_rules', rules.map((r, j) => j === i ? { ...r, ...patch } : r));
  const add = () => set('router_rules', [...rules, { match: 'keyword', value: '', modelId: targets[0]?.id || '', label: '' }]);
  const del = (i) => set('router_rules', rules.filter((_, j) => j !== i));
  const move = (i, d) => {
    const next = rules.slice();
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set('router_rules', next);
  };
  return (
    <>
      <div className="field row">
        <div>
          <label>{t("Use this model as a router")}</label>
          <div className="muted-note">{t("A router does not talk to a backend itself. It sits in the model picker like any other model, and when someone sends a message it hands the turn to whichever model matches first.")}</div>
        </div>
        <Switch on={m.kind === 'router'} label={t("Use this model as a router")} onToggle={() => set('kind', m.kind === 'router' ? 'model' : 'router')} />
      </div>
      {m.kind === 'router' && (
        <>
          <div className="field">
            <label>{t("Rules, in order")}</label>
            <div className="muted-note">{t("The first rule that matches wins. Anything that matches nothing goes to the fallback below.")}</div>
          </div>
          {!rules.length && <div className="muted-note rt-empty">{t("No rules yet. Everything will go to the fallback model.")}</div>}
          {rules.map((r, i) => (
            <div className="rt-rule" key={i}>
              <div className="rt-rule-head">
                <span className="rt-num">{i + 1}</span>
                <select value={r.match} onChange={(e) => upd(i, { match: e.target.value })}>
                  {MATCHERS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                </select>
                <button className="btn ghost sm" onClick={() => move(i, -1)} disabled={i === 0} title={t("Move up")}>↑</button>
                <button className="btn ghost sm" onClick={() => move(i, 1)} disabled={i === rules.length - 1} title={t("Move down")}>↓</button>
                <button className="btn ghost sm" onClick={() => del(i)} title={t("Remove")}>✕</button>
              </div>
              <div className="rt-rule-body">
                {NEEDS_VALUE.has(r.match) && (
                  <input value={r.value || ''} onChange={(e) => upd(i, { value: e.target.value })}
                    placeholder={r.match === 'keyword' ? t("translate, traducir, übersetzen") : r.match === 'regex' ? '^\\s*(fix|debug)\\b' : '400'} />
                )}
                <select value={r.modelId || ''} onChange={(e) => upd(i, { modelId: e.target.value })}>
                  <option value="">{t("Pick a model…")}</option>
                  {pickable.map(x => <option key={x.id} value={x.id}>{x.display_name || x.internal_name}{x.kind === 'router' ? ' ' + t('(router)') : ''}</option>)}
                </select>
                <input value={r.label || ''} onChange={(e) => upd(i, { label: e.target.value })} placeholder={t("Label, shown to users")} />
              </div>
            </div>
          ))}
          <div className="btn-row rt-actions"><button className="btn ghost" onClick={add}>{t("Add rule")}</button></div>
          <div className="field rt-fallback">
            <label>{t("Fallback model")}</label>
            <div className="muted-note">{t("Used when no rule matches. A router without a fallback will refuse the turn rather than guess.")}</div>
            <select value={m.router_default || ''} onChange={(e) => set('router_default', e.target.value)}>
              <option value="">{t("None")}</option>
              {pickable.map(x => <option key={x.id} value={x.id}>{x.display_name || x.internal_name}</option>)}
            </select>
          </div>
        </>
      )}
    </>
  );
}

const RESET_SCROLL = (key, el) => { if (el) el.scrollTop = 0; };

export default function ModelEditor({ m, onChange, onDelete, onDuplicate, autosaveState, providers = [], providerTypes = {}, models = [], section = 'general', onSection, keepScroll = RESET_SCROLL, kwargOpen, onKwargToggle, onKwargOpen }) {
  const [spOpen, setSpOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState('');
  const [preset, setPreset] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [outline, setOutline] = useState([]);
  const [seen, setSeen] = useState('');
  const bgRef = useRef(null);
  const bodyRef = useRef(null);
  const nameRef = useRef(null);
  const set = (k, v) => onChange({ ...m, [k]: v });

  const kwargCount = Array.isArray(m.kwargs) ? m.kwargs.length : 0;
  const hasKwargs = kwargCount > 0;

  useEffect(() => {
    let alive = true;
    const name = (m.internal_name || '').trim();
    if (!name) { setPreset(null); return; }
    api.get('/api/admin/pricing/preset?name=' + encodeURIComponent(name)).then(r => { if (alive) setPreset(r.preset || null); }).catch(() => {});
    return () => { alive = false; };
  }, [m.internal_name]);

  useEffect(() => { if (renaming) requestAnimationFrame(() => { nameRef.current?.focus(); nameRef.current?.select(); }); }, [renaming]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const drop = keepScroll('me:' + section, body);
    const marks = [...body.querySelectorAll('.med-group[data-anchor]')];
    setOutline(marks.map(el => ({ a: el.dataset.anchor, label: el.textContent || '' })));
    setSeen(marks[0]?.dataset.anchor || '');
    if (!marks.length) return;
    const atEnd = () => body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
    const io = new IntersectionObserver((entries) => {
      if (atEnd()) { setSeen(marks[marks.length - 1].dataset.anchor); return; }
      const hit = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setSeen(hit.target.dataset.anchor);
    }, { root: body, rootMargin: '0px 0px -70% 0px', threshold: 0 });
    marks.forEach(el => io.observe(el));
    const onScroll = () => { if (atEnd()) setSeen(marks[marks.length - 1].dataset.anchor); };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => { io.disconnect(); body.removeEventListener('scroll', onScroll); if (drop) drop(); };
  }, [section, m.id, kwargCount, m.is_router, m.enable_summaries, keepScroll]);

  function goTo(a) {
    const el = bodyRef.current?.querySelector(`[data-anchor="${a}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const applyPreset = () => preset && onChange({ ...m, cost_in: preset.in, cost_out: preset.out });
  const clearPrice = () => onChange({ ...m, cost_in: null, cost_out: null });
  async function pickBg(e) { const f = e.target.files?.[0]; if (!f) return; try { const { url } = await api.upload(f); set('bg_image', url); } catch {} e.target.value = ''; }
  const curProvider = providers.find(p => p.id === m.provider_id) || providers[0];
  const curType = curProvider ? providerTypes[curProvider.type] : null;
  const allowedSamplers = curType?.samplers || ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'];

  async function detect() {
    setDetecting(true); setDetectMsg('');
    try {
      const r = await api.get('/api/admin/detect-ctx?model=' + encodeURIComponent(m.internal_name || '') + '&provider=' + encodeURIComponent(m.provider_id || ''));
      if (r.ok && r.numCtx) { set('num_ctx', r.numCtx); setDetectMsg(t('Detected ') + r.numCtx.toLocaleString() + ' tokens.'); }
      else setDetectMsg(t('Could not detect from the server, enter it manually.'));
    } catch { setDetectMsg(t('Could not detect from the server, enter it manually.')); }
    setDetecting(false);
  }

  const priced = Number(m.cost_in) === preset?.in && Number(m.cost_out) === preset?.out;

  const fq = findQ.trim().toLowerCase();
  const findHits = fq ? FIELD_INDEX.filter(f => [f.label, f.k].map(v => v + ' ' + t(v)).join(' ').toLowerCase().includes(fq)).slice(0, 7) : [];
  function jumpTo(hit) {
    setFindQ('');
    if (onSection) onSection(hit.s);
    setTimeout(() => {
      const el = bodyRef.current?.querySelector(`[data-anchor="${hit.a}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('jump-hit');
      setTimeout(() => el.classList.remove('jump-hit'), 1800);
    }, 60);
  }

  return (
    <div className="med">
      <div className="med-head">
        {m.static_icon ? <img className="med-icon" src={m.static_icon} alt="" /> : <span className="med-icon noicon">{(m.display_name || '?').trim().charAt(0).toUpperCase()}</span>}
        <div className="med-id">
          {renaming ? (
            <input ref={nameRef} className="med-rename" value={m.display_name || ''}
              onChange={(e) => set('display_name', e.target.value)}
              onBlur={() => setRenaming(false)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setRenaming(false); }} />
          ) : (
            <button type="button" className="med-name" title={t("Click to rename")} onClick={() => setRenaming(true)}>{m.display_name || t('Untitled model')}</button>
          )}
          <div className="med-sub">
            <span className="med-sub-text">{m.internal_name || 'no model id'}</span>
            {!!(m.internal_name || '').trim() && <CopyBtn text={m.internal_name} title={t("Copy model ID")} />}
          </div>
        </div>
        <StatusChips m={m} />
        <div className="med-actions">
          <button type="button" className={'med-act' + (m.is_default ? ' star-on' : '')} title={m.is_default ? t('Default model') : t('Make default')} onClick={() => set('is_default', m.is_default ? 0 : 1)}><Star style={{ width: 16 }} /></button>
          <button type="button" className="med-act" title={m.enabled ? t('Visible to users, click to hide') : t('Hidden from users, click to show')} onClick={() => set('enabled', m.enabled ? 0 : 1)}>{m.enabled ? <EyeIcon style={{ width: 16 }} /> : <EyeOffIcon style={{ width: 16 }} />}</button>
          {onDuplicate && <button type="button" className="med-act dup" title={t("Duplicate model")} onClick={() => onDuplicate(m.id)}><Copy style={{ width: 16 }} /></button>}
          <button type="button" className="med-act del" title={t("Delete model")} onClick={() => onDelete(m.id)}><Trash style={{ width: 16 }} /></button>
        </div>
      </div>

      <div className="med-bar">
        <div className="med-tabs">
          {ME_SECTIONS.map(([id, label]) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => onSection && onSection(id)}>{t(label)}</button>
          ))}
        </div>
        <div className="med-find">
          <input value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder={t("Find a setting…")}
            onKeyDown={(e) => { if (e.key === 'Enter' && findHits.length) jumpTo(findHits[0]); if (e.key === 'Escape') setFindQ(''); }} />
          {findHits.length > 0 && (
            <div className="med-find-menu">
              {findHits.map(h => (
                <button key={h.s + h.a} onClick={() => jumpTo(h)}>
                  <span>{t(h.label)}</span>
                  <em>{t(ME_SECTIONS.find(([id]) => id === h.s)?.[1] || '')}</em>
                </button>
              ))}
            </div>
          )}
          {fq && !findHits.length && <div className="med-find-menu"><div className="med-find-none">{t("No matching setting.")}</div></div>}
        </div>
      </div>

      <div className="med-main">
      {outline.length > 1 && (
        <nav className="med-outline" aria-label={t("Sections on this tab")}>
          {outline.map(o => (
            <button key={o.a} className={seen === o.a ? 'on' : ''} onClick={() => goTo(o.a)}>{o.label}</button>
          ))}
        </nav>
      )}

      <div className="med-body" ref={bodyRef}>
        {section === 'general' && (
          <div className="med-pane">
            <GroupLabel anchor="identity" first>{t("Identity")}</GroupLabel>
            <div className="two-col">
              <div className="field"><label>{t("Display name")}</label>
                <input value={m.display_name || ''} onChange={(e) => set('display_name', e.target.value)} /></div>
              <div className="field"><label>{t("Model ID")}</label>
                <input value={m.internal_name || ''} onChange={(e) => set('internal_name', e.target.value)} placeholder={t("llama-3.1-8b-instruct")} /></div>
            </div>
            <div className="field"><label>{t("Provider")}</label>
              <select value={m.provider_id || (providers[0]?.id || '')} onChange={(e) => set('provider_id', e.target.value)}>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name} ({providerTypes[p.type]?.label || p.type})</option>)}
              </select>
              <div className="muted-note">{t("The connection this model runs through. Add or edit connections in the Providers section.")}</div>
            </div>
            <div className="field" data-anchor="description"><label>{t("Description")}</label>
              <input value={m.description || ''} onChange={(e) => set('description', e.target.value)} placeholder={t("For complex tasks")} />
              <div className="muted-note">{t("Shown under the model's name in the picker.")}</div>
            </div>

            <GroupLabel anchor="sysprompt">{t("System prompt")}</GroupLabel>
            <PromptField value={m.system_prompt || ''} onChange={(v) => set('system_prompt', v)}
              onExpand={() => setSpOpen(true)} placeholder={t("You are a helpful assistant…")}
              hint={t("Defines how this model behaves. The date and user chips insert variables that are filled in locally on each message.")} />
            {spOpen && <SystemPromptEditor value={m.system_prompt || ''} onChange={(v) => set('system_prompt', v)} onClose={() => setSpOpen(false)} />}

            <GroupLabel anchor="visibility">{t("Visibility & availability")}</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="is_default" label={t("Set as default")} note={t("Pre-selected for users on first login. Only one model can be the default.")} />
              <div className="field row">
                <div><label>{t("Hidden")}</label><div className="muted-note">{t("Stays in your admin list but is removed from every user's model picker.")}</div></div>
                <Switch on={!m.enabled} label={t("Hidden")} onToggle={() => set('enabled', m.enabled ? 0 : 1)} />
              </div>
              <Toggle m={m} set={set} k="unavailable" label={t("Temporarily unavailable")} note={t("Stays visible in the picker but users can't select it, and a banner explains why. Admins can still use it for testing.")} />
              {!!m.unavailable && (
                <div className="field"><label>{t("Unavailability message")}</label>
                  <textarea rows={3} value={m.unavailable_reason || ''} onChange={(e) => set('unavailable_reason', e.target.value)} placeholder={t("e.g. Down for maintenance, back shortly.")} /></div>
              )}
              <div className="field row" data-anchor="sunset">
                <div>
                  <label>{t("Retire on a date")}</label>
                  <div className="muted-note">{t("Users see a countdown banner in the chat that shifts toward red as the date approaches. On the date, the action below runs automatically, for users too, even without a manual push.")}</div>
                </div>
                <input type="date" value={m.sunset_at || ''} onChange={(e) => onChange({ ...m, sunset_at: e.target.value, sunset_action: m.sunset_action || 'hide' })} style={{ width: 160, flexShrink: 0 }} />
              </div>
              {!!m.sunset_at && (
                <div className="field row">
                  <div>
                    <label>{t("When the date arrives")}</label>
                    <div className="muted-note">{t("Hide removes it from every picker. Unavailable keeps it listed but unselectable, with a retirement notice.")}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <SegPick value={m.sunset_action || 'hide'} options={[['hide', tk('Hide')], ['unavailable', tk('Unavailable')]]} onChange={(v) => set('sunset_action', v)} />
                    <button type="button" className="btn ghost" onClick={() => onChange({ ...m, sunset_at: '' })}>{t("Clear")}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'behavior' && (
          <div className="med-pane">
            <GroupLabel anchor="reasoning" first>{t("Reasoning")}</GroupLabel>
            <div className="muted-note med-lede">{t("How this model thinks before it answers, and how much of that the user gets to see.")}</div>

            <SubLabel>{t("What users see")}</SubLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="reasoning_collapsible" inverted label={t("Show reasoning to users")} note={t("When on, users can expand and read the thought process. When off, they see only a 'Thinking…' status.")} />
              {m.reasoning_collapsible === 0 && <Toggle m={m} set={set} k="hide_thinking" label={t('Hide the "Thinking…" status too')} note={t("No thinking indicator at all, the model just appears to be generating normally while it reasons.")} />}
            </div>

            <SubLabel>{t("Output tags")}</SubLabel>
            <div className="two-col">
              <div className="field"><label>{t("Reasoning start tag")}</label>
                <input value={m.think_open || ''} onChange={(e) => set('think_open', e.target.value)} placeholder="<think>" /></div>
              <div className="field"><label>{t("Reasoning end tag")}</label>
                <input value={m.think_close || ''} onChange={(e) => set('think_close', e.target.value)} placeholder="</think>" /></div>
            </div>
            <div className="muted-note">How the model delimits its reasoning in the output stream. Leave blank to use the default {'<think>…</think>'}.</div>

            <SubLabel>{t("Prompt-token switching")}</SubLabel>
            {!hasKwargs && !!m.effort_enabled && (
              <div className="muted-note" style={{ marginBottom: 10 }}>{t("This model still uses the old thinking control. Convert it below.")}</div>
            )}
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="has_reasoning" label={t("Switch modes with a prompt token")} note={t("For models that change thinking mode via a token in the system prompt. Adds the Extended toggle for users.")} />
            </div>
            {!!m.has_reasoning && <>
              <div className="two-col">
                <div className="field"><label>{t("Extended-mode trigger")}</label>
                  <input value={m.reasoning_token || ''} onChange={(e) => set('reasoning_token', e.target.value)} placeholder={t("/think")} /></div>
                <div className="field"><label>{t("Standard-mode trigger")}</label>
                  <input value={m.non_reasoning_token || ''} onChange={(e) => set('non_reasoning_token', e.target.value)} placeholder={t("/no_think")} /></div>
              </div>
              <div className="muted-note">{t("Appended to the system prompt, on its own line, depending on whether the user has Extended turned on.")}</div>
            </>}

            <GroupLabel anchor="summaries">{t("Long conversations")}</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="enable_summaries" label={t("Auto-summarize long chats")} note={t("When a conversation nears the context window, older turns are compacted into a summary so it can keep going.")} />
            </div>
            {!!m.enable_summaries && <>
              <div className="field"><label>{t("Context window")}</label>
                <div className="ctx-row">
                  <input type="number" min="0" value={m.num_ctx ?? ''} onChange={(e) => set('num_ctx', e.target.value)} placeholder={t("e.g. 32768")} />
                  <button className="btn" type="button" onClick={detect} disabled={detecting}>{detecting ? t('Detecting…') : t('Detect')}</button>
                </div>
                <div className="muted-note">{detectMsg || 'The model\u2019s maximum context in tokens. Detect asks the provider; otherwise enter it manually.'}</div>
              </div>
              <div className="field"><label>{t("Context headroom")} <span className="muted-note" style={{ display: 'inline' }}>(%)</span></label>
                <input type="number" step="1" min="3" max="60" value={Math.round((m.summary_padding ?? 0.125) * 100)} onChange={(e) => set('summary_padding', (parseFloat(e.target.value) || 0) / 100)} style={{ maxWidth: 140 }} />
                <div className="muted-note">{t("Summarize once the chat fills past this much of the context window's free space. 12% leaves a safety margin.")}</div>
              </div>
              <div className="field"><label>{t("Recent turns kept verbatim")}</label>
                <input type="number" step="1" min="1" max="40" value={m.recent_window ?? 4} onChange={(e) => set('recent_window', parseInt(e.target.value) || 4)} style={{ maxWidth: 140 }} />
                <div className="muted-note">{t("The newest messages are never summarized, they stay word-for-word. Higher keeps more recent detail but uses more context.")}</div>
              </div>
            </>}
            <div className="field"><label>{t("When the chat outgrows the window")}</label>
              <SegPick value={m.ctx_trim_mode === 'cache' ? 'cache' : 'retain'} onChange={(v) => set('ctx_trim_mode', v)}
                options={[['retain', tk('Keep as much history as possible')], ['cache', tk('Keep the prompt cache warm')]]} />
              <div className="muted-note">{t("Keeping history drops the least it can get away with, which means the prompt changes every turn and a local backend has to re-read the whole conversation each time. Keeping the cache warm drops further than needed, so the prompt stays identical for several turns and only the new message is processed. Much faster on long chats, at the cost of forgetting older turns sooner.")}</div>
            </div>

            <GroupLabel anchor="kwargs-list">{t("Request controls")}</GroupLabel>
            <div className="muted-note med-lede">
              {hasKwargs
                ? t("{n} extra value(s) are sent with every request to this model. Each one can appear in the model picker with your own wording, stay hidden, or follow another control so two values always move together.", { n: kwargCount })
                : t("Extra values sent with every request to this model, such as thinking budgets and reasoning levels. Each one can appear in the model picker with your own wording, stay hidden, or follow another control so two values always move together.")}
            </div>
            <KwargsEditor m={m} onChange={onChange} open={kwargOpen} onToggle={onKwargToggle} onOpen={onKwargOpen} />
          </div>
        )}

        {section === 'tools' && (
          <div className="med-pane">
            <GroupLabel anchor="core-tools" first>{t("Capabilities")}</GroupLabel>
            <div className="muted-note med-lede">{t("What this model is allowed to do. Users can turn the optional ones on per chat.")}</div>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="has_vision" label={t("Image input")} note={t("Let users attach images for the model to see. Off = non-image files only.")} />
              <Toggle m={m} set={set} k="sandbox_allowed" inverted label={t("Allow sandbox tools")} note={t("Lets users enable code and file tools for this model. Off means sandbox can't be turned on.")} />
              {m.sandbox_allowed !== 0 && <Toggle m={m} set={set} k="sandbox_auto" label={t("Enable sandbox by default")} note={t("New chats with this model start with sandbox tools on.")} />}
              <Toggle m={m} set={set} k="web_search_allowed" inverted label={t("Allow web search")} note={t("Lets users enable web search for this model (web search must also be configured in the Web Search section).")} />
              {m.web_search_allowed !== 0 && <Toggle m={m} set={set} k="web_search_auto" label={t("Enable web search by default")} note={t("New chats with this model start with web search on.")} />}
            </div>

            <GroupLabel anchor="extra-tools">{t("Optional features")}</GroupLabel>
            <div className="muted-note med-lede">{t("All off by default. Turn on only what this model handles well.")}</div>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="skills_allowed" label={t("Skills")} note={t("Lets this model load admin-created skills from the Skills section.")} />
              <Toggle m={m} set={set} k="mcp_allowed" label={t("MCP connectors")} note={t("Exposes tools from enabled MCP servers to this model.")} />
              <Toggle m={m} set={set} k="chat_search_allowed" label={t("Past-chat search")} note={t("Lets this model search the user's own previous conversations (also requires the global toggle in Memory).")} />
              <Toggle m={m} set={set} k="long_convo_reminder" label={t("Long conversation awareness")} note={t("Gives the model the conversation's start time, duration, and timestamps so it can gently suggest breaks during very long sessions.")} />
              <Toggle m={m} set={set} k="end_chat_allowed" label={t("End conversation tool")} note={t("Lets the model permanently end a chat. Ended chats cannot be continued, edited, regenerated, or branched.")} />
            </div>
            {!!m.end_chat_allowed && (
              <div className="field"><label>{t("End-conversation instructions")}</label>
                <textarea rows={4} value={m.end_chat_prompt ?? ''} onChange={(e) => set('end_chat_prompt', e.target.value)} placeholder={t('End the conversation if the user repeatedly…')} />
                <div className="muted-note">{t("Appended to the system prompt to tell the model WHEN it should end conversations. Leave blank to append nothing beyond the basic tool description.")}</div>
              </div>
            )}
            <div className="field" data-anchor="tool-limit"><label>{t("Tool-call limit")}</label>
              <input type="number" min="0" value={m.agent_steps || ''} placeholder={t("Unlimited")} onChange={(e) => set('agent_steps', e.target.value)} style={{ maxWidth: 140 }} />
              <div className="muted-note">{t("Maximum tool rounds per response. Leave blank or 0 for unlimited.")}</div>
            </div>
          </div>
        )}

        {section === 'appearance' && (
          <div className="med-pane">
            <GroupLabel anchor="logo" first>{t("Logo & motion")}</GroupLabel>
            <div className="field">
              <div className="icon-grid">
                <IconSlot label={t("Static")} value={m.static_icon} def="" onChange={(v) => set('static_icon', v)} />
                <IconSlot label={t("Generating")} value={m.generating_icon} def={m.static_icon || ''} anim={(m.generating_anim || 'none') === 'none' ? '' : (m.generating_anim || 'none')} onChange={(v) => set('generating_icon', v)} />
                <IconSlot label={t("Thinking")} value={m.thinking_icon} def={m.static_icon || ''} anim={(m.thinking_anim || 'none') === 'none' ? '' : (m.thinking_anim || 'none')} onChange={(v) => set('thinking_icon', v)} />
              </div>
              <div className="icon-grid anim-row">
                <div />
                <select className="anim-sel" value={m.generating_anim || 'none'} onChange={(e) => set('generating_anim', e.target.value)}>
                  <option value="spin">{t("Spin")}</option><option value="pulse">{t("Breathe")}</option><option value="bounce">{t("Bounce")}</option><option value="wobble">{t("Wobble")}</option><option value="fade">{t("Fade")}</option><option value="sprite">{t("Frames")}</option><option value="none">{t("No motion")}</option>
                </select>
                <select className="anim-sel" value={m.thinking_anim || 'none'} onChange={(e) => set('thinking_anim', e.target.value)}>
                  <option value="pulse">{t("Breathe")}</option><option value="spin">{t("Spin")}</option><option value="bounce">{t("Bounce")}</option><option value="wobble">{t("Wobble")}</option><option value="fade">{t("Fade")}</option><option value="none">{t("No motion")}</option>
                </select>
              </div>
              <div className="icon-actions">
                {!m.static_icon
                  ? <button type="button" className="btn ghost" onClick={() => onChange({ ...m, static_icon: BRAND_ICON, generating_icon: BRAND_GENERATING, thinking_icon: BRAND_THINKING })}>{t("Use starburst icon")}</button>
                  : <button type="button" className="btn ghost" onClick={() => onChange({ ...m, static_icon: '', generating_icon: '', thinking_icon: '' })}>{t("Remove icon")}</button>}
              </div>
              <div className="muted-note">{t("With no icon set the model shows no logo in chat or the picker. Click a slot to upload a png, svg, jpeg, or gif, or use the starburst. Generating and Thinking fall back to the static logo when left empty.")}</div>
            </div>
            <div className="field">
              <label>{t("Icon size")} <span className="muted-note" style={{ display: 'inline' }}>{(m.icon_size || 40)}px</span></label>
              <div className="icon-size-row">
                <input type="range" min="14" max="64" value={m.icon_size || 40} onChange={(e) => set('icon_size', parseInt(e.target.value))} />
                <button className="btn ghost icon-size-reset" disabled={!m.icon_size} onClick={() => set('icon_size', 0)}>{t("Reset")}</button>
              </div>
              <div className="muted-note">{t("Size of the model's icon shown beside its messages. Default is 40px. Legacy is 26px.")}</div>
            </div>

            <GroupLabel anchor="in-chat">{t("In conversation")}</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="dropdown_icon" inverted label={t("Show logo in picker")} note={t("Display this model's static logo next to its name in the model picker.")} />
              <Toggle m={m} set={set} k="show_name" label={t("Show model name")} note={t("Display this model's name next to its logo on assistant messages.")} />
            </div>
            <div className="field">
              <label>{t("Logo position")}</label>
              <SegPick value={m.icon_position || 'below'} options={[['above', tk('Above text')], ['below', tk('Below text')], ['left', tk('Left of text')]]} onChange={(v) => set('icon_position', v)} />
              <div className="muted-note">{t("Where the logo sits relative to the message it generates. \"Left of text\" places it as an avatar in a gutter beside the message.")}</div>
            </div>

            <GroupLabel anchor="badges">{t("Badges")}</GroupLabel>
            <div className="muted-note" style={{ marginBottom: 4 }}>{t("Cosmetic labels shown beside the model in the picker. They don't change behaviour.")}</div>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="cap_text" label={t("Text-only badge")} note={t("Marks the model as accepting text input only.")} />
              <Toggle m={m} set={set} k="cap_vision" label={t("Image badge")} note={t("Marks the model as accepting images.")} />
              <Toggle m={m} set={set} k="cap_reasoning" label={t("Reasoning badge")} note={t("Marks the model as able to reason.")} />
              <Toggle m={m} set={set} k="cap_compact" label={t("Combine into a single badge")} note={t("Collapse the badges into one ⓘ that reveals them on hover.")} />
            </div>

            <GroupLabel anchor="showcase">{t("Showcase background")}</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="bg_enabled" label={t("Showcase background")} note={t("Show a custom backdrop behind the whole interface when this model is selected. UI panels turn to frosted glass to blend in.")} />
            </div>
            {!!m.bg_enabled && (
              <div className="field">
                <label>{t("Background image or CSS")}</label>
                <button type="button" className="bg-preview" style={bgPreviewStyle(m.bg_image)} onClick={() => bgRef.current?.click()} title={t("Click to upload an image")}>
                  {!m.bg_image && <span className="bg-preview-empty">{t("Click to upload an image")}</span>}
                </button>
                <input ref={bgRef} type="file" hidden onChange={pickBg} accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*" />
                <input value={m.bg_image || ''} onChange={(e) => set('bg_image', e.target.value)} placeholder={t("Image URL, or a CSS gradient")} />
                <div className="bg-up-row">
                  <button type="button" className="btn ghost" onClick={() => bgRef.current?.click()}>{t("Upload image…")}</button>
                  {m.bg_image && <button type="button" className="btn ghost" onClick={() => set('bg_image', '')}>{t("Clear")}</button>}
                </div>
                <div className="muted-note">{t("Paste an image URL, upload a file, or use a CSS gradient such as linear-gradient(120deg, #a0c4ff, #ffc6ff).")}</div>
              </div>
            )}

            <GroupLabel anchor="docs-page">{t("Public docs page")}</GroupLabel>
            <div className="muted-note" style={{ marginBottom: 14 }}>{t("Everything here feeds the public model docs users open from the chat header. The name, logo, description, context window, and prices come from other tabs; these fields add the rest.")}</div>
            <div className="med-toggle-card">
              <div className="field row">
                <div><label>{t("Frontier model")}</label><div className="muted-note">{t("Featured in the showcase row at the top of the docs, with a banner image.")}</div></div>
                <Switch on={!!m.docs_featured} label={t("Frontier model")} onToggle={() => set('docs_featured', m.docs_featured ? 0 : 1)} />
              </div>
              {!!m.docs_featured && (
                <div className="field"><label>{t("Showcase banner")}</label>
                  <BannerPicker value={m.docs_image || ''} onChange={(v) => set('docs_image', v)} />
                  <div className="muted-note">{t("Upload a photo (cropped to the wide banner shape and stored locally) or use a CSS gradient. Shown above the model name in the Frontier models row; leave empty for a plain card.")}</div></div>
              )}
            </div>
            <SubLabel>{t("Docs logo")}</SubLabel>
            <div className="field">
              <div className="muted-note" style={{ marginBottom: 8 }}>{t("Optional docs-only logo. The docs use the model's regular logo unless you set one here; it never affects the chat or picker.")}</div>
              <div className="icon-grid" style={{ gridTemplateColumns: '1fr' }}>
                <IconSlot label={t("Docs logo")} value={m.docs_icon || ''} def="" anim="" onChange={(v) => set('docs_icon', v)} />
              </div>
            </div>
            <SubLabel>{t("Ratings")}</SubLabel>
            <div className="two-col">
              <div className="field"><label>{t("Intelligence")} ({m.docs_intelligence || 0}/5)</label>
                <input type="range" min="0" max="5" step="1" value={m.docs_intelligence || 0} onChange={(e) => set('docs_intelligence', e.target.value)} />
                <div className="muted-note">{t("0 hides the meter. Shown as filled dots.")}</div></div>
              <div className="field"><label>{t("Speed")} ({m.docs_speed || 0}/5)</label>
                <input type="range" min="0" max="5" step="1" value={m.docs_speed || 0} onChange={(e) => set('docs_speed', e.target.value)} />
                <div className="muted-note">{t("0 hides the meter. Shown as lightning bolts.")}</div></div>
            </div>
            <SubLabel>{t("Modalities")}</SubLabel>
            <div className="two-col">
              <div className="field"><label>{t("Input")}</label>
                {[['docs_in_text', tk('Text')], ['docs_in_image', tk('Image')], ['docs_in_audio', tk('Audio')], ['docs_in_video', tk('Video')]].map(([k, l]) => (
                  <label key={k} className="inline-toggle" style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
                    <span>{t(l)}</span>
                    <Switch
                      on={k === 'docs_in_text' ? m[k] !== 0 : (k === 'docs_in_image' ? (!!m[k] || !!m.has_vision) : !!m[k])}
                      label={t(l)}
                      onToggle={() => set(k, (k === 'docs_in_text' ? m[k] !== 0 : !!m[k]) ? 0 : 1)} />
                  </label>
                ))}
              </div>
              <div className="field"><label>{t("Output")}</label>
                {[['docs_out_text', tk('Text')], ['docs_out_image', tk('Image')], ['docs_out_audio', tk('Audio')], ['docs_out_video', tk('Video')]].map(([k, l]) => (
                  <label key={k} className="inline-toggle" style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
                    <span>{t(l)}</span>
                    <Switch
                      on={k === 'docs_out_text' ? m[k] !== 0 : !!m[k]}
                      label={t(l)}
                      onToggle={() => set(k, (k === 'docs_out_text' ? m[k] !== 0 : !!m[k]) ? 0 : 1)} />
                  </label>
                ))}
              </div>
            </div>
            <SubLabel>{t("Facts")}</SubLabel>
            <div className="two-col">
              <div className="field"><label>{t("Max output tokens")}</label>
                <input type="number" min="0" step="1" value={m.docs_max_output ?? ''} onChange={(e) => set('docs_max_output', e.target.value)} placeholder="128000" />
                <div className="muted-note">{t("Blank hides the row. The context window comes from the Behavior tab.")}</div></div>
              <div className="field"><label>{t("Knowledge cutoff")}</label>
                <input value={m.docs_cutoff || ''} onChange={(e) => set('docs_cutoff', e.target.value)} placeholder={t("e.g. Feb 16, 2026")} />
                <div className="muted-note">{t("Free text, shown as a fact row. Blank hides it.")}</div></div>
            </div>
            <SubLabel>{t("Long description")}</SubLabel>
            <div className="field">
              <textarea rows={6} value={m.docs_body || ''} onChange={(e) => set('docs_body', e.target.value)} placeholder={t("A few paragraphs about what this model is best at. Shown on its docs page under the header.")} />
            </div>
          </div>
        )}

        {section === 'advanced' && (
          <div className="med-pane">
            <GroupLabel anchor="sampling" first>{t("Sampling")}</GroupLabel>
            <div className="muted-note">Optional overrides sent with each request. Leave a field blank to use the provider's default. Only parameters supported by {curType?.label || 'this provider'} are shown.</div>
            {SAMPLER_GROUPS.map(([title, note, fields], i) => (
              <SamplerGroup key={title} title={title} note={note} m={m} set={set} collapsible={i > 0}
                fields={fields.filter(([k]) => allowedSamplers.includes(k))} />
            ))}
            {allowedSamplers.includes('stop') && (
              <div className="field"><label>{t("Stop sequences")}</label>
                <textarea rows={3} value={m.stop ?? ''} onChange={(e) => set('stop', e.target.value)} placeholder={'</s>\n<|im_end|>'} />
                <div className="muted-note">{t("One per line. Generation stops as soon as any of them appears, and the sequence itself is not shown. Useful when a model's chat template leaks its own end-of-turn marker. Up to {n} are sent.", { n: curType?.stopMax || 4 })}</div>
              </div>
            )}

            <GroupLabel anchor="pricing">{t("Pricing")}</GroupLabel>
            <div className="muted-note">{t("Optional. Used to estimate cost in each user's Usage tab. Prices are per 1,000,000 tokens. Leave blank or 0 for local or free models.")}</div>
            {preset && (
              <div className="med-preset">
                <span>{t("Recognized as {name} (${in}/{out} per 1M).", { name: preset.label, in: preset.in, out: preset.out })} {priced ? t("Applied.") : t("You can apply or override it.")}</span>
                {!priced && <button type="button" className="btn" onClick={applyPreset}>{t("Apply preset")}</button>}
              </div>
            )}
            <div className="sampling-grid">
              <div className="samp-field">
                <label>{t("Input $ / 1M tokens")}</label>
                <input type="number" step="any" min="0" placeholder={t("e.g. 3.00")} value={m.cost_in ?? ''} onChange={(e) => set('cost_in', e.target.value)} />
              </div>
              <div className="samp-field">
                <label>{t("Output $ / 1M tokens")}</label>
                <input type="number" step="any" min="0" placeholder={t("e.g. 15.00")} value={m.cost_out ?? ''} onChange={(e) => set('cost_out', e.target.value)} />
              </div>
            </div>
            {(m.cost_in != null || m.cost_out != null) && (
              <button type="button" className="linklike" style={{ marginTop: 10 }} onClick={clearPrice}>{t("Clear price (treat as local / free)")}</button>
            )}

            <GroupLabel anchor="call-prompt">{t("Voice calls")}</GroupLabel>
            <div className="field">
              <label>{t("Call system prompt")} <span className="muted-note" style={{ display: 'inline' }}>{t("(optional)")}</span></label>
              <textarea rows={4} value={m.call_prompt || ''} onChange={(e) => set('call_prompt', e.target.value)} placeholder={t("You are on a voice call. Keep replies short and conversational, a couple of sentences. No markdown, no lists, no code.")} />
              <div className="muted-note">{t("Replaces the system prompt whenever a message comes in through a voice call. Leave empty to use the regular prompt during calls too.")}</div>
            </div>

            <GroupLabel anchor="router">{t("Router")}</GroupLabel>
            <RoutingPane m={m} set={set} models={models} />
          </div>
        )}
      </div>
      </div>

      <div className="med-foot">
        <span className={'autosave-dot' + (autosaveState === 'saved' ? ' flash' : '')} />
        {autosaveState === 'saving' ? 'Saving…' : autosaveState === 'saved' ? t('All changes saved to draft') : t('Edits save automatically to your draft')}
      </div>
    </div>
  );
}
