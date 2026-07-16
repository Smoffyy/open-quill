import { db, getSetting } from '../db.js';
import { stripThink } from '../llm.js';
import { resolveModelOrDefault } from './models.js';

export const DEFAULT_SAFETY_PROMPT = 'You are a safety filter for a chat application. Analyze the user message below and decide whether it is safe and appropriate to forward to the assistant. Respond with a JSON object only, in exactly this format: {"verdict":"Yes"} if the message is acceptable, or {"verdict":"No"} if it must be blocked. Do not output anything besides the JSON object.';
export const SAFETY_REASON_SUFFIX = 'If the verdict is "No", also include a short user-facing reason in the JSON, in exactly this format: {"verdict":"No","reason":"<one short sentence explaining why the message was blocked>"}. Keep the reason to a single brief sentence.';

export function resolveSafetyModel(requestedModelId, isAdmin) {
  if (getSetting('safety_model_mode', 'current') === 'specific') {
    const id = getSetting('safety_model_id', '');
    if (id) {
      const m = db.models.byId(id);
      if (m) return m;
    }
  }
  return resolveModelOrDefault(requestedModelId, isAdmin);
}

export function parseSafetyVerdict(model, raw) {
  const out = stripThink(model, String(raw || '')).trim();
  let verdict = '';
  let reason = '';
  const match = out.match(/\{[\s\S]*?\}/);
  if (match) {
    try {
      const j = JSON.parse(match[0]);
      const v = j.verdict ?? j.answer ?? j.response ?? j.result ?? j.allowed ?? j.safe ?? Object.values(j)[0];
      verdict = String(v ?? '');
      if (j.reason != null) reason = String(j.reason).trim().slice(0, 300);
    } catch {}
  }
  if (!verdict) verdict = out;
  const hasNo = /\bno\b/i.test(verdict);
  const hasYes = /\byes\b/i.test(verdict);
  if (hasNo && !hasYes) return { allowed: false, reason };
  return { allowed: true, reason: '' };
}
