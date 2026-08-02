import { modelCtx } from './models.js';
import { isLlamaCpp, llamaPromptTokens } from './llamacpp.js';

const HEAD_KEEP = 600;
const DROP_NOTE = '[Older messages in this conversation were dropped to stay inside the model context window.]';
const IMG_NOTE = '[{n} earlier image(s) from this message were removed to stay inside the model context window.]';
const TRIM_NOTE = '\n\n[... middle of this message was cut to fit the model context window ...]\n\n';
const MAX_PROBES = 8;
const MIN_TAIL_CHARS = 200;
const MIN_RECLAIM_CHARS = 400;
const RECLAIM_PROBES = 6;
const CACHE_STEP = 0.25;

const learnedCtx = new Map();
const LEARNED_TTL = 30 * 60 * 1000;

export function noteRealCtx(model, ctx) {
  if (!model || !(ctx > 0)) return;
  learnedCtx.set(String(model.id || model.internal_name || ''), { ctx, at: Date.now() });
}

function learnedFor(model) {
  const key = String(model?.id || model?.internal_name || '');
  const hit = learnedCtx.get(key);
  if (!hit) return 0;
  if (Date.now() - hit.at > LEARNED_TTL) { learnedCtx.delete(key); return 0; }
  return hit.ctx;
}

export async function effectiveCtx(model) {
  const learned = learnedFor(model);
  if (learned > 0) return learned;
  const manual = parseInt(model?.num_ctx, 10);
  if (Number.isFinite(manual) && manual > 0) return manual;
  const live = await modelCtx(model);
  return live > 0 ? live : 0;
}

export function outputReserve(model, ctx) {
  const half = Math.max(32, Math.floor(ctx * 0.5));
  const floor = Math.min(half, Math.min(1024, Math.max(256, Math.floor(ctx * 0.05))));
  const want = parseInt(model?.max_tokens, 10);
  if (Number.isFinite(want) && want > 0) return Math.min(Math.max(want, floor), half);
  return Math.min(Math.max(2048, floor), half);
}

export async function contextBudget(model) {
  const ctx = await effectiveCtx(model);
  if (!(ctx > 0)) return { ctx: 0, reserve: 0, budget: 0 };
  const reserve = outputReserve(model, ctx);
  const safety = Math.min(256, Math.max(32, Math.floor(ctx * 0.01)));
  const raw = ctx - reserve - safety;
  return { ctx, reserve, budget: raw > 0 ? raw : Math.max(64, Math.floor(ctx * 0.5)) };
}

export async function countExact(model, msgs, tools) {
  if (!isLlamaCpp(model)) return 0;
  return llamaPromptTokens(model, msgs, tools);
}

function textLen(m) {
  const c = m.content;
  if (typeof c === 'string') return c.length;
  if (Array.isArray(c)) return c.reduce((n, p) => n + (p && p.type === 'text' ? (p.text || '').length : 1200), 0);
  return 0;
}

function trimmableLen(m) {
  const c = m.content;
  if (typeof c === 'string') return c.length;
  if (Array.isArray(c)) return c.reduce((n, p) => n + (p && p.type === 'text' ? (p.text || '').length : 0), 0);
  return 0;
}

function imageCount(msgs) {
  let n = 0;
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content) if (p && p.type === 'image_url') n++;
  }
  return n;
}

function applyImageDrop(msgs, dropCount) {
  if (dropCount < 1) return msgs;
  let seen = 0;
  return msgs.map(m => {
    if (!Array.isArray(m.content)) return m;
    let removed = 0;
    const parts = [];
    for (const p of m.content) {
      if (p && p.type === 'image_url') {
        seen++;
        if (seen <= dropCount) { removed++; continue; }
      }
      parts.push(p);
    }
    if (!removed) return m;
    return { ...m, content: [{ type: 'text', text: IMG_NOTE.replace('{n}', String(removed)) }, ...parts] };
  });
}

