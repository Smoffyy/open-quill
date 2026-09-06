import { useState, useEffect, useId } from 'react';
import { api } from '../../api.js';
import {
  Card, Rows, Row, ToggleRow, Fields, Field, Inline, Acts, Input, Area, Select, Seg, Range,
  Switch, Btn, IconBtn, Badge, Note, Empty, Table, Tabs, CopyBtn, SaveState
} from './ui.jsx';
import { ImagePicker } from './media.jsx';
import KwargsEditor from './KwargsEditor.jsx';
import { Chevron, Copy, Trash, Star, Eye, EyeOff, Plus, Up, Down, X } from '../icons.jsx';
import { t, tk } from '../../i18n.jsx';
import { BRAND_ICON, BRAND_GENERATING, BRAND_THINKING } from '../../lib/brand.js';

const TABS = [
  ['general', tk('General')],
  ['prompt', tk('Prompt')],
  ['abilities', tk('Abilities')],
  ['sampling', tk('Sampling')],
  ['appearance', tk('Appearance')],
  ['routing', tk('Routing')]
];

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

const DEFAULT_SAMPLERS = ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty',
  'presence_penalty', 'frequency_penalty', 'seed', 'max_tokens'];

const APPROX_CHARS_PER_TOKEN = 4;

// A flag stored as 0/1 where the on state is the default reads "inverted": the
// column is absent on old rows, so only an explicit 0 means off.
function Flag({ m, set, k, label, note, inverted }) {
  const on = inverted ? m[k] !== 0 : !!m[k];
  return <ToggleRow label={label} note={note} on={on} onToggle={() => set(k, on ? 0 : 1)} />;
}

function SamplerBank({ m, set, allowed }) {
  const banks = SAMPLERS
    .map(([title, note, fields]) => [title, note, fields.filter(([k]) => allowed.includes(k))])
    .filter(([, , fields]) => fields.length);

  return banks.map(([title, note, fields]) => (
    <Card key={title} title={t(title)} sub={t(note)}>
      <Fields cols={3}>
        {fields.map(([k, label, ph]) => (
          <Field key={k} label={label}>
            <Input mono type="number" step="any" placeholder={ph} value={m[k] ?? ''} onChange={(e) => set(k, e.target.value)} />
          </Field>
        ))}
      </Fields>
    </Card>
  ));
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
      <Card title={t('Routing')}>
        <Rows>
          <Row label={t('Route instead of answering')}
            note={t('A router never calls a backend itself. It appears in the picker like any other model and hands each turn to the first model whose rule matches.')}>
            <Switch on={m.kind === 'router'} label={t('Route instead of answering')}
              onToggle={() => set('kind', m.kind === 'router' ? 'model' : 'router')} />
          </Row>
        </Rows>
      </Card>

      {m.kind === 'router' && (
        <Card title={t('Rules')} sub={t('Checked from the top. The first match wins.')}
          actions={<Btn size="sm" onClick={() => set('router_rules', [...rules, { match: 'keyword', value: '', modelId: targets[0]?.id || '', label: '' }])}>
            <Plus /> {t('Add rule')}
          </Btn>}>
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
                      <Select value={r.match} onChange={(v) => upd(i, { match: v })} label={t('When the message')}
                        options={MATCHERS.map(([value, label]) => ({ value, label: t(label) }))} />
                    </td>
                    <td>
                      {NEEDS_VALUE.has(r.match)
                        ? <Input mono value={r.value || ''} onChange={(e) => upd(i, { value: e.target.value })}
                          aria-label={t('Value')}
                          placeholder={r.match === 'keyword' ? 'translate, traducir' : r.match === 'regex' ? '^\\s*(fix|debug)\\b' : '400'} />
                        : <span className="dim">—</span>}
                    </td>
                    <td>
                      <Select value={r.modelId || ''} onChange={(v) => upd(i, { modelId: v })} label={t('Send to')}
                        options={[{ value: '', label: t('choose a model') },
                          ...pickable.map(x => ({ value: x.id, label: (x.display_name || x.internal_name) + (x.kind === 'router' ? ' ' + t('(router)') : '') }))]} />
                    </td>
                    <td><Input value={r.label || ''} placeholder={t('optional')} aria-label={t('Shown as')}
                      onChange={(e) => upd(i, { label: e.target.value })} /></td>
                    <td className="acts">
                      <Acts end>
                        <IconBtn label={t('Move up')} disabled={i === 0} onClick={() => move(i, -1)}><Up /></IconBtn>
                        <IconBtn label={t('Move down')} disabled={i === rules.length - 1} onClick={() => move(i, 1)}><Down /></IconBtn>
                        <IconBtn kind="danger" label={t('Remove')}
                          onClick={() => set('router_rules', rules.filter((_, j) => j !== i))}><X /></IconBtn>
                      </Acts>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          <Fields cols={2}>
            <Field label={t('Fallback')}
              hint={t('Used when no rule matches. Without one, a router refuses the turn rather than guessing.')}>
              <Select value={m.router_default || ''} onChange={(v) => set('router_default', v)}
                label={t('Fallback')}
                options={[{ value: '', label: t('none') }, ...pickable.map(x => ({ value: x.id, label: x.display_name || x.internal_name }))]} />
            </Field>
          </Fields>
        </Card>
      )}
    </>
  );
}


