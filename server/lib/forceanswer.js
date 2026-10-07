export const REASONING_CUT_NOTE = '[Reasoning was cut short here to fit the context window.]';

export const FORCE_ANSWER_INSTRUCTION = 'You ran out of room in the context window while thinking. Your reasoning ended with:\n\n{tail}\n\nStop reasoning now. Using what you worked out, write your final answer to my last message directly.';

export function tailChars(ctx) {
  return Math.max(400, Math.min(4000, Math.floor((ctx > 0 ? ctx : 8192) * 0.6)));
}

export function reasoningTail(text, chars) {
  const s = String(text || '').trim();
  if (s.length <= chars) return s;
  const cut = s.slice(-chars);
  const space = cut.search(/\s/);
  return '…' + (space > 0 && space < 80 ? cut.slice(space + 1) : cut);
}

export function answerNudge(tail) {
  return { role: 'user', content: FORCE_ANSWER_INSTRUCTION.replace('{tail}', tail), held: true, forced: true, tail };
}

export function forceAnswer(model, reasoning, ctx, prefill) {
  const tail = reasoningTail(reasoning, tailChars(ctx));
  if (!prefill) return answerNudge(tail);
  const open = (model?.think_open && model.think_open.trim()) || '<think>';
  const close = (model?.think_close && model.think_close.trim()) || '</think>';
  return { role: 'assistant', content: open + '\n' + tail + '\n' + close + '\n\n', prefill: true, held: true, forced: true, tail };
}