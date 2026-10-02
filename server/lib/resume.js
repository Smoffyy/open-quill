import { historyText, decodeOqr } from './history.js';
import { openFence } from './steer.js';

const OQR = /\[\[OQR:([A-Za-z0-9+/=]+)\]\]/g;
const OQT = /\n*\[\[OQT:\d+\]\]\n*/g;
const HOLD = 320;
const MIN_OVERLAP = 6;
const MAX_OVERLAP = 600;

export const RESUME_INSTRUCTION = 'Your reply above was cut off before it was finished. Continue it from the exact character where it stops. What you write is appended directly to it, so do not repeat any of it, do not restart it, and add no preamble or acknowledgement. If it stopped mid-word, mid-line or inside a code block, carry straight on inside it without opening a new code fence.';

export const RESUME_TOOLS_INSTRUCTION = 'Your reply above was interrupted. Carry on with the task from exactly where it stopped. Do not repeat or summarise what is already done, it is already saved and on screen. If work is still unfinished, make the tool calls to finish it now.';

export function resumeParts(content) {
  const s = String(content || '');
  let cut = 0;
  for (const m of s.matchAll(OQR)) cut = m.index + m[0].length;
  return { head: cut ? historyText(s.slice(0, cut)) : '', tail: s.slice(cut).replace(OQT, '\n\n') };
}

export const STOPPED_FILE = 'Stopped while this file was being written. The part written so far is saved; press Continue to finish it.';
export const STOPPED_CALL = 'Stopped before this call finished, so it was not run.';

export function stoppedCall(content) {
  const s = String(content || '');
  let last = null;
  for (const m of s.matchAll(OQR)) last = m;
  if (!last || s.slice(last.index + last[0].length).trim()) return null;
  const d = decodeOqr(last[1]);
  if (!d || !d.call || !d.result || !d.result.interrupted) return null;
  return { start: last.index, end: last.index + last[0].length, call: d.call, result: d.result };
}

export function fenceFor(text) {
  let longest = 0;
  for (const m of String(text || '').matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

export function fileStep(path, partial, head, prefill) {
  const fence = fenceFor(partial);
  const lang = (/\.([A-Za-z0-9]+)$/.exec(path) || [])[1] || '';
  const open = fence + lang + '\n';
  const lead = { role: 'assistant', content: head || `I am writing ${path}.`, held: true };
  if (prefill) {
    const ask = `You were writing ${path} with create_file when the user stopped you. Its text so far is saved. Continue the file from the exact character where it stops, finish it, then close the code block with ${fence} on its own line. Output only file content: no commentary, and do not repeat what is already written.`;
    const echo = open + partial;
    return { fence, echo, messages: [lead, { role: 'user', content: ask, held: true }, { role: 'assistant', content: echo, prefill: true, held: true }] };
  }
  const ask = `You were writing ${path} with create_file when the user stopped you. This is the file so far, saved as is:\n${open}${partial}\n${fence}\nReply with one code block, opened with ${fence}, that contains only the REST of the file: start at the exact character where the text above stops, do not repeat any of it, and finish the file. No commentary.`;
  return { fence, echo: '', messages: [lead, { role: 'user', content: ask, held: true }] };
}

export function fileRest(collected, step) {
  let raw = String(collected || '');
  let width = step.fence.length;
  if (step.echo) {
    if (raw.length < step.echo.length && step.echo.startsWith(raw)) return { text: '', closed: false };
    raw = dropEcho(raw, step.echo);
  } else {
    const open = /(?:^|\n)[ \t]*(`{3,})[^\n`]*\n/.exec(raw);
    if (!open) return { text: '', closed: false };
    width = open[1].length;
    raw = raw.slice(open.index + open[0].length);
  }
  const close = new RegExp('(^|\\n)[ \\t]*`{' + width + ',}[ \\t]*(?:\\n|$)').exec(raw);
  if (!close) return { text: raw, closed: false };
  return { text: raw.slice(0, close.index + close[1].length), closed: true };
}

export function joinFile(partial, rest, prefill) {
  if (prefill || !partial) return rest;
  if (rest.startsWith(partial)) return rest.slice(partial.length);
  return dropOverlap(partial, rest);
}

export function resumeTurn(content, prefill, { file = true } = {}) {
  const stopped = file ? stoppedCall(content) : null;
  if (stopped && stopped.call.tool === 'create_file' && stopped.call.path) {
    const head = historyText(String(content).slice(0, stopped.start)).trim();
    return { mode: 'file', path: String(stopped.call.path), head, start: stopped.start, end: stopped.end, prefill: !!prefill };
  }
  const { head, tail } = resumeParts(content);
  if (!tail.trim()) {
    if (!head) return null;
    return { mode: 'tools', messages: [{ role: 'assistant', content: head, held: true }, { role: 'user', content: RESUME_TOOLS_INSTRUCTION, held: true }] };
  }
  const text = head ? head + '\n\n' + tail.replace(/^\s+/, '') : tail;
  if (prefill) return { mode: 'prefill', messages: [{ role: 'assistant', content: text, prefill: true, held: true }] };
  return { mode: 'fallback', messages: [{ role: 'assistant', content: text, held: true }, { role: 'user', content: RESUME_INSTRUCTION, held: true }] };
}

export function isPrefillRefusal(err) {
  return /^Upstream error (400|422)\b/.test(String(err?.message || ''));
}

function dropOverlap(prev, head) {
  const trimmed = prev.trimEnd();
  for (let k = Math.min(head.length, MAX_OVERLAP); k > 0; k--) {
    const piece = head.slice(0, k);
    if (piece.replace(/\s/g, '').length < MIN_OVERLAP) break;
    if (prev.endsWith(piece)) return head.slice(k);
    if (trimmed.endsWith(piece.trimEnd())) return head.slice(piece.trimEnd().length);
  }
  return head;
}

export function stitch(prev, head, mode) {
  const before = String(prev || '');
  let out = String(head || '');
  const pw = /\s*$/.exec(before)[0];
  const hw = /^\s*/.exec(out)[0];
  if (pw && hw.startsWith(pw)) out = out.slice(pw.length);
  if (mode !== 'fallback') return out;
  const fence = openFence(before);
  if (fence) out = out.replace(/^\s*(?:`{3,}|~{3,})[^\s`~][^\n`]*\n/, '');
  out = dropOverlap(before, out);
  if (!fence && !pw && /[.!?;:,]$/.test(before) && /^[\p{L}\p{N}]/u.test(out)) out = ' ' + out;
  return out;
}

export function dropEcho(head, echo) {
  if (!echo) return head;
  if (head.startsWith(echo)) return head.slice(echo.length);
  const trimmed = echo.trimEnd();
  return trimmed && head.startsWith(trimmed) ? head.slice(trimmed.length) : head;
}

export function createStitcher(prev, plan) {
  const mode = plan && plan.mode;
  if (mode !== 'prefill' && mode !== 'fallback') return null;
  const echo = mode === 'prefill' ? String(plan.messages[plan.messages.length - 1].content || '') : '';
  let buf = '';
  let done = false;
  const echoing = () => !!echo && buf.length < echo.length && echo.startsWith(buf);
  const ready = () => (mode === 'fallback' ? buf.length >= HOLD : !echoing() && /\S/.test(dropEcho(buf, echo)));
  const finish = () => stitch(prev, dropEcho(buf, echo), mode);
  return {
    get touched() { return done || buf.length > 0; },
    push(text) {
      if (done) return text;
      buf += text;
      if (!ready()) return '';
      done = true;
      return finish();
    },
    flush() {
      if (done) return '';
      done = true;
      return buf ? finish() : '';
    }
  };
}