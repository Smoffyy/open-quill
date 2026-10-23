import { sanitizeKwargs } from './kwargs.js';

const LISTING_MS = 60 * 60 * 1000;
const LISTING_MAX = 20;

const effort = (values, fallback, name = 'reasoning_effort') => ({
  id: 'effort', name, label: 'Reasoning effort', description: 'How long the model thinks before it answers',
  values, default: values.includes(fallback) ? fallback : values[Math.floor(values.length / 2)],
  control: values.length > 5 ? 'select' : 'auto', target: 'body', type: 'string'
});

const thinkingSwitch = (name, on, off, fallback = true) => [
  {
    id: 'thinking', name: '', label: 'Thinking', description: 'Let the model think before answering', chip: 'Thinking',
    values: ['false', 'true'], default: String(fallback), control: 'toggle', target: 'body', type: 'string'
  },
  {
    id: 'thinking_mode', name, label: 'Thinking mode', values: [], visible: false, target: 'body', type: 'string',
    parentId: 'thinking', rules: [{ when: 'true', value: on }, { when: 'false', value: off }]
  }
];

const gated = (def) => ({ ...def, showIf: { id: 'thinking', value: 'true' }, sendWhenHidden: false });

const LOW_HIGH = ['low', 'medium', 'high'];
const UP_TO_XHIGH = ['low', 'medium', 'high', 'xhigh'];
const UP_TO_MAX = ['low', 'medium', 'high', 'xhigh', 'max'];

const RULES = {
  __proto__: null,
  openai: [
    { test: /^gpt-6(?:\.\d+)?-luna/, vision: true, ctx: 1050000, controls: () => [effort(['none', ...UP_TO_MAX], 'medium')] },
    { test: /^gpt-6/, vision: true, ctx: 1050000, controls: () => [effort(UP_TO_MAX, 'medium')] },
    { test: /^gpt-5\.(?:[2-9]|\d{2,})/, vision: true, ctx: 400000, controls: () => [effort(['none', ...UP_TO_XHIGH], 'medium')] },
    { test: /^gpt-5\.1(?!\d)(?!.*chat)/, vision: true, ctx: 400000, controls: () => [effort(['none', ...LOW_HIGH], 'none')] },
    { test: /chat-latest|^gpt-5.*-chat/, vision: true, ctx: 128000, controls: () => [] },
    { test: /^gpt-5/, vision: true, ctx: 400000, controls: () => [effort(['minimal', ...LOW_HIGH], 'medium')] },
    { test: /^o1-mini/, vision: false, ctx: 128000, controls: () => [] },
    { test: /^o\d/, vision: true, ctx: 200000, controls: () => [effort(LOW_HIGH, 'medium')] },
    { test: /^gpt-4\.1/, vision: true, ctx: 1047576, controls: () => [] },
    { test: /^gpt-4o/, vision: true, ctx: 128000, controls: () => [] }
  ],
  anthropic: [
    { test: /^claude-(?:opus|haiku)-5-5/, reasoning: true, vision: true, controls: () => [effort(UP_TO_MAX, 'medium', 'effort')] },
    { test: /^claude-(?:opus|sonnet|haiku)-4-6/, reasoning: true, vision: true, controls: () => [effort(['low', 'medium', 'high', 'max'], 'high', 'effort')] },
    { test: /^claude-opus-4-5/, reasoning: true, vision: true, controls: () => [effort(LOW_HIGH, 'high', 'effort')] },
    { test: /^claude-(?:3|instant|(?:opus|sonnet|haiku)-4(?:-[015])?(?:-\d{8}|-latest)?$)/, reasoning: true, vision: true, controls: () => [] },
    { test: /^claude-/, reasoning: true, vision: true, controls: () => [effort(UP_TO_MAX, 'high', 'effort')] }
  ],
  gemini: [
    { test: /embedding|tts|image|aqa|live/, vision: false, controls: () => [] },
    { test: /^gemini-3-pro/, vision: true, ctx: 1048576, controls: () => [effort(['low', 'high'], 'high')] },
    { test: /^gemini-\d+(?:\.\d+)?-pro/, vision: true, ctx: 1048576, controls: () => [effort(LOW_HIGH, 'high')] },
    { test: /^gemini-(?:[3-9]|\d{2,})(?:\.\d+)?-flash-lite/, vision: true, ctx: 1048576, controls: () => [effort(['minimal', ...LOW_HIGH], 'minimal')] },
    { test: /^gemini-3(?:\.[0-6])?-flash/, vision: true, ctx: 1048576, controls: () => [effort(['minimal', ...LOW_HIGH], 'medium')] },
    { test: /^gemini-2\.5-flash/, vision: true, ctx: 1048576, controls: () => [effort(['none', ...LOW_HIGH], 'medium')] },
    { test: /^gemini-(?:[3-9]|\d{2,})/, vision: true, ctx: 1048576, controls: () => [effort(LOW_HIGH, 'medium')] },
    { test: /^gemini-/, vision: true, ctx: 1048576, controls: () => [] }
  ],
  moonshot: [
    { test: /^kimi-k2\.[56]/, vision: true, ctx: 262144, controls: () => thinkingSwitch('thinking.type', 'enabled', 'disabled') },
    { test: /^kimi-k2\.7-code/, vision: false, ctx: 262144, controls: () => [] },
    { test: /^kimi-k[3-9]/, vision: true, ctx: 262144, controls: () => [] },
    { test: /^kimi-/, vision: false, ctx: 262144, controls: () => [] },
    { test: /vision/, vision: true, controls: () => [] }
  ],
  mistral: [
    { test: /^zai-glm-5/, vision: false, controls: () => [effort(['low', 'high', 'max'], 'high')] },
    { test: /^mistral-(?:small-latest|small-4|medium-3[.-]5|large-4)/, vision: true, controls: () => [effort(['none', 'high'], 'high')] },
    { test: /^(?:pixtral|mistral-(?:small|medium|large)|ministral-3)/, vision: true, controls: () => [] },
    { test: /^(?:magistral|codestral|devstral|ministral|open-)/, vision: false, controls: () => [] }
  ],
  meta: [
    { test: /llama-4/i, vision: true, ctx: 128000, controls: () => [] },
    { test: /llama-3/i, vision: false, ctx: 128000, controls: () => [] }
  ],
  xai: [
    { test: /^grok-4\.20-multi-agent/, vision: true, controls: () => [] },
    { test: /^grok-4\.(?:[6-9]|\d{2,})/, vision: true, controls: () => [effort(UP_TO_XHIGH, 'high')] },
    { test: /^grok-4\.5/, vision: true, controls: () => [effort(LOW_HIGH, 'high')] },
    { test: /^grok-4\.3/, vision: true, controls: () => [effort(['none', ...LOW_HIGH], 'low')] },
    { test: /^grok-3-mini/, vision: false, controls: () => [effort(['low', 'high'], 'low')] },
    { test: /^grok-/, vision: true, controls: () => [] }
  ],
  deepseek: [
    { test: /^deepseek-(?:v[4-9]|flash|pro)/, vision: false, controls: () => [...thinkingSwitch('thinking.type', 'enabled', 'disabled'), gated(effort(['low', 'high', 'max'], 'high'))] },
    { test: /^deepseek-/, vision: false, controls: () => [] }
  ]
};

