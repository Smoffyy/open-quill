import { recordUsage } from './budget.js';
import { oneShotFull, stripThink } from '../llm/index.js';
import { resolveModel } from './models.js';
import { readImageDataUri, imageKind } from './uploads.js';
import { activePath } from './tree.js';
import { promptVars } from './convo.js';
import { renderPrompt } from './promptblocks.js';

export const CONSULT_MAX_TARGETS = 50;
const QUESTION_MAX = 40000;
const ANSWER_MAX = 40000;

export function sanitizeConsultModels(raw) {
  const out = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    if (typeof id !== 'string' || !id.trim() || out.includes(id)) continue;
    out.push(id.slice(0, 64));
    if (out.length >= CONSULT_MAX_TARGETS) break;
  }
  return out;
}

export function consultTargets(model, isAdmin) {
  const ids = Array.isArray(model?.consult_models) ? model.consult_models : [];
  return ids
    .map(id => resolveModel(id, isAdmin))
    .filter(t => t && t.id !== model.id && t.enabled && t.kind !== 'router' && (isAdmin || !t.unavailable));
}

export function consultTargetsText(model, targets) {
  const images = !!model?.consult_images;
  return targets.map(t => {
    const name = t.display_name || t.internal_name;
    const bits = [`- ${name}`];
    if (images && t.has_vision) bits.push(' (can see images)');
    if (t.description) bits.push(`: ${String(t.description).replace(/\s+/g, ' ').slice(0, 200)}`);
    return bits.join('');
  }).join('\n');
}

function pickTarget(targets, wanted) {
  const w = String(wanted ?? '').trim().toLowerCase();
  if (!w) return targets.length === 1 ? targets[0] : null;
  return targets.find(t => t.id === wanted)
    || targets.find(t => (t.display_name || '').toLowerCase() === w)
    || targets.find(t => (t.internal_name || '').toLowerCase() === w)
    || null;
}

function latestImages(chatId) {
  const path = chatId ? activePath(chatId) : [];
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].role !== 'user') continue;
    return (path[i].attachments || [])
      .filter(a => imageKind(a) === 'vision')
      .map(a => readImageDataUri(a))
      .filter(Boolean);
  }
  return [];
}

const wantsImages = (v) => v === true || v === 'true';

export async function runConsult({ model, targets, call, chatId, userId, signal }) {
  const names = targets.map(t => t.display_name || t.internal_name).join(', ');
  const target = pickTarget(targets, call.model);
  if (!target) return { ok: false, model: String(call.model || ''), error: `Unknown model "${call.model || ''}". You can consult: ${names}.` };
  const label = target.display_name || target.internal_name;
  const question = String(call.question ?? '').trim().slice(0, QUESTION_MAX);
  if (!question) return { ok: false, model: label, error: 'question is required.' };
  const images = model.consult_images && target.has_vision && wantsImages(call.include_images) ? latestImages(chatId) : [];
  const system = renderPrompt(target.system_prompt || '', { vars: promptVars(userId) }).text;
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push(images.length
    ? { role: 'user', content: [{ type: 'text', text: question }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] }
    : { role: 'user', content: question });
  const r = await oneShotFull(target, messages, { signal });
  recordUsage(userId, target, r.usage, label);
  const answer = stripThink(target, r.text || '').trim().slice(0, ANSWER_MAX);
  if (!answer) return { ok: false, model: label, error: `${label} returned no answer.` };
  return { ok: true, model: label, answer, images: images.length };
}

export function formatConsult(r) {
  if (!r.ok) return `consult_model ${r.model} → ERROR: ${r.error}`;
  return `consult_model ${r.model}${r.images ? ` (with ${r.images} image(s))` : ''} →\n${r.answer}`;
}
