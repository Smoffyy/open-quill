import { db } from '../../db.js';
import { contextBudget, canCount, countExact, countText } from '../../lib/ctxwindow.js';
import { authMiddleware } from '../../auth.js';
import { buildMessages } from '../../llm/index.js';
import { toolState, systemPrompt, toolsFor } from '../../lib/systemprompt.js';
import { chatHistory, historyRows } from '../../lib/convo.js';
import { activePath } from '../../lib/tree.js';

const PART_LABEL = { base: () => 'Model system prompt', tool: (p) => `Tool: ${p.name}`, section: (p) => `Context: ${p.name}` };

function promptOf(c, model) {
  const flags = toolState(c, model, { sandboxOn: !!c.sandbox || !!c.project_id, canAsk: true });
  return { flags, ...systemPrompt(c, model, flags) };
}

function pickModel(modelId) {
  const chosen = modelId ? db.models.byId(modelId) : null;
  if (chosen) return chosen;
  const all = db.models.all();
  return all.find(m => m.enabled) || all[0] || null;
}

function textOf(m) {
  return typeof m.content === 'string' ? m.content : (m.content || []).map(p => p.type === 'text' ? p.text : '[image]').join('\n');
}

export default function registerInspectRoutes(app) {
  app.get('/api/chats/:id/context', authMiddleware, async (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const model = pickModel(req.query.modelId);
    const path = activePath(c.id);
    const upto = c.summary && c.summary_upto ? c.summary_upto : 0;
    const summarized = upto ? path.filter(m => m.created_at <= upto && !m.pinned).length : 0;
    if (!model) return res.json({ used: 0, limit: 0, budget: 0, summarized, pending: false });
    const { ctx, budget, reserve } = await contextBudget(model);
    if (canCount(model)) {
      const prompt = promptOf(c, model);
      const used = await countExact(model, buildMessages(model, chatHistory(c, model), false, prompt.text), toolsFor(prompt.flags));
      return res.json({ used, limit: ctx, budget, reserve, summarized, pending: !used });
    }
    let last = null;
    for (let i = path.length - 1; i >= 0 && !last; i--) if (path[i].role === 'assistant') last = path[i];
    const used = last && last.model_id === model.id && last.ctx_used > 0 ? last.ctx_used : 0;
    res.json({ used, limit: ctx, budget, reserve, summarized, pending: !used && path.length > 0 });
  });

  app.get('/api/chats/:id/prompt', authMiddleware, async (req, res) => {
    const c = db.chats.byId(req.params.id);
    if (!c || c.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const model = pickModel(req.query.modelId);
    if (!model) return res.json({ sections: [], messages: [], total: null });
    const exact = canCount(model);
    const count = async (text) => (exact ? (await countText(model, text)) || null : null);
    const prompt = promptOf(c, model);
    const convo = buildMessages(model, chatHistory(c, model), false, prompt.text);
    const sys = convo.find(m => m.role === 'system');
    const sysText = sys ? String(sys.content || '') : '';
    const sections = await Promise.all(prompt.parts.map(async p => ({
      name: PART_LABEL[p.kind](p), chars: p.text.length, tokens: await count(p.text), text: p.text
    })));
    const messages = await Promise.all(convo.filter(m => m.role !== 'system').map(async (m, i) => {
      const txt = textOf(m);
      return { index: i, role: m.role, tokens: await count(txt), chars: txt.length, text: txt };
    }));
    const total = exact ? (await countExact(model, convo, toolsFor(prompt.flags))) || null : null;
    res.json({
      modelId: model.id, modelName: model.display_name || model.internal_name,
      system: { text: sysText, tokens: await count(sysText), chars: sysText.length },
      sections, messages, dropped: historyRows(c, model).filter(r => r.summarized).length,
      total, raw: convo,
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
    if ('clear' in req.body && req.body.clear) { patch.summary = ''; patch.summary_upto = 0; patch.summary_images = []; }
    db.chats.update(c.id, patch);
    res.json({ ok: true });
  });
}