async function evictImages(msgs, budget, count) {
  const total = imageCount(msgs);
  if (total < 1) return { msgs, tokens: 0, fits: false, removed: 0 };
  let lo = 1;
  let hi = total;
  let best = null;
  let bestTokens = 0;
  let bestRemoved = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cand = applyImageDrop(msgs, mid);
    const t = await count(cand);
    if (!t) return { msgs, tokens: 0, fits: false, removed: 0 };
    if (t <= budget) { best = cand; bestTokens = t; bestRemoved = mid; hi = mid - 1; }
    else lo = mid + 1;
  }
  if (best) return { msgs: best, tokens: bestTokens, fits: true, removed: bestRemoved };
  const all = applyImageDrop(msgs, total);
  const t = await count(all);
  return { msgs: all, tokens: t, fits: !!t && t <= budget, removed: total };
}

function protectedFlags(msgs) {
  const keep = new Uint8Array(msgs.length);
  for (let i = 0; i < msgs.length; i++) if (msgs[i].role === 'system') keep[i] = 1;
  let lastUser = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { lastUser = i; break; }
  if (lastUser !== -1) for (let i = lastUser; i < msgs.length; i++) keep[i] = 1;
  return keep;
}

function applyDrop(msgs, keep, dropCount, boundaryChars) {
  const kept = [];
  let seen = 0;
  let removed = 0;
  for (let i = 0; i < msgs.length; i++) {
    if (!keep[i]) {
      seen++;
      if (seen < dropCount) { removed++; continue; }
      if (seen === dropCount) {
        if (boundaryChars > 0) kept.push(withTrimmed(msgs[i], boundaryChars));
        else removed++;
        continue;
      }
    }
    kept.push(msgs[i]);
  }
  if (!removed) return kept;
  return withNote(kept, DROP_NOTE);
}

function noteInto(m, note) {
  if (typeof m.content === 'string') return { ...m, content: note + '\n\n' + m.content };
  if (Array.isArray(m.content)) return { ...m, content: [{ type: 'text', text: note }, ...m.content] };
  return { ...m, content: note };
}

function withNote(list, note) {
  const out = list.slice();
  if (!out.length) return [{ role: 'user', content: note }];
  let idx = -1;
  for (let i = 0; i < out.length; i++) if (out[i].role !== 'system') { idx = i; break; }
  if (idx === -1) idx = out.length - 1;
  out[idx] = noteInto(out[idx], note);
  return out;
}

function droppableIdx(keep) {
  const list = [];
  for (let i = 0; i < keep.length; i++) if (!keep[i]) list.push(i);
  return list;
}

async function reclaim(msgs, keep, dropCount, budget, count, fitted, fittedTokens, perChar) {
  const idx = droppableIdx(keep);
  if (dropCount < 1 || dropCount > idx.length) return { msgs: fitted, tokens: fittedTokens, reclaimed: false };
  const full = textLen(msgs[idx[dropCount - 1]]);
  if (full < MIN_RECLAIM_CHARS) return { msgs: fitted, tokens: fittedTokens, reclaimed: false };
  let lo = MIN_RECLAIM_CHARS;
  let hi = full;
  let best = null;
  let bestTokens = fittedTokens;
  let probe = perChar > 0
    ? Math.min(hi, Math.max(lo, Math.floor((budget - fittedTokens) / perChar)))
    : Math.floor((lo + hi) / 2);
  for (let i = 0; i < RECLAIM_PROBES && lo <= hi; i++) {
    const cand = applyDrop(msgs, keep, dropCount, probe);
    const t = await count(cand);
    if (!t) break;
    if (t <= budget) {
      best = cand; bestTokens = t; lo = probe + 1;
      if (budget - t < Math.max(64, Math.floor(budget * 0.01))) break;
    } else hi = probe - 1;
    if (lo > hi) break;
    probe = Math.floor((lo + hi) / 2);
  }
  if (!best) return { msgs: fitted, tokens: fittedTokens, reclaimed: false };
  return { msgs: best, tokens: bestTokens, reclaimed: true };
}

