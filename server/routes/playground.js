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

const SUITES_KEY = 'playground_suites';

function lookupFor(source) {
  return source === 'live' ? (id) => resolveModel(id, false) : (id) => db.models.byId(id);
}

function requestSummary(model, messages, source, routed) {
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
    messages
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
    const system = systemPrompt(null, model, {}, { userId: req.user.id }).text;
    const messages = buildMessages(model, history, !!body.extended, system);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const send = (obj) => { if (!res.writableEnded) res.write('data: ' + JSON.stringify(obj) + '\n\n'); };
    send({ type: 'start', request: requestSummary(model, messages, source, routed) });

    const controller = new AbortController();
    let finished = false;
    let usage = null;
    res.on('close', () => { if (!finished) controller.abort(); });
    try {
      await streamCompletion({
        model, messages, tools: [], signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'content') send({ type: 'content', text: e.text });
          else if (e.type === 'reasoning') send({ type: 'reasoning', text: e.text });
          else if (e.type === 'usage') { usage = e.usage; send({ type: 'usage', usage: e.usage }); }
          else if (e.type === 'finish') send({ type: 'finish', reason: e.reason });
          else if (e.type === 'prompt_progress') send({ type: 'progress', processed: Number(e.progress?.processed) || 0, total: Number(e.progress?.total) || 0 });
        }
      });
      send({ type: 'done' });
    } catch (err) {
      if (!controller.signal.aborted) send({ type: 'error', error: String((err && err.message) || err).slice(0, 500) });
    }
    finished = true;
    recordUsage(req.user.id, model, usage);
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
