import { db, uid, now, getSetting } from '../../db.js';
import { authMiddleware } from '../../auth.js';
import { buildMessages } from '../../llm/index.js';
import * as sandbox from '../../sandbox.js';
import * as membank from '../../membank.js';
import * as websearch from '../../websearch.js';
import { purgeUploads } from '../../lib/uploads.js';
import { stripToolSyntax } from '../../lib/history.js';
import { sortedMsgs, ensureChain, childrenOf, activePath, leafUnder } from '../../lib/tree.js';
import { modelCtx } from '../../lib/models.js';
import { chatHistory, estimateTokens, calibratedTokens, tokenCalib, compactThreshold, rollingCtxFor, promptVars, instrFor } from '../../lib/convo.js';

export default function registerInspectRoutes(app) {
  app.get('/api/chats/:id/context', authMiddleware, async (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const model = db.models.byId(req.query.modelId) || db.models.all().find(m => m.enabled) || db.models.all()[0];
    if (!model) return res.json({ used: 0, limit: 0, pct: 0, hasSummary: !!c.summary, summaries: !!c.enable_summaries });
    const convo = buildMessages(model, await chatHistory(c, model), false, null, c.summary, promptVars(c.user_id), await instrFor(c));
    const used = calibratedTokens(c.id, convo);
    const ctx = await modelCtx(model);
    const limit = ctx || parseInt(model.num_ctx) || 0;
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const rolling = !!limit && (await rollingCtxFor(model)) > 0;
    res.json({ used, limit, pct, hasSummary: !!c.summary, measured: tokenCalib.has(c.id), compacts: model.enable_summaries ? compactThreshold(model, ctx) : 0, rolling });
  });

  app.get('/api/chats/:id/inspect', authMiddleware, async (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const model = db.models.byId(req.query.modelId) || db.models.all().find(m => m.enabled) || db.models.all()[0];
    if (!model) return res.json({ segments: [], totalTokens: 0 });
    const membankOn = getSetting('membank_enabled', '0') === '1' && membank.list().length > 0;
    const memP = membankOn ? membank.promptFor(getSetting('membank_prompt', '')) : '';
    const convo = buildMessages(model, await chatHistory(c, model), false, memP || null, c.summary, promptVars(c.user_id), await instrFor(c));
    const segments = convo.map((m, i) => {
      const txt = typeof m.content === 'string' ? m.content : (m.content || []).map(p => p.type === 'text' ? p.text : '[image]').join('\n');
      return { index: i, role: m.role, tokens: estimateTokens([m]), chars: txt.length, preview: txt.slice(0, 600), hasImages: Array.isArray(m.content) && m.content.some(p => p.type === 'image_url') };
    });
    const limit = (model.enable_summaries && model.num_ctx) ? model.num_ctx : (model.num_ctx || 0);
    const total = estimateTokens(convo);
    res.json({
      segments, totalTokens: total, limit, pct: limit ? Math.min(100, Math.round((total / limit) * 100)) : 0,
      flags: { memoryBank: membankOn, webSearch: websearch.webSearchAvailable(), summary: !!c.summary }
    });
  });

  app.get('/api/chats/:id/summary', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    res.json({ summary: c.summary || '', summaryUpto: c.summary_upto || 0 });
  });
  app.patch('/api/chats/:id/summary', authMiddleware, (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const patch = {};
    if ('summary' in req.body) patch.summary = String(req.body.summary || '');
    if ('clear' in req.body && req.body.clear) { patch.summary = ''; patch.summary_upto = 0; }
    db.chats.update(c.id, patch);
    res.json({ ok: true });
  });
}
