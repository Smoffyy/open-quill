import { db } from '../db.js';
import { buildMessages, streamCompletion } from '../llm/index.js';
import { applyKwargs } from './kwargs.js';
import { resolveModel } from './models.js';
import { isRouter, resolveRouted } from './router.js';
import { systemPrompt } from './systemprompt.js';
import { playgroundState, playgroundTools, runPlaygroundTool, parseCall, PREVIEW_CHARS } from './playgroundtools.js';
import { imageMessage } from './mcp.js';

export const MAX_STEPS = 8;

export function lookupFor(source) {
  return source === 'live' ? (id) => resolveModel(id, false) : (id) => db.models.byId(id);
}

export function addUsage(sum, u) {
  return {
    prompt: sum.prompt + (u.prompt || 0), completion: sum.completion + (u.completion || 0), total: sum.total + (u.total || ((u.prompt || 0) + (u.completion || 0))),
    cacheRead: sum.cacheRead + (u.cacheRead || 0), cacheWrite: sum.cacheWrite + (u.cacheWrite || 0)
  };
}

export function resolveRun(source, modelId, history) {
  const lookup = lookupFor(source);
  const hub = lookup(String(modelId || ''));
  if (!hub) return { status: 404, error: source === 'live' ? 'This model has not been released yet.' : 'Model not found.' };
  if (!isRouter(hub)) return { model: hub, routed: null };
  const probe = [...history].reverse().find(m => m.role === 'user');
  const r = resolveRouted(hub, probe ? [probe] : [], [], lookup);
  if (!r.model) return { status: 422, error: r.routed?.error || 'This router could not pick a model.' };
  return { model: r.model, routed: r.routed };
}

export function prepareRun(target, { history, extended = false, tools: useTools = false, kwargValues = {}, userId = null, systemOverride = '' }) {
  const model = applyKwargs(target, kwargValues, true);
  const state = useTools ? playgroundState(model, userId) : {};
  const tools = useTools ? playgroundTools(state) : [];
  const system = systemOverride.trim() ? systemOverride : systemPrompt(null, model, state, { userId }).text;
  return { model, state, tools, convo: buildMessages(model, history, !!extended, system) };
}

export async function runPrepared({ model, state, tools, convo }, { userId = null, signal = null, onEvent = () => {} } = {}) {
  const total = { prompt: 0, completion: 0, total: 0, cacheRead: 0, cacheWrite: 0 };
  const started = Date.now();
  const calls = [];
  let firstToken = 0;
  let reply = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    let pending = null;
    let blocks = null;
    let text = '';
    let stepUsage = null;
    await streamCompletion({
      model, messages: convo, tools, signal,
      onEvent: (e) => {
        if (e.type === 'content') {
          if (!firstToken) firstToken = Date.now() - started;
          text += e.text;
        } else if (e.type === 'usage') stepUsage = e.usage;
        else if (e.type === 'tool_calls') { pending = e.calls; blocks = e.blocks || null; }
        if (e.type === 'usage') onEvent({ type: 'usage', usage: addUsage(total, e.usage) });
        else onEvent(e);
      }
    });
    reply += text;
    if (stepUsage) Object.assign(total, addUsage(total, stepUsage));
    if (!pending?.length || !tools.length) break;
    const results = [];
    const found = [];
    for (const c of pending) {
      const call = parseCall(c);
      const r = await runPlaygroundTool(call, { model, state, userId, signal });
      if (signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
      const { tool, ...args } = call;
      const summary = { name: tool, args, ok: r.ok, result: String(r.formatted || '').slice(0, PREVIEW_CHARS), images: (r.images || []).length };
      calls.push(summary);
      onEvent({ type: 'tool', tool: summary });
      results.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: r.formatted });
      for (const img of r.images || []) found.push({ ...img, tool });
    }
    convo.push({ role: 'assistant', content: text, tool_calls: pending, ...(blocks?.length ? { blocks } : {}) }, ...results);
    const shown = imageMessage(found, !!model.has_vision);
    if (shown) convo.push(shown);
    reply += '\n\n';
    onEvent({ type: 'content', text: '\n\n' });
  }
  return { text: reply.trim(), usage: total, ms: Date.now() - started, firstTokenMs: firstToken, tools: calls };
}