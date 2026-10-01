export const ASK_MIN_OPTIONS = 2;
export const ASK_MAX_OPTIONS = 6;
const QUESTION_MAX = 500;
const OPTION_MAX = 120;

function optionList(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try { const v = JSON.parse(raw); if (Array.isArray(v)) return v; } catch {}
  return raw.split(/\n|\|/);
}

export function runAskUser(call) {
  const question = String(call.question ?? '').replace(/\s+/g, ' ').trim().slice(0, QUESTION_MAX);
  const seen = new Set();
  const options = [];
  for (const o of optionList(call.options)) {
    const text = String((o && typeof o === 'object' ? o.label ?? o.text : o) ?? '').replace(/\s+/g, ' ').trim().slice(0, OPTION_MAX);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    options.push(text);
  }
  if (!question) return { ok: false, error: 'question is required.' };
  if (options.length < ASK_MIN_OPTIONS || options.length > ASK_MAX_OPTIONS) {
    return { ok: false, error: `Give between ${ASK_MIN_OPTIONS} and ${ASK_MAX_OPTIONS} distinct options.` };
  }
  return { ok: true, question, options, multiple: call.multiple === true || call.multiple === 'true' };
}

export function formatAskUser(r) {
  if (!r.ok) return `ask_user → ERROR: ${r.error}`;
  const asked = `ask_user "${r.question}"`;
  if (r.stopped) return `${asked} → the user stopped the reply instead of answering.`;
  if (r.skipped) return `${asked} → the user skipped the question. Continue with your best judgement and say what you assumed.`;
  if (r.timedOut) return `${asked} → no answer came. Continue with your best judgement and say what you assumed.`;
  return `${asked} → the user answered: ${r.answer}`;
}