export default function ModelEditor({ model: m, models, providers, providerTypes, saveState, onChange, onBack, onDuplicate, onDelete }) {
  const panelId = useId();
  const [tab, setTab] = useState('general');
  const [preset, setPreset] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState('');

  const set = (k, v) => onChange({ ...m, [k]: v });

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

  const conn = providers?.find(p => p.id === m.provider_id) || providers?.[0];
  const connType = conn ? providerTypes[conn.type] : null;
  const allowed = connType?.samplers || DEFAULT_SAMPLERS;
  const promptLength = (m.system_prompt || '').length;

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
    <div className="cp-editor">
      <div className="cp-editor-head">
        <div className="cp-editor-bar">
          <Btn size="sm" onClick={onBack}>
            <Chevron style={{ transform: 'rotate(180deg)' }} /> {t('All models')}
          </Btn>
          <div className="cp-editor-id">
            {m.static_icon && <img src={m.static_icon} alt="" />}
            <b>{m.display_name || t('Untitled')}</b>
            <span className="cp-badges">
              {!!m.is_default && <Badge tone="on">{t('default')}</Badge>}
              {!m.enabled && <Badge>{t('hidden')}</Badge>}
              {!!m.unavailable && <Badge tone="bad">{t('down')}</Badge>}
              {m.kind === 'router' && <Badge tone="warn">{t('router')}</Badge>}
            </span>
          </div>
          <SaveState state={saveState} />
          <Acts>
            <IconBtn label={m.is_default ? t('Already the default') : t('Make default')}
              disabled={!!m.is_default} onClick={() => set('is_default', 1)}><Star /></IconBtn>
            <IconBtn label={m.enabled ? t('Hide from members') : t('Show to members')}
              onClick={() => set('enabled', m.enabled ? 0 : 1)}>{m.enabled ? <Eye /> : <EyeOff />}</IconBtn>
            <IconBtn label={t('Duplicate')} onClick={onDuplicate}><Copy /></IconBtn>
            <IconBtn kind="danger" label={t('Delete')} onClick={onDelete}><Trash /></IconBtn>
          </Acts>
        </div>

        <Tabs label={t('Model settings')} value={tab} onChange={setTab} panelId={panelId}
          items={TABS.map(([id, label]) => ({ id, label: t(label) }))} />
      </div>

      <div id={panelId} className="cp-editor-pane" role="tabpanel" aria-label={t('Model settings')}>
        {tab === 'general' && (
          <>
            <Card title={t('Identity')}>
              <Fields cols={3}>
                <Field label={t('Display name')} hint={t('What members see in the picker.')}>
                  <Input value={m.display_name || ''} placeholder={t('Untitled')} onChange={(e) => set('display_name', e.target.value)} />
                </Field>
                <Field label={t('Model id')} hint={t('Sent verbatim to the backend. Must match what the provider reports.')}>
                  <Inline>
                    <Input mono value={m.internal_name || ''} placeholder="llama-3.1-8b-instruct"
                      onChange={(e) => set('internal_name', e.target.value)} />
                    {!!(m.internal_name || '').trim() && <CopyBtn text={m.internal_name} title={t('Copy model id')} />}
                  </Inline>
                </Field>
                <Field label={t('Connection')} hint={t('Which backend this model runs through.')}>
                  <Select value={m.provider_id || conn?.id || ''} onChange={(v) => set('provider_id', v)} label={t('Connection')}
                    options={(providers || []).map(p => ({ value: p.id, label: p.name || providerTypes[p.type]?.label || p.type }))} />
                </Field>
              </Fields>
              <Field label={t('Subtitle')} hint={t('One line under the name in the picker.')}>
                <Input value={m.description || ''} placeholder={t('For complex tasks')} onChange={(e) => set('description', e.target.value)} />
              </Field>
            </Card>

            <Card title={t('Availability')}>
              <Rows>
                <Flag m={m} set={set} k="enabled" inverted label={t('Listed in the picker')}
                  note={t('Off, the model is invisible to members but stays configured.')} />
                <Flag m={m} set={set} k="is_default" label={t('Default for new accounts')}
                  note={t('Pre-selected on first sign-in. Only one model holds this.')} />
                <Flag m={m} set={set} k="unavailable" label={t('Marked as down')}
                  note={t('Stays in the picker but cannot be selected. Use it while a backend is offline.')} />
              </Rows>
              {!!m.unavailable && (
                <Field label={t('Reason shown to members')}>
                  <Area rows={3} value={m.unavailable_reason || ''}
                    placeholder={t('Back after the GPU maintenance window.')}
                    onChange={(e) => set('unavailable_reason', e.target.value)} />
                </Field>
              )}
              <Fields cols={2}>
                <Field label={t('Retire on')} hint={t('Blank never retires. On the date, the model follows the action beside it.')}>
                  <Input type="date" value={m.sunset_at || ''} onChange={(e) => set('sunset_at', e.target.value)} />
                </Field>
                {!!m.sunset_at && (
                  <Field label={t('On that date')}>
                    <Select value={m.sunset_action || 'hide'} onChange={(v) => set('sunset_action', v)} label={t('On that date')}
                      options={[{ value: 'hide', label: t('hide from the picker') }, { value: 'unavailable', label: t('mark as down') }]} />
                  </Field>
                )}
              </Fields>
            </Card>

            <Card title={t('Price')} sub={t('Per million tokens. Drives the usage report and every spend cap.')}>
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
                  <Acts>
                    {preset && <Btn onClick={() => onChange({ ...m, cost_in: preset.in, cost_out: preset.out })}>
                      {t('Use {label}', { label: preset.label })}
                    </Btn>}
                    <Btn onClick={() => onChange({ ...m, cost_in: null, cost_out: null })}>{t('Clear')}</Btn>
                  </Acts>
                </Field>
              </Fields>
              {preset && (
                <Note>{t('The price table matches this id to {label}: ${in} in, ${out} out.', { label: preset.label, in: preset.in, out: preset.out })}</Note>
              )}
            </Card>
          </>
        )}

        {tab === 'prompt' && (
          <>
            <Card title={t('System prompt')}
              sub={t('Prepended to every conversation. {date} and {user} are substituted on the member’s own device at send time.', { date: '{{currentDateTime}}', user: '{{currentUser}}' })}
              foot={<>
                <span className="cp-note-line">
                  {t('{n} characters', { n: promptLength.toLocaleString() })}
                  {' · '}
                  {t('~{n} tokens', { n: Math.round(promptLength / APPROX_CHARS_PER_TOKEN).toLocaleString() })}
                </span>
                <span className="cp-toolbar-spacer" />
                <Btn size="sm" onClick={() => set('system_prompt', (m.system_prompt || '') + '{{currentDateTime}}')}>
                  <Plus /> {t('date')}
                </Btn>
                <Btn size="sm" onClick={() => set('system_prompt', (m.system_prompt || '') + '{{currentUser}}')}>
                  <Plus /> {t('user')}
                </Btn>
              </>}>
              <Area mono rows={16} value={m.system_prompt || ''}
                aria-label={t('System prompt')}
                placeholder={t('You are a helpful assistant…')}
                onChange={(e) => set('system_prompt', e.target.value)} />
            </Card>

            <Card title={t('Voice calls')} sub={t('Replaces the system prompt during a call, where replies are spoken.')}>
              <Area rows={5} value={m.call_prompt || ''} aria-label={t('Voice calls')}
                placeholder={t('You are on a voice call. Keep replies short and easy to listen to.')}
                onChange={(e) => set('call_prompt', e.target.value)} />
            </Card>
          </>
        )}

        {tab === 'abilities' && (
          <>
            <Card title={t('Capabilities')} sub={t('What this model is allowed to do inside a chat.')}>
              <Rows>
                <Flag m={m} set={set} k="has_vision" label={t('Image input')}
                  note={t('Off, image attachments are refused for this model.')} />
                <Flag m={m} set={set} k="sandbox_allowed" inverted label={t('Sandbox tools')}
                  note={t('Lets members turn on code execution and a per-chat filesystem.')} />
                {m.sandbox_allowed !== 0 && (
                  <Flag m={m} set={set} k="sandbox_auto" label={t('Sandbox on by default')} note={t('New chats start with it enabled.')} />
                )}
                <Flag m={m} set={set} k="web_search_allowed" inverted label={t('Web search')}
                  note={t('Requires web search to be configured under Tools.')} />
                {m.web_search_allowed !== 0 && (
                  <Flag m={m} set={set} k="web_search_auto" label={t('Web search on by default')} note={t('New chats start with it enabled.')} />
                )}
                <Flag m={m} set={set} k="skills_allowed" label={t('Skills')} note={t('Offers the skills defined under Tools.')} />
                <Flag m={m} set={set} k="mcp_allowed" label={t('MCP tools')} note={t('Exposes tools from every enabled MCP server.')} />
                <Flag m={m} set={set} k="chat_search_allowed" label={t('Past-chat search')} note={t('Lets the model search the member’s own earlier chats.')} />
                <Flag m={m} set={set} k="long_convo_reminder" label={t('Conversation length awareness')}
                  note={t('Tells the model how long the conversation has grown.')} />
                <Flag m={m} set={set} k="end_chat_allowed" label={t('End conversation tool')}
                  note={t('Lets the model close a chat for good. Ended chats cannot be reopened.')} />
                <Row label={t('Tool calls per turn')} note={t('Blank is unlimited. A ceiling stops runaway agent loops.')} wide>
                  <Input mono type="number" min="0" value={m.agent_steps || ''} placeholder={t('unlimited')}
                    aria-label={t('Tool calls per turn')}
                    onChange={(e) => set('agent_steps', e.target.value)} />
                </Row>
              </Rows>
              {!!m.end_chat_allowed && (
                <Field label={t('When to end')}>
                  <Area rows={4} value={m.end_chat_prompt ?? ''}
                    placeholder={t('End the conversation only when the member says goodbye.')}
                    onChange={(e) => set('end_chat_prompt', e.target.value)} />
                </Field>
              )}
            </Card>

            <Card title={t('Reasoning')} sub={t('How the model thinks before answering, and how much of that members see.')}>
              <Rows>
                <Flag m={m} set={set} k="reasoning_collapsible" inverted label={t('Show the thought process')}
                  note={t('Off, members see only a status line while it thinks.')} />
                {m.reasoning_collapsible === 0 && (
                  <Flag m={m} set={set} k="hide_thinking" label={t('Hide the status line too')}
                    note={t('The reply simply appears when it is ready.')} />
                )}
                <Flag m={m} set={set} k="has_reasoning" label={t('Switch modes with a prompt token')}
                  note={t('For models that toggle thinking by a token in the prompt. Adds an extended-thinking control for members.')} />
              </Rows>
              <Fields cols={2}>
                <Field label={t('Opening tag')} hint={t('Blank uses the default think tags.')}>
                  <Input mono value={m.think_open || ''} placeholder="<think>" onChange={(e) => set('think_open', e.target.value)} />
                </Field>
                <Field label={t('Closing tag')}>
                  <Input mono value={m.think_close || ''} placeholder="</think>" onChange={(e) => set('think_close', e.target.value)} />
                </Field>
              </Fields>
              {!!m.has_reasoning && (
                <Fields cols={2}>
                  <Field label={t('Extended token')}>
                    <Input mono value={m.reasoning_token || ''} placeholder="/think" onChange={(e) => set('reasoning_token', e.target.value)} />
                  </Field>
                  <Field label={t('Standard token')}>
                    <Input mono value={m.non_reasoning_token || ''} placeholder="/no_think" onChange={(e) => set('non_reasoning_token', e.target.value)} />
                  </Field>
                </Fields>
              )}
            </Card>

            <Card title={t('Context window')} sub={t('What happens as a conversation approaches the model’s limit.')}>
              <Fields cols={3}>
                <Field label={t('Window size')} hint={detected || t('Tokens the backend can hold. Blank falls back to a conservative default.')}>
                  <Inline>
                    <Input mono type="number" min="0" value={m.num_ctx ?? ''} placeholder="32768"
                      onChange={(e) => set('num_ctx', e.target.value)} />
                    <Btn size="sm" disabled={detecting} onClick={detectCtx}>{detecting ? t('Reading…') : t('Detect')}</Btn>
                  </Inline>
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
              <Rows>
                <Flag m={m} set={set} k="enable_summaries" label={t('Compact older turns')}
                  note={t('Near the limit, earlier turns are replaced by a summary so the conversation can continue.')} />
                <Row label={t('When the chat outgrows the window')}
                  note={t('Keeping history drops the least, but the prompt changes every turn and a local backend re-reads the whole conversation. Keeping the cache warm drops more but leaves the prefix stable.')}>
                  <Seg value={m.ctx_trim_mode || 'history'} label={t('Trim strategy')}
                    onChange={(v) => set('ctx_trim_mode', v)}
                    options={[{ value: 'history', label: t('keep history') }, { value: 'cache', label: t('keep cache warm') }]} />
                </Row>
              </Rows>
            </Card>

            <Card title={t('Request controls')}
              sub={t('Extra fields merged into each request body, and the controls members get for them.')}>
              <KwargsEditor m={m} set={set} onChange={onChange} />
            </Card>
          </>
        )}

        {tab === 'sampling' && (
          <>
            <Card title={t('Sampling')}
              sub={connType
                ? t('Blank uses the backend default. Only parameters {name} accepts are shown.', { name: connType.label })
                : t('Blank uses the backend default.')}>
              <Field label={t('Stop sequences')}
                hint={t('One per line, up to 8. Generation stops as soon as one appears and the sequence itself is not shown.')}>
                <Area mono rows={3} value={m.stop || ''} placeholder={'</s>\n<|im_end|>'} onChange={(e) => set('stop', e.target.value)} />
              </Field>
            </Card>
            <SamplerBank m={m} set={set} allowed={allowed} />
          </>
        )}

        {tab === 'appearance' && (
          <>
            <Card title={t('Logo')} sub={t('Shown in the picker and beside replies. Generating and thinking fall back to the static logo.')}
              foot={m.static_icon
                ? <Btn size="sm" onClick={() => onChange({ ...m, static_icon: '', generating_icon: '', thinking_icon: '' })}>{t('Clear all three')}</Btn>
                : <Btn size="sm" onClick={() => onChange({ ...m, static_icon: BRAND_ICON, generating_icon: BRAND_GENERATING, thinking_icon: BRAND_THINKING })}>{t('Use the built-in mark')}</Btn>}>
              <Fields cols={3}>
                <Field label={t('Static')}>
                  <ImagePicker value={m.static_icon} fallback="" onChange={(v) => set('static_icon', v)} />
                </Field>
                <Field label={t('While generating')}>
                  <div className="cp-stack">
                    <ImagePicker value={m.generating_icon} fallback={m.static_icon || ''} onChange={(v) => set('generating_icon', v)} />
                    <Select value={m.generating_anim || 'none'} onChange={(v) => set('generating_anim', v)} label={t('While generating')}
                      options={MOTIONS.map(([value, label]) => ({ value, label: t(label) }))} />
                  </div>
                </Field>
                <Field label={t('While thinking')}>
                  <div className="cp-stack">
                    <ImagePicker value={m.thinking_icon} fallback={m.static_icon || ''} onChange={(v) => set('thinking_icon', v)} />
                    <Select value={m.thinking_anim || 'none'} onChange={(v) => set('thinking_anim', v)} label={t('While thinking')}
                      options={MOTIONS.map(([value, label]) => ({ value, label: t(label) }))} />
                  </div>
                </Field>
              </Fields>
              <Rows>
                <Row label={t('Size beside replies')} note={t('{n}px. 40 is the default, 26 matches the older layout.', { n: m.icon_size || 40 })} wide>
                  <Range min="14" max="64" value={m.icon_size || 40} label={t('Size beside replies')}
                    onChange={(e) => set('icon_size', parseInt(e.target.value, 10))} />
                  <Btn size="sm" disabled={!m.icon_size} onClick={() => set('icon_size', 0)}>{t('Reset')}</Btn>
                </Row>
                <Row label={t('Position')} note={t('Where the logo sits against the reply.')}>
                  <Seg value={m.icon_position || 'below'} label={t('Position')}
                    onChange={(v) => set('icon_position', v)}
                    options={[{ value: 'below', label: t('Below') }, { value: 'left', label: t('Left') }, { value: 'above', label: t('Above') }]} />
                </Row>
                <Flag m={m} set={set} k="dropdown_icon" inverted label={t('Logo in the picker')} note={t('Shows the static logo beside the name in the model list.')} />
                <Flag m={m} set={set} k="show_name" label={t('Name beside replies')} note={t('Prints the model name next to its logo on each reply.')} />
              </Rows>
            </Card>

            <Card title={t('Badges')} sub={t('Small capability marks shown near the model name.')}>
              <Rows>
                <Flag m={m} set={set} k="cap_text" label={t('Text badge')} note={t('Marks the model as text-in only.')} />
                <Flag m={m} set={set} k="cap_vision" label={t('Image badge')} note={t('Marks the model as accepting images.')} />
                <Flag m={m} set={set} k="cap_reasoning" label={t('Reasoning badge')} note={t('Marks the model as able to reason.')} />
                <Flag m={m} set={set} k="cap_compact" label={t('Collapse into one')} note={t('Replaces the set with a single marker that reveals the rest on hover.')} />
              </Rows>
            </Card>

            <Card title={t('Showcase backdrop')} sub={t('An optional backdrop behind the whole interface while this model is selected.')}>
              <Rows>
                <Flag m={m} set={set} k="bg_enabled" label={t('Use a backdrop')} note={t('Applies only while a member has this model chosen.')} />
              </Rows>
              {!!m.bg_enabled && (
                <Field label={t('Image URL or CSS gradient')}
                  hint={t('A remote URL needs the origin lock in Network turned off.')}>
                  <Input mono value={m.bg_image || ''} placeholder="linear-gradient(120deg, #f7b733, #fc4a1a)"
                    onChange={(e) => set('bg_image', e.target.value)} />
                </Field>
              )}
            </Card>
          </>
        )}

        {tab === 'routing' && <Router m={m} set={set} models={models} />}
      </div>
    </div>
  );
}
