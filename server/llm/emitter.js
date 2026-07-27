import { parseTextToolCalls } from '../tools/index.js';

const TEXT_CALL_TAGS = [
  { open: '<tool_call>', close: '</tool_call>', keepOpen: false },
  { open: '<|tool_call|>', close: '<|/tool_call|>', keepOpen: false },
  { open: '<tool_calls>', close: '</tool_calls>', keepOpen: false },
  { open: '<function_call>', close: '</function_call>', keepOpen: false },
  { open: '[TOOL_CALLS]', close: '[/TOOL_CALLS]', keepOpen: false },
  { open: '<function=', close: '</function>', keepOpen: true },
  { open: '<function name=', close: '</function>', keepOpen: true }
];

const heldBack = (s, tag) => { for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) if (s.endsWith(tag.slice(0, n))) return n; return 0; };

const TAG_MAX = TEXT_CALL_TAGS.reduce((n, t) => Math.max(n, t.open.length, t.close.length), 0);
const startsTag = (s) => s.indexOf('<') !== -1 || s.indexOf('[') !== -1;
const tailStartsTag = (s) => startsTag(s.length > TAG_MAX ? s.slice(s.length - TAG_MAX) : s);

export function makeToolTextFilter(onText, onCalls, isAllowed) {
  let carry = '', buf = '', block = null;
  if (!isAllowed) return { feed: (raw) => { if (raw) onText(raw); }, flush: () => {} };
  const feed = (raw) => {
    let text = carry + raw; carry = '';
    while (text.length) {
      if (!block) {
        let best = null;
        if (startsTag(text)) {
          for (const tag of TEXT_CALL_TAGS) {
            const i = text.indexOf(tag.open);
            if (i !== -1 && (!best || i < best.i)) best = { i, tag };
          }
        }
        if (!best) {
          let hold = 0;
          if (tailStartsTag(text)) for (const tag of TEXT_CALL_TAGS) hold = Math.max(hold, heldBack(text, tag.open));
          if (text.length - hold > 0) onText(text.slice(0, text.length - hold));
          carry = text.slice(text.length - hold);
          return;
        }
        if (best.i > 0) onText(text.slice(0, best.i));
        block = best.tag;
        buf = best.tag.keepOpen ? best.tag.open : '';
        text = text.slice(best.i + best.tag.open.length);
      } else {
        const ci = text.indexOf(block.close);
        if (ci === -1) {
          const hold = heldBack(text, block.close);
          buf += text.slice(0, text.length - hold);
          carry = text.slice(text.length - hold);
          return;
        }
        buf += text.slice(0, ci);
        const calls = parseTextToolCalls(buf, isAllowed);
        if (calls.length) onCalls(calls);
        else onText((block.keepOpen ? '' : block.open) + buf + block.close);
        text = text.slice(ci + block.close.length);
        block = null; buf = '';
      }
    }
  };
  const flush = () => {
    if (block) {
      const rest = buf + carry;
      const calls = parseTextToolCalls(rest, isAllowed);
      if (calls.length) onCalls(calls);
      else onText((block.keepOpen ? '' : block.open) + rest);
      block = null; buf = ''; carry = '';
      return;
    }
    if (carry) { onText(carry); carry = ''; }
  };
  return { feed, flush };
}

export function makeEmitter(model, onEvent, onCalls, isAllowed) {
  let inThink = false, carry = '';
  const TOPEN = (model.think_open && model.think_open.trim()) || '<think>';
  const TCLOSE = (model.think_close && model.think_close.trim()) || '</think>';
  const contentFilter = makeToolTextFilter((text) => onEvent({ type: 'content', text }), onCalls, isAllowed);
  const reasonFilter = makeToolTextFilter((text) => onEvent({ type: 'reasoning', text }), onCalls, isAllowed);
  const emitContent = (raw) => {
    let text = carry + raw; carry = '';
    while (text.length) {
      if (!inThink) {
        const open = text.indexOf(TOPEN);
        if (open === -1) { const h = heldBack(text, TOPEN); if (text.length - h) contentFilter.feed(text.slice(0, text.length - h)); carry = text.slice(text.length - h); return; }
        if (open > 0) contentFilter.feed(text.slice(0, open));
        text = text.slice(open + TOPEN.length); inThink = true;
      } else {
        const close = text.indexOf(TCLOSE);
        if (close === -1) { const h = heldBack(text, TCLOSE); if (text.length - h) reasonFilter.feed(text.slice(0, text.length - h)); carry = text.slice(text.length - h); return; }
        if (close > 0) reasonFilter.feed(text.slice(0, close));
        text = text.slice(close + TCLOSE.length); inThink = false;
      }
    }
  };
  const emitReasoning = (raw) => { if (raw) reasonFilter.feed(raw); };
  const flush = () => {
    if (carry) { (inThink ? reasonFilter : contentFilter).feed(carry); carry = ''; }
    contentFilter.flush();
    reasonFilter.flush();
  };
  return { emitContent, emitReasoning, flush };
}

