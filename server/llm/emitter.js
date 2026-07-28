import { parseTextToolCalls } from '../tools/index.js';

const TEXT_CALL_TAGS = [
  { open: '<tool_call>', close: '</tool_call>', keepOpen: false },
  { open: '<|tool_call|>', close: '<|/tool_call|>', keepOpen: false },
  { open: '<tool_calls>', close: '</tool_calls>', keepOpen: false },
  { open: '<function_call>', close: '</function_call>', keepOpen: false },
  { open: '[TOOL_CALLS]', close: '[/TOOL_CALLS]', keepOpen: false },
  { open: '[TOOL_CALL]', close: '[/TOOL_CALL]', keepOpen: false },
  { open: '<function=', close: '</function>', keepOpen: true },
  { open: '<function name=', close: '</function>', keepOpen: true },
  { open: '<invoke=', close: '</invoke>', keepOpen: true },
  { open: '<invoke name=', close: '</invoke>', keepOpen: true }
];

const LOOSE_OPENS = ['<parameter=', '<parameter name=', '[used ', '[tool_call', '[tool '];
const LOOSE_PROBE = 400;
const NAME_BACK = 240;
const CONTINUATIONS = ['<parameter=', '<parameter name=', '</function>', '</invoke>', '</tool_call>', '</tool_calls>', '[/TOOL_CALLS]', '[/TOOL_CALL]'];
const PARAM_OPEN_G = /<\s*parameter(?:\s*=\s*|\s+name\s*=\s*)["']?[A-Za-z0-9_.-]+["']?\s*>/gi;
const PARAM_CLOSE_G = /<\s*\/\s*parameter\s*>/gi;
const TAIL_SKIP = /^[ \t]*[\]>]?[ \t]*(?:\r?\n)?[ \t]*(?:(?:<\s*\/\s*(?:function|invoke|tool_call|tool_calls)\s*>|\[\/TOOL_CALLS?\])[ \t]*(?:\r?\n)?[ \t]*)*/i;

const heldBack = (s, tag) => { for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) if (s.endsWith(tag.slice(0, n))) return n; return 0; };

const startsTag = (s) => s.indexOf('<') !== -1 || s.indexOf('[') !== -1;

function openHold(s) {
  if (!startsTag(s)) return 0;
  let hold = 0;
  for (const t of TEXT_CALL_TAGS) hold = Math.max(hold, heldBack(s, t.open));
  for (const o of LOOSE_OPENS) hold = Math.max(hold, heldBack(s, o));
  return hold;
}

function isPrefixOfContinuation(s) {
  if (!s) return true;
  for (const c of CONTINUATIONS) if (c.length > s.length && c.slice(0, s.length).toLowerCase() === s.toLowerCase()) return true;
  return false;
}

function scanLoose(buf, openLen, final) {
  PARAM_OPEN_G.lastIndex = 0;
  let last = -1, m;
  while ((m = PARAM_OPEN_G.exec(buf))) last = m.index + m[0].length;
  if (last === -1) {
    if (final) return { giveUp: true, at: openLen };
    if (buf.length - openLen > LOOSE_PROBE) return { giveUp: true, at: openLen };
    return { wait: true };
  }
  PARAM_CLOSE_G.lastIndex = last;
  const close = PARAM_CLOSE_G.exec(buf);
  if (!close) return final ? { end: buf.length } : { wait: true };
  const i = close.index + close[0].length;
  const tail = buf.slice(i).match(TAIL_SKIP);
  const j = i + (tail ? tail[0].length : 0);
  const rest = buf.slice(j);
  if (/^<\s*p(?:a(?:r(?:a(?:m(?:e(?:t(?:e(?:r)?)?)?)?)?)?)?)?$/i.test(rest)) return final ? { end: buf.length } : { wait: true };
  if (/^<\s*parameter/i.test(rest)) return final ? { end: buf.length } : { wait: true };
  if (!final && isPrefixOfContinuation(rest)) return { wait: true };
  return { end: j };
}

export function makeToolTextFilter(onText, onCalls, isAllowed) {
  if (!isAllowed) return { feed: (raw) => { if (raw) onText(raw); }, flush: () => {} };
  let buf = '';
  let state = null;
  let recent = '';

  const emit = (text) => {
    if (!text) return;
    recent = (recent + text).slice(-NAME_BACK);
    onText(text);
  };

  const settle = (body, prefix, suffix) => {
    const calls = parseTextToolCalls(body, isAllowed, recent);
    if (calls.length) onCalls(calls);
    else emit(prefix + body + suffix);
  };

  const step = (final) => {
    for (;;) {
      if (!state) {
        let best = null;
        if (startsTag(buf)) {
          for (const tag of TEXT_CALL_TAGS) {
            const i = buf.indexOf(tag.open);
            if (i !== -1 && (!best || i < best.i)) best = { i, kind: 'tag', tag };
          }
          for (const open of LOOSE_OPENS) {
            const i = buf.indexOf(open);
            if (i !== -1 && (!best || i < best.i)) best = { i, kind: 'loose', open };
          }
        }
        if (!best) {
          const hold = final ? 0 : openHold(buf);
          if (buf.length > hold) { emit(buf.slice(0, buf.length - hold)); buf = buf.slice(buf.length - hold); }
          return;
        }
        if (best.i > 0) { emit(buf.slice(0, best.i)); buf = buf.slice(best.i); }
        if (best.kind === 'tag') {
          state = { kind: 'tag', tag: best.tag };
          if (!best.tag.keepOpen) buf = buf.slice(best.tag.open.length);
        } else {
          state = { kind: 'loose', openLen: best.open.length };
        }
        continue;
      }
      if (state.kind === 'tag') {
        const tag = state.tag;
        const ci = buf.indexOf(tag.close);
        if (ci === -1) {
          if (!final) return;
          settle(buf, tag.keepOpen ? '' : tag.open, '');
          buf = ''; state = null;
          return;
        }
        settle(buf.slice(0, ci), tag.keepOpen ? '' : tag.open, tag.close);
        buf = buf.slice(ci + tag.close.length);
        state = null;
        continue;
      }
      const r = scanLoose(buf, state.openLen, final);
      if (r.wait) return;
      if (r.giveUp) {
        emit(buf.slice(0, r.at));
        buf = buf.slice(r.at);
        state = null;
        continue;
      }
      const body = buf.slice(0, r.end);
      const calls = parseTextToolCalls(body, isAllowed, recent);
      if (calls.length) onCalls(calls);
      else emit(body);
      buf = buf.slice(r.end);
      state = null;
      if (!buf) return;
    }
  };

  return {
    feed: (raw) => { if (!raw) return; buf += raw; step(false); },
    flush: () => { step(true); if (buf) { emit(buf); buf = ''; } state = null; }
  };
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