function droppableCount(keep) {
  let n = 0;
  for (let i = 0; i < keep.length; i++) if (!keep[i]) n++;
  return n;
}

function guessDrop(msgs, keep, over, perChar) {
  let need = over;
  let n = 0;
  for (let i = 0; i < msgs.length && need > 0; i++) {
    if (keep[i]) continue;
    need -= Math.max(1, Math.round(textLen(msgs[i]) * perChar));
    n++;
  }
  return n;
}

function sliceKeepEnds(text, keepChars) {
  if (text.length <= keepChars) return text;
  const head = Math.min(HEAD_KEEP, Math.floor(keepChars * 0.2));
  const tail = Math.max(MIN_TAIL_CHARS, keepChars - head);
  return text.slice(0, head) + TRIM_NOTE + text.slice(-tail);
}

function withTrimmed(m, keepChars) {
  if (typeof m.content === 'string') return { ...m, content: sliceKeepEnds(m.content, keepChars) };
  if (Array.isArray(m.content)) {
    let seen = false;
    const parts = m.content.map(p => {
      if (!p || p.type !== 'text' || seen) return p;
      seen = true;
      return { ...p, text: sliceKeepEnds(p.text || '', keepChars) };
    });
    return { ...m, content: parts };
  }
  return m;
}

function largestIdx(msgs, includeSystem) {
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < msgs.length; i++) {
    if (!includeSystem && msgs[i].role === 'system') continue;
    const l = trimmableLen(msgs[i]);
    if (l > bestLen) { bestLen = l; best = i; }
  }
  return best;
}

async function trimAt(msgs, idx, budget, count) {
  const full = trimmableLen(msgs[idx]);
  let lo = 200;
  let hi = full;
  let best = null;
  let bestTokens = 0;
  for (let i = 0; i < MAX_PROBES && lo <= hi; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const cand = msgs.slice();
    cand[idx] = withTrimmed(msgs[idx], mid);
    const t = await count(cand);
    if (!t) return { msgs: cand, tokens: 0, fits: false };
    if (t <= budget) {
      best = cand; bestTokens = t;
      lo = mid + Math.max(1, Math.floor((hi - mid) / 2));
      if (lo > hi) break;
    } else hi = mid - 1;
  }
  if (best) return { msgs: best, tokens: bestTokens, fits: true };
  const cand = msgs.slice();
  cand[idx] = withTrimmed(msgs[idx], 200);
  const t = await count(cand);
  return { msgs: cand, tokens: t, fits: !!t && t <= budget };
}

async function trimBiggest(msgs, budget, count) {
  let work = msgs;
  let tokens = 0;
  let trimmed = false;
  let images = 0;
  if (imageCount(work) > 0) {
    const ev = await evictImages(work, budget, count);
    if (ev.removed > 0) { work = ev.msgs; tokens = ev.tokens; images = ev.removed; }
    if (ev.fits) return { msgs: work, trimmed: false, tokens, images };
  }
  const idx = largestIdx(work, false);
  if (idx !== -1) {
    const r = await trimAt(work, idx, budget, count);
    work = r.msgs; tokens = r.tokens; trimmed = true;
    if (r.fits) return { msgs: work, trimmed, tokens, images };
  }
  const sysIdx = largestIdx(work, true);
  if (sysIdx !== -1 && work[sysIdx].role === 'system') {
    const r = await trimAt(work, sysIdx, budget, count);
    return { msgs: r.msgs, trimmed: true, tokens: r.tokens, images };
  }
  return { msgs: work, trimmed, tokens, images };
}

export function trimMode(model) {
  return model && model.ctx_trim_mode === 'cache' ? 'cache' : 'retain';
}

