import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../api.js';
import { Copy, Trash, Star } from '../icons.jsx';
import { Toggle, IconSlot, SystemPromptEditor, StatusChips, CopyBtn, SegPick, bgPreviewStyle } from './widgets.jsx';

export const ME_SECTIONS = [
  ['essentials', 'Essentials'],
  ['reasoning', 'Reasoning'],
  ['tools', 'Tools'],
  ['appearance', 'Appearance'],
  ['advanced', 'Advanced']
];

const FIELD_INDEX = [
  { s: 'essentials', a: 'identity', label: 'Name, model ID & provider', k: 'display name internal id backend connection rename' },
  { s: 'essentials', a: 'description', label: 'Description', k: 'tagline subtitle picker text' },
  { s: 'essentials', a: 'sysprompt', label: 'System prompt', k: 'instructions persona behavior prompt' },
  { s: 'essentials', a: 'visibility', label: 'Visibility & default', k: 'hidden default unavailable picker show hide' },
  { s: 'reasoning', a: 'thinking', label: 'Thinking control', k: 'effort reasoning slider toggle kwarg extended levels' },
  { s: 'reasoning', a: 'tags', label: 'Reasoning tags', k: 'think open close delimiter stream' },
  { s: 'reasoning', a: 'reveal', label: 'Show reasoning to users', k: 'collapsible hide thinking status expand' },
  { s: 'reasoning', a: 'summaries', label: 'Long conversations & context', k: 'summarize compact context window num ctx headroom recent turns detect' },
  { s: 'tools', a: 'core-tools', label: 'Core abilities', k: 'vision image input sandbox code files web search' },
  { s: 'tools', a: 'extra-tools', label: 'Assistant features', k: 'skills mcp connectors chat search end conversation long reminder' },
  { s: 'tools', a: 'tool-limit', label: 'Tool-call limit', k: 'agent steps rounds maximum tools' },
  { s: 'appearance', a: 'logo', label: 'Logo & animations', k: 'icon static generating thinking upload starburst motion size' },
  { s: 'appearance', a: 'in-chat', label: 'In-chat display', k: 'picker logo show name position avatar left above below' },
  { s: 'appearance', a: 'badges', label: 'Picker badges', k: 'cap text vision reasoning compact labels' },
  { s: 'appearance', a: 'showcase', label: 'Showcase background', k: 'backdrop image gradient css frosted glass' },
  { s: 'advanced', a: 'sampling', label: 'Sampling', k: 'temperature top p top k min p penalty seed max tokens' },
  { s: 'advanced', a: 'pricing', label: 'Pricing', k: 'cost price input output per million usage preset' },
  { s: 'advanced', a: 'call-prompt', label: 'Voice call prompt', k: 'call phone speech voice override' }
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

export default function ModelEditor({ m, onChange, onDelete, onDuplicate, autosaveState, providers = [], providerTypes = {}, section = 'essentials', onSection }) {
  const [spOpen, setSpOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState('');
  const [preset, setPreset] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [findQ, setFindQ] = useState('');
  const bgRef = useRef(null);
  const bodyRef = useRef(null);
  const nameRef = useRef(null);
  const set = (k, v) => onChange({ ...m, [k]: v });

  const effortLevelsArr = (Array.isArray(m.effort_levels) ? m.effort_levels : String(m.effort_levels ?? 'low, medium, high').split(',')).map(s => String(s).trim().toLowerCase()).filter(Boolean);
  const effortLevelsStr = Array.isArray(m.effort_levels) ? m.effort_levels.join(', ') : (m.effort_levels ?? 'low, medium, high');
  const effortIsBool = effortLevelsArr.length === 2 && effortLevelsArr.includes('true') && effortLevelsArr.includes('false');

  useEffect(() => {
    let alive = true;
    const name = (m.internal_name || '').trim();
    if (!name) { setPreset(null); return; }
    api.get('/api/admin/pricing/preset?name=' + encodeURIComponent(name)).then(r => { if (alive) setPreset(r.preset || null); }).catch(() => {});
    return () => { alive = false; };
  }, [m.internal_name]);

  useEffect(() => { if (renaming) requestAnimationFrame(() => { nameRef.current?.focus(); nameRef.current?.select(); }); }, [renaming]);

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
      if (r.ok && r.numCtx) { set('num_ctx', r.numCtx); setDetectMsg('Detected ' + r.numCtx.toLocaleString() + ' tokens.'); }
      else setDetectMsg('Could not detect from the server, enter it manually.');
    } catch { setDetectMsg('Could not detect from the server, enter it manually.'); }
    setDetecting(false);
  }

  const priced = Number(m.cost_in) === preset?.in && Number(m.cost_out) === preset?.out;

  const fq = findQ.trim().toLowerCase();
  const findHits = fq ? FIELD_INDEX.filter(f => (f.label + ' ' + f.k).toLowerCase().includes(fq)).slice(0, 7) : [];
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
            <button type="button" className="med-name" title="Click to rename" onClick={() => setRenaming(true)}>{m.display_name || 'Untitled model'}</button>
          )}
          <div className="med-sub">
            <span className="med-sub-text">{m.internal_name || 'no model id'}</span>
            {!!(m.internal_name || '').trim() && <CopyBtn text={m.internal_name} title="Copy model ID" />}
          </div>
        </div>
        <StatusChips m={m} />
        <div className="med-actions">
          <button type="button" className={'med-act' + (m.is_default ? ' star-on' : '')} title={m.is_default ? 'Default model' : 'Make default'} onClick={() => set('is_default', m.is_default ? 0 : 1)}><Star style={{ width: 16 }} /></button>
          <button type="button" className="med-act" title={m.enabled ? 'Visible to users, click to hide' : 'Hidden from users, click to show'} onClick={() => set('enabled', m.enabled ? 0 : 1)}>{m.enabled ? <EyeIcon style={{ width: 16 }} /> : <EyeOffIcon style={{ width: 16 }} />}</button>
          {onDuplicate && <button type="button" className="med-act dup" title="Duplicate model" onClick={() => onDuplicate(m.id)}><Copy style={{ width: 16 }} /></button>}
          <button type="button" className="med-act del" title="Delete model" onClick={() => onDelete(m.id)}><Trash style={{ width: 16 }} /></button>
        </div>
      </div>

      <div className="med-bar">
        <div className="med-tabs">
          {ME_SECTIONS.map(([id, label]) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => onSection && onSection(id)}>{label}</button>
          ))}
        </div>
        <div className="med-find">
          <input value={findQ} onChange={(e) => setFindQ(e.target.value)} placeholder="Find a setting…"
            onKeyDown={(e) => { if (e.key === 'Enter' && findHits.length) jumpTo(findHits[0]); if (e.key === 'Escape') setFindQ(''); }} />
          {findHits.length > 0 && (
            <div className="med-find-menu">
              {findHits.map(h => (
                <button key={h.s + h.a} onClick={() => jumpTo(h)}>
                  <span>{h.label}</span>
                  <em>{ME_SECTIONS.find(([id]) => id === h.s)?.[1]}</em>
                </button>
              ))}
            </div>
          )}
          {fq && !findHits.length && <div className="med-find-menu"><div className="med-find-none">No matching setting.</div></div>}
        </div>
      </div>

      <div className="med-body" ref={bodyRef}>
        {section === 'essentials' && (
          <div className="med-pane">
            <GroupLabel anchor="identity" first>Identity</GroupLabel>
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
              <div className="muted-note">The connection this model runs through. Add or edit connections in the Providers section.</div>
            </div>
            <div className="field" data-anchor="description"><label>Description</label>
              <input value={m.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="For complex tasks" />
              <div className="muted-note">Shown under the model's name in the picker.</div>
            </div>

            <GroupLabel anchor="sysprompt">Behavior</GroupLabel>
            <div className="field"><label>System prompt</label>
              <button type="button" className="sp-preview" onClick={() => setSpOpen(true)}>
                {(m.system_prompt || '').trim()
                  ? <><div className="sp-preview-text">{m.system_prompt}</div><div className="sp-preview-fade" /></>
                  : <div className="sp-preview-empty">Click to write a system prompt…</div>}
                <div className="sp-preview-hint">Click to edit</div>
              </button>
            </div>
            {spOpen && <SystemPromptEditor value={m.system_prompt || ''} onChange={(v) => set('system_prompt', v)} onClose={() => setSpOpen(false)} />}

            <GroupLabel anchor="visibility">Visibility</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="is_default" label="Set as default" note="Pre-selected for users on first login. Only one model can be the default." />
              <div className="field row">
                <div><label>Hidden</label><div className="muted-note">Stays in your admin list but is removed from every user's model picker.</div></div>
                <div className={'switch' + (!m.enabled ? ' on' : '')} onClick={() => set('enabled', m.enabled ? 0 : 1)} />
              </div>
              <Toggle m={m} set={set} k="unavailable" label="Temporarily unavailable" note="Stays visible in the picker but users can't select it, and a banner explains why. Admins can still use it for testing." />
              {!!m.unavailable && (
                <div className="field"><label>Unavailability message</label>
                  <textarea rows={3} value={m.unavailable_reason || ''} onChange={(e) => set('unavailable_reason', e.target.value)} placeholder="e.g. Down for maintenance, back shortly." /></div>
              )}
            </div>
          </div>
        )}

        {section === 'reasoning' && (
          <div className="med-pane">
            <GroupLabel anchor="thinking" first>Thinking</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="effort_enabled" label="Thinking control" note="Shows a thinking control in the model picker and passes the choice via chat_template_kwargs each turn. Use several values for a slider, or true/false for an on-off toggle." />
            </div>
            {!!m.effort_enabled && <>
              <div className="field"><label>Values</label>
                <input value={effortLevelsStr} onChange={(e) => set('effort_levels', e.target.value)} placeholder="low, medium, high" /></div>
              <div className="muted-note">Comma-separated. {effortIsBool
                ? 'On/off values detected, users get an Extended Thinking toggle.'
                : 'Ordered lowest to highest, users get a slider through these stops.'}</div>
              <div className="two-col">
                <div className="field"><label>Default</label>
                  <select value={effortLevelsArr.includes(m.effort_default) ? m.effort_default : (effortIsBool ? 'false' : (effortLevelsArr[Math.floor(effortLevelsArr.length / 2)] || ''))} onChange={(e) => set('effort_default', e.target.value)}>
                    {effortLevelsArr.map(l => <option key={l} value={l}>{l}</option>)}
                  </select></div>
                <div className="field"><label>API kwarg name</label>
                  <input value={m.effort_kwarg || ''} onChange={(e) => set('effort_kwarg', e.target.value)} placeholder="reasoning_effort" /></div>
              </div>
              <div className="muted-note">Sent as {'{ "chat_template_kwargs": { "<kwarg>": <value> } }'}. gpt-oss uses reasoning_effort with low, medium, high, Qwen uses enable_thinking with false, true.</div>
              <div className="med-toggle-card" style={{ marginTop: 14 }}>
                <div className="field row">
                  <div><label>Who can change thinking</label><div className="muted-note">Admins only: users see the control greyed out and the model always runs at the default level. Everyone: users and admins can adjust it.</div></div>
                  <SegPick value={m.effort_admin_only ? 'admins' : 'everyone'} options={[['admins', 'Admins only'], ['everyone', 'Everyone']]} onChange={(v) => set('effort_admin_only', v === 'admins' ? 1 : 0)} />
                </div>
              </div>
            </>}
            {!m.effort_enabled && <>
              <div className="med-toggle-card">
                <Toggle m={m} set={set} k="has_reasoning" label="Extended thinking (prompt token)" note="For models that switch modes via a token in the system prompt. Adds the Extended toggle for users." />
              </div>
              {!!m.has_reasoning && <>
                <GroupLabel anchor="triggers">Mode triggers</GroupLabel>
                <div className="two-col">
                  <div className="field"><label>Extended-mode trigger</label>
                    <input value={m.reasoning_token || ''} onChange={(e) => set('reasoning_token', e.target.value)} placeholder="/think" /></div>
                  <div className="field"><label>Standard-mode trigger</label>
                    <input value={m.non_reasoning_token || ''} onChange={(e) => set('non_reasoning_token', e.target.value)} placeholder="/no_think" /></div>
                </div>
                <div className="muted-note">Appended to the system prompt, on its own line, depending on whether the user has Extended turned on.</div>
              </>}
            </>}

            <GroupLabel anchor="tags">Reasoning tags</GroupLabel>
            <div className="two-col">
              <div className="field"><label>Reasoning start tag</label>
                <input value={m.think_open || ''} onChange={(e) => set('think_open', e.target.value)} placeholder="<think>" /></div>
              <div className="field"><label>Reasoning end tag</label>
                <input value={m.think_close || ''} onChange={(e) => set('think_close', e.target.value)} placeholder="</think>" /></div>
            </div>
            <div className="muted-note">How the model delimits its reasoning in the output stream. Leave blank to use the default {'<think>…</think>'}.</div>

            <GroupLabel anchor="reveal">What users see</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="reasoning_collapsible" inverted label="Show reasoning to users" note="When on, users can expand and read the thought process. When off, they see only a 'Thinking…' status." />
              {m.reasoning_collapsible === 0 && <Toggle m={m} set={set} k="hide_thinking" label={'Hide the "Thinking…" status too'} note="No thinking indicator at all, the model just appears to be generating normally while it reasons." />}
            </div>

            <GroupLabel anchor="summaries">Long conversations</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="enable_summaries" label="Auto-summarize long chats" note="When a conversation nears the context window, older turns are compacted into a summary so it can keep going." />
            </div>
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
                <div className="muted-note">Summarize once the chat fills past this much of the context window's free space. 12% leaves a safety margin.</div>
              </div>
              <div className="field"><label>Recent turns kept verbatim</label>
                <input type="number" step="1" min="1" max="40" value={m.recent_window ?? 4} onChange={(e) => set('recent_window', parseInt(e.target.value) || 4)} style={{ maxWidth: 140 }} />
                <div className="muted-note">The newest messages are never summarized, they stay word-for-word. Higher keeps more recent detail but uses more context.</div>
              </div>
            </>}
          </div>
        )}

        {section === 'tools' && (
          <div className="med-pane">
            <GroupLabel anchor="core-tools" first>Core abilities</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="has_vision" label="Image input" note="Let users attach images for the model to see. Off = non-image files only." />
              <Toggle m={m} set={set} k="sandbox_allowed" inverted label="Allow sandbox tools" note="Lets users enable code and file tools for this model. Off means sandbox can't be turned on." />
              {m.sandbox_allowed !== 0 && <Toggle m={m} set={set} k="sandbox_auto" label="Enable sandbox by default" note="New chats with this model start with sandbox tools on." />}
              <Toggle m={m} set={set} k="web_search_allowed" inverted label="Allow web search" note="Lets users enable web search for this model (web search must also be configured in the Web Search section)." />
              {m.web_search_allowed !== 0 && <Toggle m={m} set={set} k="web_search_auto" label="Enable web search by default" note="New chats with this model start with web search on." />}
            </div>

            <GroupLabel anchor="extra-tools">Assistant features, all off by default</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="skills_allowed" label="Skills" note="Lets this model load admin-created skills from the Skills section." />
              <Toggle m={m} set={set} k="mcp_allowed" label="MCP connectors" note="Exposes tools from enabled MCP servers to this model." />
              <Toggle m={m} set={set} k="chat_search_allowed" label="Past-chat search" note="Lets this model search the user's own previous conversations (also requires the global toggle in Memory)." />
              <Toggle m={m} set={set} k="long_convo_reminder" label="Long conversation awareness" note="Gives the model the conversation's start time, duration, and timestamps so it can gently suggest breaks during very long sessions." />
              <Toggle m={m} set={set} k="end_chat_allowed" label="End conversation tool" note="Lets the model permanently end a chat. Ended chats cannot be continued, edited, regenerated, or branched." />
            </div>
            {!!m.end_chat_allowed && (
              <div className="field"><label>End-conversation instructions</label>
                <textarea rows={4} value={m.end_chat_prompt ?? ''} onChange={(e) => set('end_chat_prompt', e.target.value)} placeholder={'End the conversation if the user repeatedly…'} />
                <div className="muted-note">Appended to the system prompt to tell the model WHEN it should end conversations. Leave blank to append nothing beyond the basic tool description.</div>
              </div>
            )}
            <div className="field" data-anchor="tool-limit"><label>Tool-call limit</label>
              <input type="number" min="0" value={m.agent_steps || ''} placeholder="Unlimited" onChange={(e) => set('agent_steps', e.target.value)} style={{ maxWidth: 140 }} />
              <div className="muted-note">Maximum tool rounds per response. Leave blank or 0 for unlimited.</div>
            </div>
          </div>
        )}

        {section === 'appearance' && (
          <div className="med-pane">
            <GroupLabel anchor="logo" first>Logo</GroupLabel>
            <div className="field">
              <div className="icon-grid">
                <IconSlot label="Static" value={m.static_icon} def="" onChange={(v) => set('static_icon', v)} />
                <IconSlot label="Generating" value={m.generating_icon} def={m.static_icon || ''} anim={(m.generating_anim || 'spin') === 'none' ? '' : (m.generating_anim || 'spin')} onChange={(v) => set('generating_icon', v)} />
                <IconSlot label="Thinking" value={m.thinking_icon} def={m.static_icon || ''} anim={(m.thinking_anim || 'pulse') === 'none' ? '' : (m.thinking_anim || 'pulse')} onChange={(v) => set('thinking_icon', v)} />
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
              <div className="icon-actions">
                {!m.static_icon
                  ? <button type="button" className="btn ghost" onClick={() => onChange({ ...m, static_icon: '/starburst.svg', generating_icon: '/starburst-generating.svg', thinking_icon: '/starburst-thinking.svg' })}>Use starburst icon</button>
                  : <button type="button" className="btn ghost" onClick={() => onChange({ ...m, static_icon: '', generating_icon: '', thinking_icon: '' })}>Remove icon</button>}
              </div>
              <div className="muted-note">With no icon set the model shows no logo in chat or the picker. Click a slot to upload a png, svg, jpeg, or gif, or use the starburst. Generating and Thinking fall back to the static logo when left empty.</div>
            </div>
            <div className="field">
              <label>Icon size <span className="muted-note" style={{ display: 'inline' }}>{(m.icon_size || 40)}px</span></label>
              <div className="icon-size-row">
                <input type="range" min="14" max="64" value={m.icon_size || 40} onChange={(e) => set('icon_size', parseInt(e.target.value))} />
                <button className="btn ghost icon-size-reset" disabled={!m.icon_size} onClick={() => set('icon_size', 0)}>Reset</button>
              </div>
              <div className="muted-note">Size of the model's icon shown beside its messages. Default is 40px. Legacy is 26px.</div>
            </div>

            <GroupLabel anchor="in-chat">In chat</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="dropdown_icon" inverted label="Show logo in picker" note="Display this model's static logo next to its name in the model picker." />
              <Toggle m={m} set={set} k="show_name" label="Show model name" note="Display this model's name next to its logo on assistant messages." />
            </div>
            <div className="field">
              <label>Logo position</label>
              <SegPick value={m.icon_position || 'below'} options={[['above', 'Above text'], ['below', 'Below text'], ['left', 'Left of text']]} onChange={(v) => set('icon_position', v)} />
              <div className="muted-note">Where the logo sits relative to the message it generates. "Left of text" places it as an avatar in a gutter beside the message.</div>
            </div>

            <GroupLabel anchor="badges">Picker badges</GroupLabel>
            <div className="muted-note" style={{ marginBottom: 4 }}>Cosmetic labels shown beside the model in the picker. They don't change behaviour.</div>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="cap_text" label="Text-only badge" note="Marks the model as accepting text input only." />
              <Toggle m={m} set={set} k="cap_vision" label="Image badge" note="Marks the model as accepting images." />
              <Toggle m={m} set={set} k="cap_reasoning" label="Reasoning badge" note="Marks the model as able to reason." />
              <Toggle m={m} set={set} k="cap_compact" label="Combine into a single badge" note="Collapse the badges into one ⓘ that reveals them on hover." />
            </div>

            <GroupLabel anchor="showcase">Showcase</GroupLabel>
            <div className="med-toggle-card">
              <Toggle m={m} set={set} k="bg_enabled" label="Showcase background" note="Show a custom backdrop behind the whole interface when this model is selected. UI panels turn to frosted glass to blend in." />
            </div>
            {!!m.bg_enabled && (
              <div className="field">
                <label>Background image or CSS</label>
                <button type="button" className="bg-preview" style={bgPreviewStyle(m.bg_image)} onClick={() => bgRef.current?.click()} title="Click to upload an image">
                  {!m.bg_image && <span className="bg-preview-empty">Click to upload an image</span>}
                </button>
                <input ref={bgRef} type="file" hidden onChange={pickBg} accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*" />
                <input value={m.bg_image || ''} onChange={(e) => set('bg_image', e.target.value)} placeholder="Image URL, or a CSS gradient" />
                <div className="bg-up-row">
                  <button type="button" className="btn ghost" onClick={() => bgRef.current?.click()}>Upload image…</button>
                  {m.bg_image && <button type="button" className="btn ghost" onClick={() => set('bg_image', '')}>Clear</button>}
                </div>
                <div className="muted-note">Paste an image URL, upload a file, or use a CSS gradient like <code>linear-gradient(120deg, #a0c4ff, #ffc6ff)</code>.</div>
              </div>
            )}
          </div>
        )}

        {section === 'advanced' && (
          <div className="med-pane">
            <GroupLabel anchor="sampling" first>Sampling</GroupLabel>
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

            <GroupLabel anchor="pricing">Pricing</GroupLabel>
            <div className="muted-note">Optional. Used to estimate cost in each user's Usage tab. Prices are per 1,000,000 tokens. Leave blank or 0 for local or free models.</div>
            {preset && (
              <div className="med-preset">
                <span>Recognized as <strong>{preset.label}</strong> (${preset.in}/${preset.out} per 1M). {priced ? 'Applied.' : 'You can apply or override it.'}</span>
                {!priced && <button type="button" className="btn" onClick={applyPreset}>Apply preset</button>}
              </div>
            )}
            <div className="sampling-grid">
              <div className="samp-field">
                <label>Input $ / 1M tokens</label>
                <input type="number" step="any" min="0" placeholder="e.g. 3.00" value={m.cost_in ?? ''} onChange={(e) => set('cost_in', e.target.value)} />
              </div>
              <div className="samp-field">
                <label>Output $ / 1M tokens</label>
                <input type="number" step="any" min="0" placeholder="e.g. 15.00" value={m.cost_out ?? ''} onChange={(e) => set('cost_out', e.target.value)} />
              </div>
            </div>
            {(m.cost_in != null || m.cost_out != null) && (
              <button type="button" className="linklike" style={{ marginTop: 10 }} onClick={clearPrice}>Clear price (treat as local / free)</button>
            )}

            <GroupLabel anchor="call-prompt">Voice calls</GroupLabel>
            <div className="field">
              <label>Call system prompt <span className="muted-note" style={{ display: 'inline' }}>(optional)</span></label>
              <textarea rows={4} value={m.call_prompt || ''} onChange={(e) => set('call_prompt', e.target.value)} placeholder="You are on a voice call. Keep replies short and conversational, a couple of sentences. No markdown, no lists, no code." />
              <div className="muted-note">Replaces the system prompt whenever a message comes in through a voice call. Leave empty to use the regular prompt during calls too.</div>
            </div>
          </div>
        )}
      </div>

      <div className="med-foot">
        <span className={'autosave-dot' + (autosaveState === 'saved' ? ' flash' : '')} />
        {autosaveState === 'saving' ? 'Saving…' : autosaveState === 'saved' ? 'All changes saved to draft' : 'Edits save automatically to your draft'}
      </div>
    </div>
  );
}
