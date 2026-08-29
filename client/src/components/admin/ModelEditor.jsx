import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { Block, Row, Fields, Field, Input, Area, Select, Seg, Switch, Btn, Badge, Note, Empty, Table, CopyBtn, SaveState } from './ui.jsx';
import { ImagePicker } from './media.jsx';
import KwargsEditor from './KwargsEditor.jsx';
import { Chevron, Copy, Trash, Star, Eye, EyeOff, Plus } from '../icons.jsx';
import { t, tk } from '../../i18n.jsx';
import { BRAND_ICON, BRAND_GENERATING, BRAND_THINKING } from '../../lib/brand.js';

const MOTIONS = [
  ['none', tk('none')], ['spin', tk('spin')], ['pulse', tk('breathe')],
  ['bounce', tk('bounce')], ['wobble', tk('wobble')], ['fade', tk('fade')]
];

const MATCHERS = [
  ['keyword', tk('contains any of these words')],
  ['regex', tk('matches this regular expression')],
  ['hasImage', tk('has an image attached')],
  ['hasFile', tk('has a file attached')],
  ['hasCode', tk('looks like code')],
  ['shorterThan', tk('is shorter than N characters')],
  ['longerThan', tk('is longer than N characters')],
  ['always', tk('always (catch-all)')]
];
const NEEDS_VALUE = new Set(['keyword', 'regex', 'shorterThan', 'longerThan']);

const SAMPLERS = [
  [tk('Core'), tk('Randomness and length. The ones worth touching first.'), [
    ['temperature', 'temperature', '0.0 – 2.0'], ['top_p', 'top_p', '0.0 – 1.0'],
    ['top_k', 'top_k', '40'], ['min_p', 'min_p', '0.0 – 1.0'],
    ['max_tokens', 'max_tokens', '2048'], ['seed', 'seed', 'integer']
  ]],
  [tk('Repetition'), tk('Discourage the model from looping. DRY is llama.cpp only.'), [
    ['repetition_penalty', 'repetition_penalty', '1.1'], ['presence_penalty', 'presence_penalty', '-2.0 – 2.0'],
    ['frequency_penalty', 'frequency_penalty', '-2.0 – 2.0'],
    ['dry_multiplier', 'dry_multiplier', '0 = off'], ['dry_base', 'dry_base', '1.75'],
    ['dry_allowed_length', 'dry_allowed_length', '2'], ['dry_penalty_last_n', 'dry_penalty_last_n', '-1 = all']
  ]],
  [tk('Experimental'), tk('XTC and Mirostat change how tokens are picked. Leave off unless you are deliberately tuning.'), [
    ['xtc_probability', 'xtc_probability', '0 = off'], ['xtc_threshold', 'xtc_threshold', '0.1'],
    ['mirostat', 'mirostat', '0, 1, or 2'], ['mirostat_tau', 'mirostat_tau', '5.0'], ['mirostat_eta', 'mirostat_eta', '0.1']
  ]]
];

const MODALITIES = [['text', tk('text')], ['image', tk('image')], ['audio', tk('audio')], ['video', tk('video')]];

function Toggle({ m, set, k, label, note, inverted }) {
  const on = inverted ? m[k] !== 0 : !!m[k];
  return (
    <Row label={label} note={note}>
      <Switch on={on} label={label} onToggle={() => set(k, on ? 0 : 1)} />
    </Row>
  );
}

