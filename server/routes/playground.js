import { db, getSetting, setSetting } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { buildMessages, streamCompletion, modelProvider, samplingParams } from '../llm/index.js';
import { applyKwargs } from '../lib/kwargs.js';
import { resolveModel } from '../lib/models.js';
import { resolveProvider } from '../lib/providers.js';
import { isRouter, resolveRouted } from '../lib/router.js';
import { systemPrompt } from '../lib/systemprompt.js';
import { recordUsage } from '../lib/budget.js';
import { sourceOf, playgroundHistory, sanitizeSuites } from '../lib/playground.js';
import { playgroundState, playgroundTools, runPlaygroundTool, parseCall, PREVIEW_CHARS } from '../lib/playgroundtools.js';
import { imageMessage } from '../lib/mcp.js';

const MAX_STEPS = 8;

const SUITES_KEY = 'playground_suites';

function lookupFor(source) {
  return source === 'live' ? (id) => resolveModel(id, false) : (id) => db.models.byId(id);
}

function requestSummary(model, messages, source, routed, tools = []) {
  const { spec } = modelProvider(model);
  const prov = resolveProvider(model.provider_id);
  return {
    source,
    model: model.internal_name || '',
    provider: prov ? (prov.name || prov.type || '') : '',
    protocol: spec.protocol,
    routed: routed ? { via: routed.via, model: routed.modelName } : null,
    params: samplingParams(model, spec),
    kwargs: model.resolved_kwargs || {},
    tools: tools.map(t => t.function?.name).filter(Boolean),
    messages
  };
}

function addUsage(sum, u) {
  return {
    prompt: sum.prompt + (u.prompt || 0), completion: sum.completion + (u.completion || 0), total: sum.total + (u.total || ((u.prompt || 0) + (u.completion || 0))),
    cacheRead: sum.cacheRead + (u.cacheRead || 0), cacheWrite: sum.cacheWrite + (u.cacheWrite || 0)
  };
}

export default function registerPlaygroundRoutes(app) {
  app.post('/api/admin/playground/stream', authMiddleware, adminOnly, async (req, res) => {
    const body = req.body || {};
    const source = sourceOf(body.source);
    const lookup = lookupFor(source);
    const hub = lookup(String(body.modelId || ''));
    if (!hub) return res.status(404).json({ error: source === 'live' ? 'This model has not been released yet.' : 'Model not found.' });
    const history = playgroundHistory(body.messages);
    if (!history.length) return res.status(400).json({ error: 'Nothing to send.' });

    let target = hub;
    let routed = null;
    if (isRouter(hub)) {
      const probe = [...history].reverse().find(m => m.role === 'user');
      const r = resolveRouted(hub, probe ? [probe] : [], [], lookup);
      if (!r.model) return res.status(422).json({ error: r.routed?.error || 'This router could not pick a model.' });
      target = r.model;
      routed = r.routed;
    }

    const model = applyKwargs(target, body.kwargValues, true);
    const state = body.tools ? playgroundState(model, req.user.id) : {};
    const tools = body.tools ? playgroundTools(state) : [];
    const system = systemPrompt(null, model, state, { userId: req.user.id }).text;
    const convo = buildMessages(model, history, !!body.extended, system);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const send = (obj) => { if (!res.writableEnded) res.write('data: ' + JSON.stringify(obj) + '\n\n'); };
    send({ type: 'start', request: requestSummary(model, convo, source, routed, tools) });

    const controller = new AbortController();
    let finished = false;
    const total = { prompt: 0, completion: 0, total: 0, cacheRead: 0, cacheWrite: 0 };
    res.on('close', () => { if (!finished) controller.abort(); });
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        let calls = null;
        let blocks = null;
        let text = '';
        let stepUsage = null;
        await streamCompletion({
          model, messages: convo, tools, signal: controller.signal,
          onEvent: (e) => {
            if (e.type === 'content') { text += e.text; send({ type: 'content', text: e.text }); }
            else if (e.type === 'reasoning') send({ type: 'reasoning', text: e.text });
            else if (e.type === 'usage') { stepUsage = e.usage; send({ type: 'usage', usage: addUsage(total, e.usage) }); }
            else if (e.type === 'finish') send({ type: 'finish', reason: e.reason });
            else if (e.type === 'prompt_progress') send({ type: 'progress', processed: Number(e.progress?.processed) || 0, total: Number(e.progress?.total) || 0 });
            else if (e.type === 'tool_calls') { calls = e.calls; blocks = e.blocks || null; }
          }
        });
        if (stepUsage) Object.assign(total, addUsage(total, stepUsage));
        if (!calls?.length || !tools.length) break;
        const results = [];
        const found = [];
        for (const c of calls) {
          const call = parseCall(c);
          const r = await runPlaygroundTool(call, { model, state, userId: req.user.id, signal: controller.signal });
          if (controller.signal.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
          const { tool, ...args } = call;
          send({ type: 'tool', tool: { name: tool, args, ok: r.ok, result: String(r.formatted || '').slice(0, PREVIEW_CHARS), images: (r.images || []).length } });
          results.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: r.formatted });
          for (const img of r.images || []) found.push({ ...img, tool });
        }
        convo.push({ role: 'assistant', content: text, tool_calls: calls, ...(blocks?.length ? { blocks } : {}) }, ...results);
        const shown = imageMessage(found, !!model.has_vision);
        if (shown) convo.push(shown);
        send({ type: 'content', text: '\n\n' });
      }
      send({ type: 'done' });
    } catch (err) {
      if (!controller.signal.aborted) send({ type: 'error', error: String((err && err.message) || err).slice(0, 500) });
    }
    finished = true;
    recordUsage(req.user.id, model, total.prompt || total.completion ? total : null);
    if (!res.writableEnded) res.end();
  });

  app.get('/api/admin/playground/suites', authMiddleware, adminOnly, (req, res) => {
    res.json({ suites: sanitizeSuites(getSetting(SUITES_KEY, [])) });
  });

  app.put('/api/admin/playground/suites', authMiddleware, adminOnly, (req, res) => {
    const suites = sanitizeSuites(req.body?.suites);
    setSetting(SUITES_KEY, suites);
    res.json({ suites });
  });
}
