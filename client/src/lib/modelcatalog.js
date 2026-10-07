import { reasons } from './badges.js';

export { reasons };

const INVERTED = new Set(['sandbox_allowed', 'code_allowed', 'web_search_allowed', 'reasoning_collapsible', 'dropdown_icon', 'show_icon']);

export const FLAGS = new Set([
  'has_reasoning', 'has_vision', 'in_more_models', 'enabled', 'sandbox_auto', 'sandbox_allowed', 'code_allowed', 'dropdown_icon', 'show_icon',
  'is_default', 'unavailable',
  'reasoning_collapsible', 'bg_enabled', 'web_search_auto', 'web_search_allowed', 'show_name', 'skills_allowed',
  'mcp_allowed', 'chat_search_allowed', 'end_chat_allowed', 'memory_allowed', 'calculator_allowed', 'hide_tool_calls', 'todo_allowed', 'ask_user_allowed',
  'consult_allowed', 'consult_images', 'long_convo_reminder', 'parallel_requests', 'effort_enabled',
  'effort_admin_only', 'hide_thinking'
]);

const DEFAULT_FOLDER = 'More models';

export function flagOn(m, key) {
  return INVERTED.has(key) ? m?.[key] !== 0 : !!m?.[key];
}

export function folderOf(m) {
  return m && m.in_more_models ? ((m.more_models_label || '').trim() || null) : null;
}

export function folderPatch(name) {
  const clean = String(name || '').trim();
  return clean ? { in_more_models: 1, more_models_label: clean } : { in_more_models: 0, more_models_label: DEFAULT_FOLDER };
}

