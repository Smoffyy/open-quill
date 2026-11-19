import { authMiddleware, adminOnly } from '../auth.js';
import { modelProvider, samplingParams } from '../llm/index.js';
import { resolveProvider } from '../lib/providers.js';
import { recordUsage } from '../lib/budget.js';
import { sourceOf, playgroundHistory, sanitizeSuites } from '../lib/playground.js';
import { resolveRun, prepareRun, runPrepared } from '../lib/playrun.js';
import { suitesView, saveSuites } from '../lib/evals.js';

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

export default function registerPlaygroundRoutes(app) {
  app.post('/api/admin/playground/stream', authMiddleware, adminOnly, async (req, res) => {
    const body = req.body || {};
    const source = sourceOf(body.source);
    const history = playgroundHistory(body.messages);
    const resolved = resolveRun(source, body.modelId, history);
    if (resolved.error && resolved.status === 404) return res.status(404).json({ error: resolved.error });
    if (!history.length) return res.status(400).json({ error: 'Nothing to send.' });
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });

    const run = prepareRun(resolved.model, { history, extended: !!body.extended, tools: !!body.tools, kwargValues: body.kwargValues, userId: req.user.id });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const send = (obj) => { if (!res.writableEnded) res.write('data: ' + JSON.stringify(obj) + '\n\n'); };
    send({ type: 'start', request: requestSummary(run.model, run.convo, source, resolved.routed, run.tools) });

    const controller = new AbortController();
    let finished = false;
    let usage = null;
    res.on('close', () => { if (!finished) controller.abort(); });
    try {
      const result = await runPrepared(run, {
        userId: req.user.id, signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'content') send({ type: 'content', text: e.text });
          else if (e.type === 'reasoning') send({ type: 'reasoning', text: e.text });
          else if (e.type === 'usage') { usage = e.usage; send({ type: 'usage', usage: e.usage }); }
          else if (e.type === 'finish') send({ type: 'finish', reason: e.reason });
          else if (e.type === 'prompt_progress') send({ type: 'progress', processed: Number(e.progress?.processed) || 0, total: Number(e.progress?.total) || 0 });
          else if (e.type === 'tool') send({ type: 'tool', tool: e.tool });
        }
      });
      usage = result.usage;
      send({ type: 'done' });
    } catch (err) {
      if (!controller.signal.aborted) send({ type: 'error', error: String((err && err.message) || err).slice(0, 500) });
    }
    finished = true;
    recordUsage(req.user.id, run.model, usage && (usage.prompt || usage.completion) ? usage : null);
    if (!res.writableEnded) res.end();
  });

  app.get('/api/admin/playground/suites', authMiddleware, adminOnly, (req, res) => {
    res.json({ suites: suitesView() });
  });

  app.put('/api/admin/playground/suites', authMiddleware, adminOnly, (req, res) => {
    res.json({ suites: saveSuites(sanitizeSuites(req.body?.suites), req.user) });
  });
}