function SamplerBank({ m, set, allowed }) {
  return SAMPLERS.map(([title, note, fields]) => {
    const usable = fields.filter(([k]) => allowed.includes(k));
    if (!usable.length) return null;
    return (
      <div key={title} style={{ marginTop: 16 }}>
        <div className="cp-hint" style={{ marginTop: 0, marginBottom: 8 }}>
          <strong style={{ color: 'var(--text-muted)' }}>{t(title)}</strong> — {t(note)}
        </div>
        <Fields cols={3}>
          {usable.map(([k, label, ph]) => (
            <Field key={k} label={label}>
              <Input mono type="number" step="any" placeholder={ph} value={m[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
        </Fields>
      </div>
    );
  });
}

function Router({ m, set, models }) {
  const rules = Array.isArray(m.router_rules) ? m.router_rules : [];
  const pickable = models.filter(x => x.id !== m.id);
  const targets = pickable.filter(x => x.kind !== 'router');
  const upd = (i, patch) => set('router_rules', rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i, d) => {
    const next = rules.slice();
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set('router_rules', next);
  };

  return (
    <>
      <Row label={t('Route instead of answering')}
        note={t('A router never calls a backend itself. It appears in the picker like any other model and hands each turn to the first model whose rule matches.')}>
        <Switch on={m.kind === 'router'} label={t('Route instead of answering')}
          onToggle={() => set('kind', m.kind === 'router' ? 'model' : 'router')} />
      </Row>
      {m.kind === 'router' && (
        <>
          <div style={{ marginTop: 16 }}>
            {rules.length === 0
              ? <Empty title={t('No rules')}>{t('Every turn will go straight to the fallback.')}</Empty>
              : (
                <Table head={[
                  { label: '#', fit: true, mono: true },
                  { label: t('When the message') },
                  { label: t('Value') },
                  { label: t('Send to') },
                  { label: t('Shown as') },
                  { label: '', fit: true }
                ]}>
                  {rules.map((r, i) => (
                    <tr key={i}>
                      <td className="mono dim">{i + 1}</td>
                      <td>
                        <Select value={r.match} onChange={(v) => upd(i, { match: v })}
                          options={MATCHERS.map(([value, label]) => ({ value, label: t(label) }))} />
                      </td>
                      <td>
                        {NEEDS_VALUE.has(r.match)
                          ? <Input mono value={r.value || ''} onChange={(e) => upd(i, { value: e.target.value })}
                            placeholder={r.match === 'keyword' ? 'translate, traducir' : r.match === 'regex' ? '^\\s*(fix|debug)\\b' : '400'} />
                          : <span className="dim">—</span>}
                      </td>
                      <td>
                        <Select value={r.modelId || ''} onChange={(v) => upd(i, { modelId: v })}
                          options={[{ value: '', label: t('choose a model') },
                            ...pickable.map(x => ({ value: x.id, label: (x.display_name || x.internal_name) + (x.kind === 'router' ? ' ' + t('(router)') : '') }))]} />
                      </td>
                      <td><Input value={r.label || ''} placeholder={t('optional')} onChange={(e) => upd(i, { label: e.target.value })} /></td>
                      <td className="acts">
                        <Btn size="sm" disabled={i === 0} title={t('Move up')} aria-label={t('Move up')} onClick={() => move(i, -1)}>↑</Btn>{' '}
                        <Btn size="sm" disabled={i === rules.length - 1} title={t('Move down')} aria-label={t('Move down')} onClick={() => move(i, 1)}>↓</Btn>{' '}
                        <Btn size="sm" kind="danger" title={t('Remove')} aria-label={t('Remove')}
                          onClick={() => set('router_rules', rules.filter((_, j) => j !== i))}>✕</Btn>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
          </div>
          <div className="cp-acts" style={{ marginTop: 12 }}>
            <Btn size="sm" onClick={() => set('router_rules', [...rules, { match: 'keyword', value: '', modelId: targets[0]?.id || '', label: '' }])}>
              <Plus /> {t('Add rule')}
            </Btn>
          </div>
          <div style={{ marginTop: 16, maxWidth: 420 }}>
            <Field label={t('Fallback')} hint={t('Used when no rule matches. Without one, a router refuses the turn rather than guessing.')}>
              <Select value={m.router_default || ''} onChange={(v) => set('router_default', v)}
                options={[{ value: '', label: t('none') }, ...pickable.map(x => ({ value: x.id, label: x.display_name || x.internal_name }))]} />
            </Field>
          </div>
        </>
      )}
    </>
  );
}

export default function ModelEditor({ model: m, models, providers, providerTypes, saveState, onChange, onBack, onDuplicate, onDelete }) {
  const [preset, setPreset] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState('');

  const set = (k, v) => onChange({ ...m, [k]: v });
  const setKind = (k, v) => onChange({ ...m, [k]: v });

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !e.target.closest('input, textarea, select')) onBack(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onBack]);

  useEffect(() => {
    let alive = true;
    const name = (m.internal_name || '').trim();
    if (!name) { setPreset(null); return undefined; }
    api.get('/api/admin/pricing/preset?name=' + encodeURIComponent(name))
      .then(r => { if (alive) setPreset(r.preset || null); }).catch(() => {});
    return () => { alive = false; };
  }, [m.internal_name]);

  const conn = providers.find(p => p.id === m.provider_id) || providers[0];
  const connType = conn ? providerTypes[conn.type] : null;
  const allowed = connType?.samplers
    || ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'];

  async function detectCtx() {
    setDetecting(true);
    setDetected('');
    try {
      const r = await api.get('/api/admin/detect-ctx?model=' + encodeURIComponent(m.internal_name || '')
        + '&provider=' + encodeURIComponent(m.provider_id || ''));
      if (r.ok && r.numCtx) { set('num_ctx', r.numCtx); setDetected(t('read {n} tokens from the backend', { n: r.numCtx.toLocaleString() })); }
      else setDetected(t('the backend did not report a window'));
    } catch { setDetected(t('the backend did not answer')); }
    setDetecting(false);
  }

  return (
    <>
      <div className="cp-editbar">
        <Btn size="sm" onClick={onBack}><Chevron style={{ transform: 'rotate(180deg)' }} /> {t('All models')}</Btn>
        <span className="cp-badges">
          {!!m.is_default && <Badge tone="on">{t('default')}</Badge>}
          {!m.enabled && <Badge>{t('hidden')}</Badge>}
          {!!m.unavailable && <Badge tone="bad">{t('down')}</Badge>}
          {m.kind === 'router' && <Badge tone="warn">{t('router')}</Badge>}
        </span>
        <div style={{ flex: 1 }} />
        <SaveState state={saveState} />
        <Btn size="sm" title={m.is_default ? t('Already the default') : t('Make default')} aria-label={t('Make default')}
          disabled={!!m.is_default} onClick={() => set('is_default', 1)}><Star /></Btn>
        <Btn size="sm" title={m.enabled ? t('Hide from members') : t('Show to members')} aria-label={t('Toggle visibility')}
          onClick={() => set('enabled', m.enabled ? 0 : 1)}>{m.enabled ? <Eye /> : <EyeOff />}</Btn>
        <Btn size="sm" title={t('Duplicate')} aria-label={t('Duplicate')} onClick={onDuplicate}><Copy /></Btn>
        <Btn size="sm" kind="danger" title={t('Delete')} aria-label={t('Delete')} onClick={onDelete}><Trash /></Btn>
      </div>

      <Block title={t('Identity')}>
        <Fields cols={3}>
          <Field label={t('Display name')} hint={t('What members see in the picker.')}>
            <Input value={m.display_name || ''} placeholder={t('Untitled')} onChange={(e) => set('display_name', e.target.value)} />
          </Field>
          <Field label={t('Model id')} hint={t('Sent verbatim to the backend. Must match what the provider reports.')}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Input mono value={m.internal_name || ''} placeholder="llama-3.1-8b-instruct"
                onChange={(e) => set('internal_name', e.target.value)} />
              {!!(m.internal_name || '').trim() && <CopyBtn text={m.internal_name} title={t('Copy model id')} />}
            </div>
          </Field>
          <Field label={t('Connection')} hint={t('Which backend this model runs through.')}>
            <Select value={m.provider_id || conn?.id || ''} onChange={(v) => set('provider_id', v)}
              options={providers.map(p => ({ value: p.id, label: p.name || providerTypes[p.type]?.label || p.type }))} />
          </Field>
        </Fields>
        <div style={{ marginTop: 14, maxWidth: 640 }}>
          <Field label={t('Subtitle')} hint={t('One line under the name in the picker.')}>
            <Input value={m.description || ''} placeholder={t('For complex tasks')} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
      </Block>

      <Block title={t('System prompt')}
        sub={t('Prepended to every conversation. {date} and {user} are substituted on the member’s own device at send time.', { date: '{{currentDateTime}}', user: '{{currentUser}}' })}>
        <Area mono rows={12} value={m.system_prompt || ''}
          placeholder={t('You are a helpful assistant…')}
          onChange={(e) => set('system_prompt', e.target.value)} />
        <div className="cp-hint" style={{ display: 'flex', gap: 14 }}>
          <span>{t('{n} characters', { n: (m.system_prompt || '').length.toLocaleString() })}</span>
          <span>{t('~{n} tokens', { n: Math.round((m.system_prompt || '').length / 4).toLocaleString() })}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn quiet sm"
            onClick={() => set('system_prompt', (m.system_prompt || '') + '{{currentDateTime}}')}>+ date</button>
          <button type="button" className="btn quiet sm"
            onClick={() => set('system_prompt', (m.system_prompt || '') + '{{currentUser}}')}>+ user</button>
        </div>
      </Block>

      <Block title={t('Availability')}>
        <Toggle m={m} set={set} k="enabled" inverted label={t('Listed in the picker')}
          note={t('Off, the model is invisible to members but stays configured.')} />
        <Toggle m={m} set={set} k="is_default" label={t('Default for new accounts')}
          note={t('Pre-selected on first sign-in. Only one model holds this.')} />
        <Toggle m={m} set={set} k="unavailable" label={t('Marked as down')}
          note={t('Stays in the picker but cannot be selected. Use it while a backend is offline.')} />
        {!!m.unavailable && (
          <div style={{ paddingTop: 14, maxWidth: 640 }}>
            <Field label={t('Reason shown to members')}>
              <Area rows={3} value={m.unavailable_reason || ''}
                placeholder={t('Back after the GPU maintenance window.')}
                onChange={(e) => set('unavailable_reason', e.target.value)} />
            </Field>
          </div>
        )}
        <div style={{ paddingTop: 14 }}>
          <Fields cols={2}>
            <Field label={t('Retire on')} hint={t('Blank never retires. On the date, the model follows the action beside it.')}>
              <Input type="date" value={m.sunset_at || ''} onChange={(e) => set('sunset_at', e.target.value)} />
            </Field>
            {!!m.sunset_at && (
              <Field label={t('On that date')}>
                <Select value={m.sunset_action || 'hide'} onChange={(v) => set('sunset_action', v)}
                  options={[{ value: 'hide', label: t('hide from the picker') }, { value: 'unavailable', label: t('mark as down') }]} />
              </Field>
            )}
          </Fields>
        </div>
      </Block>

      <Block title={t('Reasoning')} sub={t('How the model thinks before answering, and how much of that members see.')}>
        <Toggle m={m} set={set} k="reasoning_collapsible" inverted label={t('Show the thought process')}
          note={t('Off, members see only a status line while it thinks.')} />
        {m.reasoning_collapsible === 0 && (
          <Toggle m={m} set={set} k="hide_thinking" label={t('Hide the status line too')}
            note={t('The reply simply appears when it is ready.')} />
        )}
        <div style={{ paddingTop: 14 }}>
          <Fields cols={2}>
            <Field label={t('Opening tag')} hint={t('Blank uses the default think tags.')}>
              <Input mono value={m.think_open || ''} placeholder="<think>" onChange={(e) => set('think_open', e.target.value)} />
            </Field>
            <Field label={t('Closing tag')}>
              <Input mono value={m.think_close || ''} placeholder="</think>" onChange={(e) => set('think_close', e.target.value)} />
            </Field>
          </Fields>
        </div>
        <div style={{ paddingTop: 4 }}>
          <Toggle m={m} set={set} k="has_reasoning" label={t('Switch modes with a prompt token')}
            note={t('For models that toggle thinking by a token in the prompt. Adds an extended-thinking control for members.')} />
          {!!m.has_reasoning && (
            <div style={{ paddingTop: 14 }}>
              <Fields cols={2}>
                <Field label={t('Extended token')}>
                  <Input mono value={m.reasoning_token || ''} placeholder="/think" onChange={(e) => set('reasoning_token', e.target.value)} />
                </Field>
                <Field label={t('Standard token')}>
                  <Input mono value={m.non_reasoning_token || ''} placeholder="/no_think" onChange={(e) => set('non_reasoning_token', e.target.value)} />
                </Field>
              </Fields>
            </div>
          )}
        </div>
      </Block>

      <Block title={t('Context window')} sub={t('What happens as a conversation approaches the model’s limit.')}>
        <Fields cols={3}>
          <Field label={t('Window size')} hint={detected || t('Tokens the backend can hold. Blank falls back to a conservative default.')}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Input mono type="number" min="0" value={m.num_ctx ?? ''} placeholder="32768"
                onChange={(e) => set('num_ctx', e.target.value)} />
              <Btn size="sm" disabled={detecting} onClick={detectCtx}>{detecting ? t('Reading…') : t('Detect')}</Btn>
            </div>
          </Field>
          <Field label={t('Headroom')} hint={t('Tokens held back for the reply.')}>
            <Input mono type="number" min="0" value={m.summary_padding ?? ''} placeholder="1024"
              onChange={(e) => set('summary_padding', e.target.value)} />
          </Field>
          <Field label={t('Turns kept verbatim')} hint={t('Recent turns never compacted.')}>
            <Input mono type="number" min="0" value={m.recent_window ?? ''} placeholder="6"
              onChange={(e) => set('recent_window', e.target.value)} />
          </Field>
        </Fields>
        <div style={{ paddingTop: 4 }}>
          <Toggle m={m} set={set} k="enable_summaries" label={t('Compact older turns')}
            note={t('Near the limit, earlier turns are replaced by a summary so the conversation can continue.')} />
        </div>
        <div style={{ paddingTop: 14, maxWidth: 520 }}>
          <Field label={t('When the chat outgrows the window')}
            hint={t('Keeping history drops the least, but the prompt changes every turn and a local backend re-reads the whole conversation. Keeping the cache warm drops more but leaves the prefix stable.')}>
            <Seg value={m.ctx_trim_mode || 'history'} label={t('Trim strategy')}
              onChange={(v) => set('ctx_trim_mode', v)}
              options={[{ value: 'history', label: t('keep history') }, { value: 'cache', label: t('keep cache warm') }]} />
          </Field>
        </div>
      </Block>

      <Block title={t('Request controls')}
        sub={t('Extra fields merged into each request body, and the controls members get for them.')}>
        <KwargsEditor m={m} set={set} />
      </Block>

      <Block title={t('Capabilities')}>
        <Toggle m={m} set={set} k="has_vision" label={t('Image input')}
          note={t('Off, image attachments are refused for this model.')} />
        <Toggle m={m} set={set} k="sandbox_allowed" inverted label={t('Sandbox tools')}
          note={t('Lets members turn on code execution and a per-chat filesystem.')} />
        {m.sandbox_allowed !== 0 && (
          <Toggle m={m} set={set} k="sandbox_auto" label={t('Sandbox on by default')} note={t('New chats start with it enabled.')} />
        )}
        <Toggle m={m} set={set} k="web_search_allowed" inverted label={t('Web search')}
          note={t('Requires web search to be configured under Tools.')} />
        {m.web_search_allowed !== 0 && (
          <Toggle m={m} set={set} k="web_search_auto" label={t('Web search on by default')} note={t('New chats start with it enabled.')} />
        )}
        <Toggle m={m} set={set} k="skills_allowed" label={t('Skills')} note={t('Offers the skills defined under Tools.')} />
        <Toggle m={m} set={set} k="mcp_allowed" label={t('MCP tools')} note={t('Exposes tools from every enabled MCP server.')} />
        <Toggle m={m} set={set} k="chat_search_allowed" label={t('Past-chat search')} note={t('Lets the model search the member’s own earlier chats.')} />
        <Toggle m={m} set={set} k="long_convo_reminder" label={t('Conversation length awareness')}
          note={t('Tells the model how long the conversation has grown.')} />
        <Toggle m={m} set={set} k="end_chat_allowed" label={t('End conversation tool')}
          note={t('Lets the model close a chat for good. Ended chats cannot be reopened.')} />
        {!!m.end_chat_allowed && (
          <div style={{ paddingTop: 14, maxWidth: 640 }}>
            <Field label={t('When to end')}>
              <Area rows={4} value={m.end_chat_prompt ?? ''}
                placeholder={t('End the conversation only when the member says goodbye.')}
                onChange={(e) => set('end_chat_prompt', e.target.value)} />
            </Field>
          </div>
        )}
        <div style={{ paddingTop: 14, maxWidth: 320 }}>
          <Field label={t('Tool calls per turn')} hint={t('Blank is unlimited. A ceiling stops runaway agent loops.')}>
            <Input mono type="number" min="0" value={m.agent_steps || ''} placeholder={t('unlimited')}
              onChange={(e) => set('agent_steps', e.target.value)} />
          </Field>
        </div>
      </Block>

      <Block title={t('Logo')} sub={t('Shown in the picker and beside replies. Generating and thinking fall back to the static logo.')}>
        <Fields cols={3}>
          <Field label={t('Static')}>
            <ImagePicker value={m.static_icon} fallback="" onChange={(v) => set('static_icon', v)} />
          </Field>
          <Field label={t('While generating')}>
            <ImagePicker value={m.generating_icon} fallback={m.static_icon || ''} onChange={(v) => set('generating_icon', v)} />
            <div style={{ marginTop: 8 }}>
              <Select value={m.generating_anim || 'none'} onChange={(v) => set('generating_anim', v)}
                options={MOTIONS.map(([value, label]) => ({ value, label: t(label) }))} />
            </div>
          </Field>
          <Field label={t('While thinking')}>
            <ImagePicker value={m.thinking_icon} fallback={m.static_icon || ''} onChange={(v) => set('thinking_icon', v)} />
            <div style={{ marginTop: 8 }}>
              <Select value={m.thinking_anim || 'none'} onChange={(v) => set('thinking_anim', v)}
                options={MOTIONS.map(([value, label]) => ({ value, label: t(label) }))} />
            </div>
          </Field>
        </Fields>
        <div className="cp-acts" style={{ marginTop: 14 }}>
          {m.static_icon
            ? <Btn size="sm" onClick={() => onChange({ ...m, static_icon: '', generating_icon: '', thinking_icon: '' })}>{t('Clear all three')}</Btn>
            : <Btn size="sm" onClick={() => onChange({ ...m, static_icon: BRAND_ICON, generating_icon: BRAND_GENERATING, thinking_icon: BRAND_THINKING })}>{t('Use the built-in mark')}</Btn>}
        </div>
        <div style={{ marginTop: 16, maxWidth: 420 }}>
          <Field label={t('Size beside replies')} hint={t('{n}px. 40 is the default, 26 matches the older layout.', { n: m.icon_size || 40 })}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="range" min="14" max="64" value={m.icon_size || 40}
                onChange={(e) => set('icon_size', parseInt(e.target.value, 10))}
                style={{ flex: 1, accentColor: 'var(--text)' }} />
              <Btn size="sm" disabled={!m.icon_size} onClick={() => set('icon_size', 0)}>{t('Reset')}</Btn>
            </div>
          </Field>
        </div>
        <div style={{ paddingTop: 8 }}>
          <Toggle m={m} set={set} k="dropdown_icon" inverted label={t('Logo in the picker')} note={t('Shows the static logo beside the name in the model list.')} />
          <Toggle m={m} set={set} k="show_name" label={t('Name beside replies')} note={t('Prints the model name next to its logo on each reply.')} />
        </div>
      </Block>

      <Block title={t('Badges')} sub={t('Small capability marks shown near the model name.')}>
        <Toggle m={m} set={set} k="cap_text" label={t('Text badge')} note={t('Marks the model as text-in only.')} />
        <Toggle m={m} set={set} k="cap_vision" label={t('Image badge')} note={t('Marks the model as accepting images.')} />
        <Toggle m={m} set={set} k="cap_reasoning" label={t('Reasoning badge')} note={t('Marks the model as able to reason.')} />
        <Toggle m={m} set={set} k="cap_compact" label={t('Collapse into one')} note={t('Replaces the set with a single marker that reveals the rest on hover.')} />
      </Block>

      <Block title={t('Showcase backdrop')} sub={t('An optional backdrop behind the whole interface while this model is selected.')}>
        <Toggle m={m} set={set} k="bg_enabled" label={t('Use a backdrop')} note={t('Applies only while a member has this model chosen.')} />
        {!!m.bg_enabled && (
          <div style={{ paddingTop: 14, maxWidth: 640 }}>
            <Field label={t('Image URL or CSS gradient')}
              hint={t('A remote URL needs the origin lock in Network turned off.')}>
              <Input mono value={m.bg_image || ''} placeholder="linear-gradient(120deg, #f7b733, #fc4a1a)"
                onChange={(e) => set('bg_image', e.target.value)} />
            </Field>
          </div>
        )}
      </Block>

      <Block title={t('Reference page')}
        sub={t('Feeds the model reference members open from the chat. Name, logo, subtitle, window, and price come from the fields above.')}>
        <Toggle m={m} set={set} k="docs_featured" label={t('Feature at the top')} note={t('Placed in the highlighted row with a banner.')} />
        {!!m.docs_featured && (
          <div style={{ paddingTop: 14, maxWidth: 640 }}>
            <Field label={t('Banner')} hint={t('An image URL or a CSS gradient, shown above the name.')}>
              <Input mono value={m.docs_image || ''} onChange={(e) => set('docs_image', e.target.value)} />
            </Field>
          </div>
        )}
        <div style={{ paddingTop: 14 }}>
          <Fields cols={3}>
            <Field label={t('Reference logo')} hint={t('Optional. Falls back to the model logo.')}>
              <ImagePicker value={m.docs_icon || ''} fallback="" onChange={(v) => set('docs_icon', v)} />
            </Field>
            <Field label={t('Intelligence')} hint={t('{n} of 5. Zero hides the meter.', { n: m.docs_intelligence || 0 })}>
              <input type="range" min="0" max="5" step="1" value={m.docs_intelligence || 0}
                onChange={(e) => set('docs_intelligence', e.target.value)} style={{ width: '100%', accentColor: 'var(--text)' }} />
            </Field>
            <Field label={t('Speed')} hint={t('{n} of 5. Zero hides the meter.', { n: m.docs_speed || 0 })}>
              <input type="range" min="0" max="5" step="1" value={m.docs_speed || 0}
                onChange={(e) => set('docs_speed', e.target.value)} style={{ width: '100%', accentColor: 'var(--text)' }} />
            </Field>
          </Fields>
        </div>
        <div style={{ paddingTop: 16 }}>
          <Fields cols={2}>
            <Field label={t('Accepts')}>
              {MODALITIES.map(([k, label]) => {
                const key = 'docs_in_' + k;
                const on = k === 'text' ? m[key] !== 0 : (k === 'image' ? (!!m[key] || !!m.has_vision) : !!m[key]);
                return (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                    <span>{t(label)}</span>
                    <Switch on={on} label={t(label)} onToggle={() => set(key, (k === 'text' ? m[key] !== 0 : !!m[key]) ? 0 : 1)} />
                  </div>
                );
              })}
            </Field>
            <Field label={t('Produces')}>
              {MODALITIES.map(([k, label]) => {
                const key = 'docs_out_' + k;
                const on = k === 'text' ? m[key] !== 0 : !!m[key];
                return (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                    <span>{t(label)}</span>
                    <Switch on={on} label={t(label)} onToggle={() => set(key, on ? 0 : 1)} />
                  </div>
                );
              })}
            </Field>
          </Fields>
        </div>
        <div style={{ paddingTop: 16 }}>
          <Fields cols={2}>
            <Field label={t('Max output tokens')} hint={t('Blank hides the row.')}>
              <Input mono type="number" min="0" step="1" value={m.docs_max_output ?? ''} placeholder="128000"
                onChange={(e) => set('docs_max_output', e.target.value)} />
            </Field>
            <Field label={t('Knowledge cutoff')} hint={t('Free text. Blank hides the row.')}>
              <Input value={m.docs_cutoff || ''} placeholder="Feb 16, 2026" onChange={(e) => set('docs_cutoff', e.target.value)} />
            </Field>
          </Fields>
        </div>
        <div style={{ paddingTop: 16 }}>
          <Field label={t('Long description')} hint={t('A few paragraphs on what this model is best at.')}>
            <Area rows={6} value={m.docs_body || ''} onChange={(e) => set('docs_body', e.target.value)} />
          </Field>
        </div>
      </Block>

      <Block title={t('Sampling')}
        sub={connType
          ? t('Blank uses the backend default. Only parameters {name} accepts are shown.', { name: connType.label })
          : t('Blank uses the backend default.')}>
        <SamplerBank m={m} set={set} allowed={allowed} />
        <div style={{ marginTop: 16, maxWidth: 640 }}>
          <Field label={t('Stop sequences')}
            hint={t('One per line, up to 8. Generation stops as soon as one appears and the sequence itself is not shown.')}>
            <Area mono rows={3} value={m.stop || ''} placeholder={'</s>\n<|im_end|>'} onChange={(e) => set('stop', e.target.value)} />
          </Field>
        </div>
      </Block>

      <Block title={t('Price')} sub={t('Per million tokens. Drives the usage report and every spend cap.')}>
        <Fields cols={3}>
          <Field label={t('Input $/M')}>
            <Input mono type="number" step="any" min="0" placeholder="3.00" value={m.cost_in ?? ''}
              onChange={(e) => set('cost_in', e.target.value)} />
          </Field>
          <Field label={t('Output $/M')}>
            <Input mono type="number" step="any" min="0" placeholder="15.00" value={m.cost_out ?? ''}
              onChange={(e) => set('cost_out', e.target.value)} />
          </Field>
          <Field label={t('Shortcuts')}>
            <div className="cp-acts">
              {preset && <Btn size="sm" onClick={() => onChange({ ...m, cost_in: preset.in, cost_out: preset.out })}>
                {t('Use {label}', { label: preset.label })}
              </Btn>}
              <Btn size="sm" onClick={() => onChange({ ...m, cost_in: null, cost_out: null })}>{t('Clear')}</Btn>
            </div>
          </Field>
        </Fields>
        {preset && <div style={{ marginTop: 12 }}>
          <Note>{t('The price table matches this id to {label}: ${in} in, ${out} out.', { label: preset.label, in: preset.in, out: preset.out })}</Note>
        </div>}
      </Block>

      <Block title={t('Voice calls')} sub={t('Replaces the system prompt during a call, where replies are spoken.')}>
        <Area rows={4} value={m.call_prompt || ''}
          placeholder={t('You are on a voice call. Keep replies short and easy to listen to.')}
          onChange={(e) => set('call_prompt', e.target.value)} />
      </Block>

      <Block title={t('Routing')}>
        <Router m={m} set={setKind} models={models} />
      </Block>
    </>
  );
}