export function folderNames(models) {
  return [...new Set(models.map(folderOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function layout(models) {
  const out = [];
  const seen = new Set();
  for (const m of models) {
    const name = folderOf(m);
    if (!name) { out.push({ kind: 'model', key: m.id, model: m }); continue; }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ kind: 'folder', key: 'f:' + name, name, models: models.filter(x => folderOf(x) === name) });
  }
  return out;
}

export function displayOrder(models) {
  return layout(models).flatMap(e => (e.kind === 'model' ? [e.model] : e.models));
}

export function planMove(models, ids, { folder = null, targetId = null, after = false } = {}) {
  const moving = new Set(ids);
  const rest = models.filter(m => !moving.has(m.id));
  const picked = models.filter(m => moving.has(m.id));
  let at = rest.length;
  if (targetId) {
    const i = rest.findIndex(m => m.id === targetId);
    if (i >= 0) at = after ? i + 1 : i;
  } else if (folder) {
    const last = rest.map(folderOf).lastIndexOf(folder);
    if (last >= 0) at = last + 1;
  }
  return {
    order: [...rest.slice(0, at), ...picked, ...rest.slice(at)],
    moved: picked.filter(m => folderOf(m) !== folder).map(m => m.id),
    patch: folderPatch(folder)
  };
}

export function nudge(models, id, dir) {
  const seq = displayOrder(models);
  const i = seq.findIndex(m => m.id === id);
  const next = seq[i + dir];
  if (i < 0 || !next) return null;
  return planMove(seq, [id], { folder: folderOf(next), targetId: next.id, after: dir > 0 });
}

export function rangeIds(order, from, to) {
  let a = order.indexOf(from);
  const b = order.indexOf(to);
  if (b < 0) return [];
  if (a < 0) a = b;
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

export function matches(m, needle) {
  const q = String(needle || '').trim().toLowerCase();
  if (!q) return true;
  return [m.display_name, m.internal_name, m.description, folderOf(m)]
    .some(v => String(v || '').toLowerCase().includes(q));
}

export const STATUS = {
  __proto__: null,
  all: () => true,
  listed: (m) => !!m.enabled && !m.unavailable,
  hidden: (m) => !m.enabled,
  down: (m) => !!m.unavailable,
  unpublished: (m, changed) => !!changed && changed.has(m.id)
};

export function norm(m, key) {
  if (key === 'folder') return folderOf(m) || '';
  if (FLAGS.has(key)) return flagOn(m, key) ? '1' : '0';
  const v = m?.[key];
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function shared(models, key, { flag = false } = {}) {
  if (!models.length) return { value: undefined, mixed: false };
  const read = flag ? (m) => flagOn(m, key) : (m) => norm(m, key);
  const first = read(models[0]);
  const mixed = models.some(m => read(m) !== first);
  if (mixed) return { value: undefined, mixed: true };
  const raw = flag ? first : key === 'folder' ? first : models[0][key];
  return { value: raw, mixed: false };
}

export function variants(models, key, { flag = false } = {}) {
  const groups = new Map();
  for (const m of models) {
    const k = flag ? String(flagOn(m, key)) : norm(m, key);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  return [...groups.values()];
}

export const TEXT_OPS = ['replace', 'prepend', 'append', 'swap'];

export function applyText(cur, op, text, find = '') {
  const base = String(cur || '');
  const add = String(text || '');
  if (op === 'prepend') return add ? add + (base ? '\n\n' + base : '') : base;
  if (op === 'append') return add ? (base ? base + '\n\n' : '') + add : base;
  if (op === 'swap') return find ? base.split(find).join(add) : base;
  return add;
}

export const APPROX_CHARS_PER_TOKEN = 4;

export function approxTokens(text) {
  return Math.round(String(text || '').length / APPROX_CHARS_PER_TOKEN);
}

export function tabsFor(models) {
  const any = (fn) => models.some(fn);
  const answers = any(m => m.kind !== 'router');
  const shown = ['general'];
  const optional = [];
  if (answers) shown.push('prompts', 'tools');
  if (answers) optional.push('reasoning', 'controls');
  if (answers && any(reasons)) shown.push('reasoning');
  if (answers) shown.push('context', 'sampling');
  if (answers && any(m => (Array.isArray(m.kwargs) && m.kwargs.length) || m.effort_enabled)) shown.push('controls');
  shown.push('appearance');
  if (any(m => m.kind === 'router')) shown.push('routing');
  return { shown, optional };
}

export function revertPatch(live, key) {
  if (key === 'folder') return { in_more_models: live.in_more_models ?? 0, more_models_label: live.more_models_label ?? '' };
  if (FLAGS.has(key)) return { [key]: flagOn(live, key) ? 1 : 0 };
  const v = live[key];
  return { [key]: v === undefined ? null : v };
}

export function publishedOrder(models, liveOrder) {
  const rank = new Map((liveOrder || []).map((id, i) => [id, i]));
  return models
    .map((m, i) => [m, rank.has(m.id) ? rank.get(m.id) : Infinity, i])
    .sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]))
    .map(([m]) => m);
}

export const TAB_FIELDS = {
  __proto__: null,
  general: ['display_name', 'internal_name', 'provider_id', 'description', 'kind', 'enabled', 'is_default',
    'unavailable', 'unavailable_reason', 'sunset_at', 'sunset_action', 'cost_in', 'cost_out'],
  prompts: ['system_prompt', 'call_prompt'],
  tools: ['has_vision', 'code_allowed', 'sandbox_allowed', 'sandbox_auto', 'web_search_allowed', 'web_search_auto', 'skills_allowed',
    'mcp_allowed', 'chat_search_allowed', 'end_chat_allowed', 'memory_allowed', 'calculator_allowed', 'todo_allowed', 'ask_user_allowed', 'consult_allowed',
    'consult_models', 'consult_images', 'agent_steps', 'hide_tool_calls'],
  reasoning: ['reasoning_collapsible', 'hide_thinking', 'think_open', 'think_close', 'has_reasoning', 'reasoning_token', 'non_reasoning_token'],
  context: ['num_ctx', 'recent_window', 'long_convo_reminder', 'parallel_requests'],
  sampling: ['stop', 'temperature', 'top_p', 'top_k', 'min_p', 'max_tokens', 'seed', 'repetition_penalty', 'presence_penalty',
    'frequency_penalty', 'dry_multiplier', 'dry_base', 'dry_allowed_length', 'dry_penalty_last_n', 'xtc_probability',
    'xtc_threshold', 'mirostat', 'mirostat_tau', 'mirostat_eta'],
  controls: ['kwargs', 'effort_enabled'],
  appearance: ['static_icon', 'generating_icon', 'thinking_icon', 'generating_anim', 'thinking_anim', 'icon_size', 'icon_position',
    'dropdown_icon', 'show_icon', 'show_name', 'badges_off', 'bg_enabled', 'bg_image'],
  routing: ['router_rules', 'router_default']
};

export function tabChanges(models, live) {
  const out = {};
  for (const [tab, keys] of Object.entries(TAB_FIELDS)) {
    out[tab] = keys.filter(k => models.some(m => live?.[m.id] && norm(live[m.id], k) !== norm(m, k))).length;
  }
  return out;
}

export function folderChanged(models, live) {
  return models.some(m => live?.[m.id]
    && ['in_more_models', 'more_models_label'].some(k => norm(live[m.id], k) !== norm(m, k)));
}

export function orderChanged(models, liveOrder) {
  const known = new Set(liveOrder || []);
  const now = models.map(m => m.id).filter(id => known.has(id));
  const was = (liveOrder || []).filter(id => now.includes(id));
  return now.some((id, i) => id !== was[i]);
}

export const LEVELS = {
  __proto__: null,
  sandbox: {
    keys: ['sandbox_allowed', 'sandbox_auto'],
    read: (m) => (!flagOn(m, 'sandbox_allowed') ? 'off' : flagOn(m, 'sandbox_auto') ? 'auto' : 'on'),
    patch: {
      off: { sandbox_allowed: 0, sandbox_auto: 0 },
      on: { sandbox_allowed: 1, sandbox_auto: 0 },
      auto: { sandbox_allowed: 1, sandbox_auto: 1 }
    }
  },
  web: {
    keys: ['web_search_allowed', 'web_search_auto'],
    read: (m) => (!flagOn(m, 'web_search_allowed') ? 'off' : flagOn(m, 'web_search_auto') ? 'auto' : 'on'),
    patch: {
      off: { web_search_allowed: 0, web_search_auto: 0 },
      on: { web_search_allowed: 1, web_search_auto: 0 },
      auto: { web_search_allowed: 1, web_search_auto: 1 }
    }
  },
  thoughts: {
    keys: ['reasoning_collapsible', 'hide_thinking'],
    read: (m) => (flagOn(m, 'reasoning_collapsible') ? 'shown' : flagOn(m, 'hide_thinking') ? 'hidden' : 'status'),
    patch: {
      shown: { reasoning_collapsible: 1, hide_thinking: 0 },
      status: { reasoning_collapsible: 0, hide_thinking: 0 },
      hidden: { reasoning_collapsible: 0, hide_thinking: 1 }
    }
  }
};


export function usesTools(m, { webSearch = false, chatSearch = false } = {}) {
  return flagOn(m, 'sandbox_allowed') || (webSearch && flagOn(m, 'web_search_allowed'))
    || flagOn(m, 'skills_allowed') || flagOn(m, 'mcp_allowed') || (chatSearch && flagOn(m, 'chat_search_allowed'))
    || flagOn(m, 'end_chat_allowed') || flagOn(m, 'memory_allowed') || flagOn(m, 'calculator_allowed') || flagOn(m, 'todo_allowed')
    || flagOn(m, 'ask_user_allowed') || flagOn(m, 'consult_allowed');
}