export async function slideWithCounter(count, msgs, budget, opts = {}) {
  const none = { msgs, dropped: 0, trimmed: false, tokens: 0, exact: false };
  if (!budget || !Array.isArray(msgs) || !msgs.length) return none;
  const cacheMode = opts.mode === 'cache';

  const total = await count(msgs);
  if (!total) return none;
  if (total <= budget) return { msgs, dropped: 0, trimmed: false, tokens: total, exact: true };

  const over = total - budget;
  const step = Math.max(256, Math.floor(budget * CACHE_STEP));
  const needRemoved = cacheMode ? Math.ceil(over / step) * step : over;
  const target = total - needRemoved;

  const keep = protectedFlags(msgs);
  const maxDrop = droppableCount(keep);
  let chars = 0;
  for (const m of msgs) chars += textLen(m);
  const perChar = chars > 0 ? total / chars : 0;

  let lo = 0;
  let hi = maxDrop;
  let bestMsgs = null;
  let bestTokens = 0;
  let bestDrop = 0;
  let fitMsgs = null;
  let fitTokens = 0;
  let fitDrop = 0;
  let probe = Math.min(maxDrop, Math.max(1, guessDrop(msgs, keep, needRemoved, perChar)));

  for (let i = 0; i < MAX_PROBES && lo <= hi; i++) {
    const cand = applyDrop(msgs, keep, probe);
    const t = await count(cand);
    if (!t) return none;
    if (t <= budget && (!fitMsgs || probe < fitDrop)) { fitMsgs = cand; fitTokens = t; fitDrop = probe; }
    if (t <= target) {
      bestMsgs = cand; bestTokens = t; bestDrop = probe;
      hi = probe - 1;
    } else {
      lo = probe + 1;
    }
    if (lo > hi) break;
    probe = Math.floor((lo + hi) / 2);
    if (probe < 1) probe = 1;
  }

  if (bestMsgs) {
    if (!cacheMode) {
      const headroom = budget - bestTokens;
      if (bestDrop > 0 && headroom > Math.max(200, Math.floor(budget * 0.04))) {
        const back = await reclaim(msgs, keep, bestDrop, budget, count, bestMsgs, bestTokens, perChar);
        if (back.reclaimed) return { msgs: back.msgs, dropped: bestDrop - 1, trimmed: true, tokens: back.tokens, exact: true };
      }
    }
    return { msgs: bestMsgs, dropped: bestDrop, trimmed: false, tokens: bestTokens, exact: true };
  }
  if (fitMsgs) return { msgs: fitMsgs, dropped: fitDrop, trimmed: false, tokens: fitTokens, exact: true };

  const stripped = applyDrop(msgs, keep, maxDrop);
  const after = await count(stripped);
  if (after && after <= budget) return { msgs: stripped, dropped: maxDrop, trimmed: false, tokens: after, exact: true };

  const t = await trimBiggest(stripped, budget, count);
  return { msgs: t.msgs, dropped: maxDrop, trimmed: !!t.trimmed, images: t.images || 0, tokens: t.tokens, exact: !!t.tokens };
}

export async function slideToFit(model, msgs, budget, tools) {
  return slideWithCounter((list) => countExact(model, list, tools), msgs, budget, { mode: trimMode(model) });
}

export function shrinkByRatio(msgs, factor) {
  const keep = protectedFlags(msgs);
  const maxDrop = droppableCount(keep);
  if (maxDrop > 0) {
    const n = Math.max(1, Math.ceil(maxDrop * Math.min(0.9, Math.max(0.1, factor))));
    return { msgs: applyDrop(msgs, keep, n), dropped: n, trimmed: false };
  }
  const idx = largestIdx(msgs, false);
  if (idx === -1) return { msgs, dropped: 0, trimmed: false };
  const out = msgs.slice();
  const keepChars = Math.max(400, Math.floor(textLen(msgs[idx]) * Math.max(0.1, 1 - factor)));
  out[idx] = withTrimmed(msgs[idx], keepChars);
  return { msgs: out, dropped: 0, trimmed: true };
}
