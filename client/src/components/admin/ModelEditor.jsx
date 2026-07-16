import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../api.js';
import { Copy, Trash } from '../icons.jsx';
import { Toggle, IconSlot, SystemPromptEditor, StatusChips, CopyBtn, bgPreviewStyle } from './widgets.jsx';

export const ME_SECTIONS = [
  ['general', 'General'],
  ['intelligence', 'Intelligence'],
  ['abilities', 'Abilities'],
  ['style', 'Style'],
  ['tuning', 'Tuning']
];

export default function ModelEditor({ m, onChange, onDelete, onDuplicate, autosaveState, providers = [], providerTypes = {}, section = 'general', onSection }) {
  const [spOpen, setSpOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState('');
  const [preset, setPreset] = useState(null);
  const bgRef = useRef(null);
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

  return (
    <div className="me2">
      <div className="me2-head">
        {m.static_icon ? <img className="me2-icon" src={m.static_icon} alt="" /> : <span className="me2-icon noicon">{(m.display_name || '?').trim().charAt(0).toUpperCase()}</span>}
        <div className="me2-id">
          <div className="me2-name">{m.display_name || 'Untitled model'}</div>
          <div className="me2-sub">
            <span className="me2-sub-text">{m.internal_name || 'no model id'}</span>
            {!!(m.internal_name || '').trim() && <CopyBtn text={m.internal_name} title="Copy model ID" />}
          </div>
        </div>
        <StatusChips m={m} />
        {onDuplicate && <button className="me2-dup" title="Duplicate model" onClick={() => onDuplicate(m.id)}><Copy style={{ width: 16 }} /></button>}
        <button className="me2-del" title="Delete model" onClick={() => onDelete(m.id)}><Trash style={{ width: 16 }} /></button>
      </div>

      <div className="me2-nav">
        {ME_SECTIONS.map(([id, label]) => (
          <button key={id} className={section === id ? 'on' : ''} onClick={() => onSection && onSection(id)}>{label}</button>
        ))}
      </div>

      <div className="me2-body">
        {section === 'general' && (
          <div className="me2-pane">
            <div className="me2-group-label first">Identity</div>
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

            <div className="me2-group-label">Voice calls</div>
            <div className="field">
              <label>Call system prompt <span className="muted-note" style={{ display: 'inline' }}>(optional)</span></label>
              <textarea rows={4} value={m.call_prompt || ''} onChange={(e) => set('call_prompt', e.target.value)} placeholder="You are on a voice call. Keep replies short and conversational, a couple of sentences. No markdown, no lists, no code." />
              <div className="muted-note">Replaces the system prompt above whenever a message comes in through a voice call. Leave empty to use the regular prompt during calls too.</div>
            </div>

            <div className="me2-group-label">Availability</div>
            <div className="me2-toggle-card">
              <Toggle m={m} set={set} k="is_default" label="Set as default" note="Pre-selected for users on first login. Only one model can be the default." />
              <div className="field row">
                <div><label>Hidden</label><div className="muted-note">Stays in your admin list but is removed from every user's model picker.</div></div>
                <div className={'switch' + (!m.enabled ? ' on' : '')} onClick={() => set('enabled', m.enabled ? 0 : 1)} />
              </div>
              <Toggle m={m} set={set} k="in_more_models" label={'Group under "More models"'} note="Moves the model out of the main list into a collapsible group. Models sharing a label sit together; different labels form separate groups." />
              {!!m.in_more_models && (
                <div className="field"><label>Group label</label>
                  <input value={m.more_models_label || ''} onChange={(e) => set('more_models_label', e.target.value)} placeholder="More models" /></div>
              )}
              <Toggle m={m} set={set} k="unavailable" label="Temporarily unavailable" note="Stays visible in the picker but users can't select it, and a banner explains why. Admins can still use it for testing." />
              {!!m.unavailable && (
                <div className="field"><label>Unavailability message</label>
                  <textarea rows={3} value={m.unavailable_reason || ''} onChange={(e) => set('unavailable_reason', e.target.value)} placeholder="e.g. Down for maintenance, back shortly." /></div>
              )}
            </div>
          </div>
        )}

        {section === 'intelligence' && (
          <div className="me2-pane">
            <div className="me2-group-label first">Reasoning</div>
            <div className="me2-toggle-card">
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
            </>}
            {!m.effort_enabled && <>
              <div className="me2-toggle-card">
                <Toggle m={m} set={set} k="has_reasoning" label="Extended thinking (prompt token)" note="For models that switch modes via a token in the system prompt. Adds the Extended toggle for users." />
              </div>
              {!!m.has_reasoning && <>
                <div className="me2-group-label">Mode triggers</div>
                <div className="two-col">
                  <div className="field"><label>Extended-mode trigger</label>
                    <input value={m.reasoning_token || ''} onChange={(e) => set('reasoning_token', e.target.value)} placeholder="/think" /></div>
                  <div className="field"><label>Standard-mode trigger</label>
                    <input value={m.non_reasoning_token || ''} onChange={(e) => set('non_reasoning_token', e.target.value)} placeholder="/no_think" /></div>
                </div>
                <div className="muted-note">Appended to the system prompt, on its own line, depending on whether the user has Extended turned on.</div>
              </>}
            </>}
            <div className="me2-group-label">Reasoning tags</div>
            <div className="two-col">
              <div className="field"><label>Reasoning start tag</label>
                <input value={m.think_open || ''} onChange={(e) => set('think_open', e.target.value)} placeholder="<think>" /></div>
              <div className="field"><label>Reasoning end tag</label>
                <input value={m.think_close || ''} onChange={(e) => set('think_close', e.target.value)} placeholder="</think>" /></div>
            </div>
            <div className="muted-note">How the model delimits its reasoning in the output stream. Leave blank to use the default {'<think>…</think>'}.</div>
            <div className="me2-toggle-card" style={{ marginTop: 14 }}>
              <Toggle m={m} set={set} k="reasoning_collapsible" inverted label="Show reasoning to users" note="When on, users can expand and read the thought process. When off, they see only a 'Thinking…' status." />
            </div>

            <div className="me2-group-label">Long conversations</div>
            <div className="me2-toggle-card">
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

        {section === 'abilities' && (
          <div className="me2-pane">
            <div className="me2-group-label first">What this model can use</div>
            <div className="me2-toggle-card">
              <Toggle m={m} set={set} k="has_vision" label="Image input" note="Let users attach images for the model to see. Off = non-image files only." />
              <Toggle m={m} set={set} k="sandbox_allowed" inverted label="Allow sandbox tools" note="Lets users enable code and file tools for this model. Off means sandbox can't be turned on." />
              {m.sandbox_allowed !== 0 && <Toggle m={m} set={set} k="sandbox_auto" label="Enable sandbox by default" note="New chats with this model start with sandbox tools on." />}
              <Toggle m={m} set={set} k="web_search_allowed" inverted label="Allow web search" note="Lets users enable web search for this model (web search must also be configured in the Web Search section)." />
              {m.web_search_allowed !== 0 && <Toggle m={m} set={set} k="web_search_auto" label="Enable web search by default" note="New chats with this model start with web search on." />}
            </div>
            <div className="me2-group-label">Assistant features, all off by default</div>
            <div className="me2-toggle-card">
              <Toggle m={m} set={set} k="skills_allowed" label="Skills" note="Lets this model load admin-created skills from the Skills section." />
              <Toggle m={m} set={set} k="mcp_allowed" label="MCP connectors" note="Exposes tools from enabled MCP servers to this model." />
              <Toggle m={m} set={set} k="chat_search_allowed" label="Past-chat search" note="Lets this model search the user's own previous conversations (also requires the global toggle in User Memory)." />
              <Toggle m={m} set={set} k="long_convo_reminder" label="Long conversation awareness" note="Gives the model the conversation's start time, duration, and timestamps so it can gently suggest breaks during very long sessions." />
              <Toggle m={m} set={set} k="end_chat_allowed" label="End conversation tool" note="Lets the model permanently end a chat. Ended chats cannot be continued, edited, regenerated, or branched." />
            </div>
            {!!m.end_chat_allowed && (
              <div className="field"><label>End-conversation instructions</label>
                <textarea rows={4} value={m.end_chat_prompt ?? ''} onChange={(e) => set('end_chat_prompt', e.target.value)} placeholder={'End the conversation if the user repeatedly…'} />
                <div className="muted-note">Appended to the system prompt to tell the model WHEN it should end conversations. Leave blank to append nothing beyond the basic tool description.</div>
              </div>
            )}
            <div className="field"><label>Tool-call limit</label>
              <input type="number" min="0" value={m.agent_steps || ''} placeholder="Unlimited" onChange={(e) => set('agent_steps', e.target.value)} style={{ maxWidth: 140 }} />
              <div className="muted-note">Maximum tool rounds per response. Leave blank or 0 for unlimited.</div>
            </div>
            <div className="me2-group-label">Picker badges</div>
            <div className="muted-note" style={{ marginBottom: 4 }}>Cosmetic labels shown beside the model in the picker. They don't change behaviour.</div>
            <div className="me2-toggle-card">
              <Toggle m={m} set={set} k="cap_text" label="Text-only badge" note="Marks the model as accepting text input only." />
              <Toggle m={m} set={set} k="cap_vision" label="Image badge" note="Marks the model as accepting images." />
              <Toggle m={m} set={set} k="cap_reasoning" label="Reasoning badge" note="Marks the model as able to reason." />
              <Toggle m={m} set={set} k="cap_compact" label="Combine into a single badge" note="Collapse the badges into one ⓘ that reveals them on hover." />
            </div>
          </div>
        )}

        {section === 'style' && (
          <div className="me2-pane">
            <div className="me2-group-label first">Logo</div>
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
            <div className="me2-group-label">In chat</div>
            <div className="me2-toggle-card">
              <Toggle m={m} set={set} k="dropdown_icon" inverted label="Show logo in picker" note="Display this model's static logo next to its name in the model picker." />
              <Toggle m={m} set={set} k="show_name" label="Show model name" note="Display this model's name next to its logo on assistant messages." />
            </div>
            <div className="field">
              <label>Logo position</label>
              <div className="seg">
                <button className={(m.icon_position || 'below') === 'above' ? 'on' : ''} onClick={() => set('icon_position', 'above')}>Above text</button>
                <button className={(m.icon_position || 'below') === 'below' ? 'on' : ''} onClick={() => set('icon_position', 'below')}>Below text</button>
                <button className={(m.icon_position || 'below') === 'left' ? 'on' : ''} onClick={() => set('icon_position', 'left')}>Left of text</button>
              </div>
              <div className="muted-note">Where the logo sits relative to the message it generates. "Left of text" places it as an avatar in a gutter beside the message.</div>
            </div>
            <div className="me2-group-label">Showcase</div>
            <div className="me2-toggle-card">
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

        {section === 'tuning' && (
          <div className="me2-pane">
            <div className="me2-group-label first">Sampling</div>
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
            <div className="me2-group-label">Pricing</div>
            <div className="muted-note">Optional. Used to estimate cost in each user's Usage tab. Prices are per 1,000,000 tokens. Leave blank or 0 for local or free models.</div>
            {preset && (
              <div className="me2-preset">
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
          </div>
        )}
      </div>

      <div className="me2-foot">
        <span className={'autosave-dot' + (autosaveState === 'saved' ? ' flash' : '')} />
        {autosaveState === 'saving' ? 'Saving…' : autosaveState === 'saved' ? 'All changes saved to draft' : 'Edits save automatically to your draft'}
      </div>
    </div>
  );
}
