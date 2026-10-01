const WORD = /[\p{L}\p{N}_]/u;

export function caretsAtEnd(texts) {
  const out = {};
  for (const [id, text] of Object.entries(texts)) out[id] = { text, anchor: text.length, focus: text.length };
  return out;
}

function span(c) {
  return [Math.min(c.anchor, c.focus), Math.max(c.anchor, c.focus)];
}

function wordLeft(text, at) {
  let i = at;
  while (i > 0 && !WORD.test(text[i - 1])) i--;
  while (i > 0 && WORD.test(text[i - 1])) i--;
  return i;
}

function wordRight(text, at) {
  let i = at;
  while (i < text.length && !WORD.test(text[i])) i++;
  while (i < text.length && WORD.test(text[i])) i++;
  return i;
}

function insertOne(c, str) {
  const [a, b] = span(c);
  const text = c.text.slice(0, a) + str + c.text.slice(b);
  const at = a + str.length;
  return { text, anchor: at, focus: at };
}

function eraseOne(c, dir, word) {
  const [a, b] = span(c);
  if (a !== b) return insertOne(c, '');
  const at = c.focus;
  const to = dir < 0
    ? (word ? wordLeft(c.text, at) : Math.max(0, at - 1))
    : (word ? wordRight(c.text, at) : Math.min(c.text.length, at + 1));
  const lo = Math.min(at, to), hi = Math.max(at, to);
  const text = c.text.slice(0, lo) + c.text.slice(hi);
  return { text, anchor: lo, focus: lo };
}

function moveOne(c, key, { shift, word }) {
  const [a, b] = span(c);
  let to;
  if (key === 'Home') to = 0;
  else if (key === 'End') to = c.text.length;
  else if (!shift && a !== b && !word) to = key === 'ArrowLeft' ? a : b;
  else if (key === 'ArrowLeft') to = word ? wordLeft(c.text, c.focus) : Math.max(0, c.focus - 1);
  else to = word ? wordRight(c.text, c.focus) : Math.min(c.text.length, c.focus + 1);
  return { text: c.text, anchor: shift ? c.anchor : to, focus: to };
}

function each(carets, fn) {
  const out = {};
  for (const [id, c] of Object.entries(carets)) out[id] = fn(c);
  return out;
}

export const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function insert(carets, str) {
  return each(carets, c => insertOne(c, str));
}

export function erase(carets, dir, word = false) {
  return each(carets, c => eraseOne(c, dir, word));
}

export function move(carets, key, opts = {}) {
  return each(carets, c => moveOne(c, key, opts));
}

export function selectAll(carets) {
  return each(carets, c => ({ text: c.text, anchor: 0, focus: c.text.length }));
}

export function place(carets, id, at, extend = false) {
  const c = carets[id];
  if (!c) return carets;
  const to = Math.max(0, Math.min(c.text.length, at));
  return { ...carets, [id]: { text: c.text, anchor: extend ? c.anchor : to, focus: to } };
}

export function selectedText(c) {
  const [a, b] = span(c);
  return c.text.slice(a, b);
}

export function parts(c) {
  const [a, b] = span(c);
  return { before: c.text.slice(0, a), sel: c.text.slice(a, b), after: c.text.slice(b), caretAtStart: c.focus === a && a !== b };
}