const listings = new Map();

export function rememberListing(providerId, entries) {
  if (!providerId || !Array.isArray(entries)) return;
  listings.delete(providerId);
  listings.set(providerId, { at: Date.now(), byId: new Map(entries.filter(e => e && e.id).map(e => [String(e.id).toLowerCase(), e])) });
  if (listings.size > LISTING_MAX) listings.delete(listings.keys().next().value);
}

export function listingFor(providerId) {
  const hit = listings.get(providerId);
  return hit && Date.now() - hit.at < LISTING_MS ? hit.byId : null;
}

export function forgetListings() {
  listings.clear();
}

const asInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

function fromOpenRouter(entry) {
  const r = entry.reasoning && typeof entry.reasoning === 'object' ? entry.reasoning : null;
  const vision = (entry.architecture?.input_modalities || []).includes('image');
  const controls = [];
  if (r && Array.isArray(r.supported_efforts)) {
    const values = r.supported_efforts.filter(e => typeof e === 'string' && e !== 'none').reverse();
    if (!r.mandatory) values.unshift('none');
    if (values.length > 1) controls.push(effort(values, r.default_effort || 'medium', 'reasoning.effort'));
  } else if (r && r.supported_efforts === null) {
    controls.push(effort(r.mandatory ? LOW_HIGH : ['none', ...LOW_HIGH], r.default_effort || 'medium', 'reasoning.effort'));
  } else if (r && !r.mandatory) {
    controls.push({
      id: 'thinking', name: 'reasoning.enabled', label: 'Thinking', description: 'Let the model think before answering', chip: 'Thinking',
      values: ['false', 'true'], default: String(r.default_enabled !== false), control: 'toggle', target: 'body', type: 'boolean'
    });
  }
  return { vision, ctx: asInt(entry.context_length), reasoning: false, kwargs: controls, source: 'listing' };
}

export const bareId = (type, id) => {
  const s = String(id || '').trim().toLowerCase();
  if (type === 'anthropic') return s.replace(/^.*?(?=claude-)/, '');
  if (type === 'gemini') return s.replace(/^models\//, '');
  return s;
};

export function cloudPreset(type, id, listing = null) {
  const name = bareId(type, id);
  if (!name) return null;
  if (type === 'openrouter') {
    const entry = listing?.get(name);
    return entry ? fromOpenRouter(entry) : null;
  }
  const rule = (RULES[type] || []).find(r => r.test.test(name));
  if (!rule) return null;
  return { vision: !!rule.vision, ctx: rule.ctx || 0, reasoning: !!rule.reasoning, kwargs: rule.controls(), source: 'catalog' };
}

export function presetPatch(preset) {
  return {
    has_reasoning: preset.reasoning ? 1 : 0,
    has_vision: preset.vision ? 1 : 0,
    kwargs: sanitizeKwargs(preset.kwargs),
    effort_enabled: 0
  };
}

export function catalogCtx(type, id, listing = null) {
  return cloudPreset(type, id, listing)?.ctx || 0;
}