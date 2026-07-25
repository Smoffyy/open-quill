import { db } from '../db.js';
import { authMiddleware, adminOnly } from '../auth.js';
import { streamCompletion } from '../llm/index.js';
import { applyKwargs, sanitizeKwargs } from '../lib/kwargs.js';

const NUM_FIELDS = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'min_p'];
const INT_FIELDS = ['top_k', 'seed', 'max_tokens', 'num_ctx'];
const FLAG_FIELDS = ['has_reasoning', 'hide_thinking'];
const TEXT_FIELDS = ['system_prompt', 'internal_name', 'reasoning_token', 'non_reasoning_token', 'think_open', 'think_close'];

export function playgroundOverrides(body) {
  const src = (body && typeof body === 'object') ? body : {};
  const out = {};
  for (const k of NUM_FIELDS) {
    if (!(k in src)) continue;
    const v = src[k];
    out[k] = (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
  }
  for (const k of INT_FIELDS) {
    if (!(k in src)) continue;
    const v = parseInt(src[k], 10);
    out[k] = Number.isFinite(v) ? v : null;
  }
  for (const k of FLAG_FIELDS) if (k in src) out[k] = src[k] ? 1 : 0;
  for (const k of TEXT_FIELDS) if (k in src) out[k] = String(src[k] ?? '').slice(0, 20000);
  if ('provider_id' in src) out.provider_id = src.provider_id || null;
  if ('kwargs' in src) out.kwargs = sanitizeKwargs(src.kwargs);
  return out;
}

function playgroundMessages(model, history, extended) {
  const msgs = [];
  const sys = String(model.system_prompt || '').trim();
  const token = extended
    ? String(model.reasoning_token || '').trim()
    : String(model.non_reasoning_token || '').trim();
  const head = [sys, model.has_reasoning && token ? token : ''].filter(Boolean).join('\n\n');
  if (head) msgs.push({ role: 'system', content: head });
  for (const m of history) {
    const role = m && m.role === 'assistant' ? 'assistant' : (m && m.role === 'system' ? 'system' : 'user');
    const content = String((m && m.content) ?? '');
    if (!content.trim() && role !== 'assistant') continue;
    msgs.push({ role, content });
  }
  return msgs;
}

export default function registerPlaygroundRoutes(app) {
  app.post('/api/admin/playground/stream', authMiddleware, adminOnly, async (req, res) => {
    const body = req.body || {};
    const row = db.models.byId(String(body.modelId || ''));
    if (!row) return res.status(404).json({ error: 'Model not found.' });
    const history = Array.isArray(body.messages) ? body.messages.slice(-200) : [];
    if (!history.length) return res.status(400).json({ error: 'Nothing to send.' });

    const merged = { ...row, ...playgroundOverrides(body.overrides) };
    const model = applyKwargs(merged, body.kwargValues, true);
    const messages = playgroundMessages(model, history, !!body.extended);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const send = (obj) => { if (!res.writableEnded) res.write('data: ' + JSON.stringify(obj) + '\n\n'); };
    send({ type: 'start', request: { messages, kwargs: model.resolved_kwargs || {} } });

    const controller = new AbortController();
    let closed = false, finished = false;
    res.on('close', () => { if (!finished) { closed = true; controller.abort(); } });
    try {
      await streamCompletion({
        model, messages, tools: [], signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'content') send({ type: 'content', text: e.text });
          else if (e.type === 'reasoning') send({ type: 'reasoning', text: e.text });
          else if (e.type === 'usage') send({ type: 'usage', usage: e.usage });
        }
      });
      send({ type: 'done' });
    } catch (err) {
      if (!closed) send({ type: 'error', error: String((err && err.message) || err).slice(0, 500) });
    }
    finished = true;
    if (!res.writableEnded) res.end();
  });
}
