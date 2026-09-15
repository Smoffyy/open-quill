export const SENTENCE_RE = /(?:[^.!?]|[.!?](?!["'”’»)\]]*(?:\s|$)))+[.!?]+["'”’»)\]]*(?=\s|$)/g;
export const LINE_MAX = 150;
export const LINE_HOLD_MS = 3000;
export const MIN_WORDS = 4;

const QUOTE_CHARS = /["“”«»„‟]/g;
const OPENS_QUOTED = /^["“«„]/;
const HEDGE_OPENER = /^(?:well|hmm+|hm|huh|ah+|oh+|okay|ok|alright|right|so|actually|wait|yeah|yep)\b[\s,:;-]*/i;
const WORD_START = /^[\p{L}\p{N}]/u;

export function parseSteps(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];
  return raw.split(/\n{2,}/)
    .map(block => block.split('\n').map(l => l.trim()).filter(Boolean))
    .filter(lines => lines.length);
}

export function stripMdDecoration(text) {
  return String(text || '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^\s*][^*]*?)\*(?=[\s.,:;!?)]|$)/gm, '$1$2');
}

export function refineSentence(text) {
  const raw = String(text || '').trim();
  if (!raw || OPENS_QUOTED.test(raw)) return '';
  const unquoted = raw.replace(QUOTE_CHARS, '').replace(/\s+/g, ' ').trim();
  const body = unquoted.replace(HEDGE_OPENER, '').trim();
  if (!body || !WORD_START.test(body)) return '';
  if (body.split(/\s+/).length < MIN_WORDS) return '';
  return body === unquoted ? body : body.charAt(0).toUpperCase() + body.slice(1);
}

export function lastSentence(text) {
  const raw = stripMdDecoration(text).replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const found = raw.match(SENTENCE_RE);
  if (!found) return '';
  for (let i = found.length - 1; i >= 0; i--) {
    const s = refineSentence(found[i]);
    if (s) return s.length > LINE_MAX ? s.slice(0, LINE_MAX).trimEnd() + '…' : s;
  }
  return '';
}

export function thoughtSeconds(ms) {
  if (!(ms > 0)) return 0;
  return Math.max(1, Math.round(ms / 1000));
}
