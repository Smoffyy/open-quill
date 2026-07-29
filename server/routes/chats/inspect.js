import { db, getSetting } from '../../db.js';
import { contextBudget, slideToFit, countExact } from '../../lib/ctxwindow.js';
import { authMiddleware } from '../../auth.js';
import { buildMessages } from '../../llm/index.js';
import * as membank from '../../membank.js';
import * as websearch from '../../websearch.js';
import { modelCtx } from '../../lib/models.js';
import {
  chatHistory, historyRows, estimateTokens, calibratedTokens, calibRatio, messageTokens,
  tokenCalib, compactThreshold, rollingCtxFor, promptVars, instrFor
} from '../../lib/convo.js';

function pickModel(modelId) {
  const chosen = modelId ? db.models.byId(modelId) : null;
  if (chosen) return chosen;
  const all = db.models.all();
  return all.find(m => m.enabled) || all[0] || null;
}

export default function registerInspectRoutes(app) {
  app.get('/api/chats/:id/context', authMiddleware, async (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const model = pickModel(req.query.modelId);
    if (!model) return res.json({ used: 0, limit: 0, pct: 0, hasSummary: !!c.summary, summaries: !!c.enable_summaries });
    const convo = buildMessages(model, await chatHistory(c, model), false, null, c.summary, promptVars(c.user_id), await instrFor(c));
    const used = calibratedTokens(c.id, convo);
    const ctx = await modelCtx(model);
    const limit = ctx || parseInt(model.num_ctx) || 0;
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const rolling = !!limit && (await rollingCtxFor(model)) > 0;
    res.json({ used, limit, pct, hasSummary: !!c.summary, measured: tokenCalib.has(c.id), compacts: model.enable_summaries ? compactThreshold(model, ctx) : 0, rolling });
  });

  app.get('/api/chats/:id/ledger', authMiddleware, async (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const model = pickModel(req.query.modelId);
    if (!model) return res.json({ limit: 0, used: 0, overhead: 0, messages: [] });
    const rows = await historyRows(c, model);
    const active = rows.filter(r => !r.summarized && !r.excluded);
    const convo = buildMessages(model, active.map(r => r.msg), false, null, c.summary, promptVars(c.user_id), await instrFor(c));
    const ratio = calibRatio(c.id);
    const exact = await countExact(model, convo);
    const used = exact || calibratedTokens(c.id, convo);
    const scaffold = buildMessages(model, [], false, null, c.summary, promptVars(c.user_id), await instrFor(c));
    const exactHead = exact ? await countExact(model, scaffold) : 0;
    const overheadTokens = exactHead || Math.round(calibratedTokens(c.id, scaffold) * (exact ? 1 : ratio));
    const raw = rows.map(r => messageTokens(r.msg));
    const activeRaw = rows.reduce((n, r, i) => n + (!r.summarized && !r.excluded ? raw[i] : 0), 0);
    const body = Math.max(0, used - overheadTokens);
    const scale = exact && activeRaw > 0 ? body / activeRaw : ratio;
    const messages = rows.map((r, i) => ({
      id: r.id,
      role: r.role,
      tokens: Math.max(1, Math.round(raw[i] * scale)),
      pinned: r.pinned,
      excluded: r.excluded,
      summarized: r.summarized
    }));
    const ctx = await modelCtx(model);
    const bud = await contextBudget(model);
    let sent = used;
    let dropped = 0;
    let trimmed = false;
    if (exact && bud.budget > 0 && used > bud.budget) {
      const fit = await slideToFit(model, convo, bud.budget);
      if (fit.tokens) { sent = fit.tokens; dropped = fit.dropped; trimmed = fit.trimmed; }
    }
    const limit = bud.budget || ctx || parseInt(model.num_ctx) || 0;
    res.json({
      limit, used: sent, total: used, reserve: bud.reserve, ctx: bud.ctx || ctx,
      overhead: overheadTokens, messages,
      dropped, trimmed, windowed: dropped > 0 || trimmed,
      measured: !!exact || tokenCalib.has(c.id), exact: !!exact, hasSummary: !!c.summary,
      compacts: model.enable_summaries ? compactThreshold(model, ctx) : 0
    });
  });

  app.get('/api/chats/:id/inspect', authMiddleware, async (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const model = pickModel(req.query.modelId);
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
