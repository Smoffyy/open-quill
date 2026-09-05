import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// The assistant message that is still being written: the text received so far,
// how much of it has been revealed, and the timer that walks one toward the
// other. App kept this as six pieces of state and eight refs interleaved with
// everything else it does; the reveal loop in particular could only be checked
// by watching a model type.
//
// What deliberately stays in App is finalize(): committing the finished text to
// the thread has an ordering requirement ("nothing appends to messages between
// `done` and finalize()") that belongs where it can be seen next to the code it
// constrains. This hook hands over a snapshot and clears itself; it does not
// decide when.

// How much of the remaining text to reveal on each tick. Big backlogs catch up
// in large strides so a fast model never falls visibly behind, while the last
// few hundred characters slow to something that reads as typing.
// The floor of 2 keeps the last few characters from crawling; the clamp keeps it
// from claiming more than is left. The old inline version relied on the caller's
// slice() to absorb the overshoot, which worked but made the number a lie.
export function revealChunk(remaining, instant) {
  if (remaining <= 0) return 0;
  if (instant) return remaining;
  if (remaining > 1200) return Math.ceil(remaining / 3);
  if (remaining > 240) return Math.ceil(remaining / 6);
  return Math.min(remaining, Math.max(2, Math.ceil(remaining / 9)));
}

// Below 8ms the timer costs more than it shows; above 100ms it stops reading as
// typing and starts reading as stalling.
export function revealPeriod(ms) {
  return Math.max(8, Math.min(100, ms || 0));
}

// The transcript markers for a tool result and a reasoning break. Text carrying
// one must appear whole: revealing `[[OQR:` a character at a time would draw the
// raw marker before the parser could turn it into a card.
export function hasMarker(text) {
  return text.indexOf('[[OQR:') !== -1 || text.indexOf('[[OQT:') !== -1;
}

const PHASE_STATIC = 'static';

export function useTurnStream(opts = {}) {
  const [content, setContent] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [segs, setSegs] = useState(null);
  const [phase, setPhase] = useState(PHASE_STATIC);
  const [streaming, setStreaming] = useState(false);
  const [queued, setQueued] = useState(false);

  // Everything the websocket handlers touch is a ref: they run outside render
  // and need the value as it is now, not as it was when they were created.
  const target = useRef('');
  const targetReason = useRef('');
  const shown = useRef(0);
  const donePending = useRef(false);
  const assistantId = useRef(null);
  const modelId = useRef(null);
  const timer = useRef(null);
  const streamingRef = useRef(false);
  const queuedRef = useRef(false);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  useEffect(() => { queuedRef.current = queued; }, [queued]);
  // A safety net: any path that sets the shown text without updating the counter
  // is corrected on the next render rather than leaving the reveal stuck.
  useEffect(() => { shown.current = content.length; }, [content]);

  const animate = useRef(!!opts.animate);
  const speed = useRef(opts.speedMs || 0);
  animate.current = !!opts.animate;
  speed.current = opts.speedMs || 0;

  const cb = useRef(opts);
  cb.current = opts;

  const stopTimer = useCallback(() => {
    clearInterval(timer.current);
    timer.current = null;
    cb.current.onFollowStop?.();
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    cb.current.onFollowStart?.();
    timer.current = setInterval(() => {
      const full = target.current;
      if (shown.current >= full.length) {
        if (donePending.current) cb.current.onRevealComplete?.();
        return;
      }
      const instant = !animate.current || speed.current <= 0;
      setContent(prev => {
        const next = full.slice(0, prev.length + revealChunk(full.length - prev.length, instant));
        shown.current = next.length;
        return next;
      });
    }, revealPeriod(speed.current));
  }, [stopTimer]);

  // A new turn on the active chat.
  const begin = useCallback(({ messageId, modelId: mid }) => {
    target.current = '';
    targetReason.current = '';
    donePending.current = false;
    shown.current = 0;
    assistantId.current = messageId;
    modelId.current = mid;
    setContent(''); setReasoning(''); setSegs(null);
    setPhase('generating'); setStreaming(true); setQueued(false);
    startTimer();
  }, [startTimer]);

  // Fresh content for the active chat. `full` is everything received so far, not
  // the delta, because the mirror already accumulates it.
  const pushContent = useCallback((full, delta) => {
    target.current = full;
    setPhase('generating');
    if (hasMarker(delta)) {
      // Skip ahead so the marker is never half-drawn.
      shown.current = full.length;
      setContent(full);
      return true;
    }
    if (!animate.current) {
      setContent(full);
      shown.current = full.length;
    }
    return false;
  }, []);

  const pushReasoning = useCallback((full) => {
    targetReason.current = full;
    setReasoning(full);
    if (!target.current) setPhase('thinking');
  }, []);

  const setSegments = useCallback((list) => setSegs(list), []);

  // Picking a turn back up: a reload, or switching to a chat already generating.
  const restore = useCallback((rec, fallbackModelId) => {
    target.current = rec.content;
    targetReason.current = rec.reasoning;
    assistantId.current = rec.assistantId;
    modelId.current = rec.model_id || fallbackModelId;
    donePending.current = false;
    shown.current = rec.content.length;
    setContent(rec.content);
    setReasoning(rec.reasoning);
    setSegs(rec.reasonSegs ? rec.reasonSegs.slice() : null);
    setPhase(rec.phase === 'thinking' ? 'thinking' : 'generating');
    setStreaming(true);
    setQueued(rec.phase === 'queued');
    startTimer();
  }, [startTimer]);

  // Back to nothing in flight, with no message committed: an error before any
  // text arrived, or switching to a chat that is idle.
  const clear = useCallback(() => {
    stopTimer();
    target.current = '';
    targetReason.current = '';
    donePending.current = false;
    shown.current = 0;
    setContent(''); setReasoning(''); setSegs(null);
    setStreaming(false); setQueued(false); setPhase(PHASE_STATIC);
  }, [stopTimer]);

  // The turn is over as far as the server is concerned. Returns true when the
  // reveal has already caught up, so the caller can commit straight away instead
  // of waiting for a tick that has nothing left to show.
  const markDone = useCallback(() => {
    donePending.current = true;
    return !animate.current || shown.current >= target.current.length;
  }, []);

  // Hand the finished text over and reset. The caller owns what happens to it.
  const commit = useCallback(() => {
    stopTimer();
    const out = {
      content: target.current,
      reasoning: targetReason.current,
      assistantId: assistantId.current,
      modelId: modelId.current
    };
    target.current = '';
    targetReason.current = '';
    donePending.current = false;
    shown.current = 0;
    setStreaming(false); setPhase(PHASE_STATIC); setQueued(false);
    setContent(''); setReasoning(''); setSegs(null);
    return out;
  }, [stopTimer]);

  return useMemo(() => ({
    content, reasoning, segs, phase, streaming, queued,
    streamingRef, queuedRef, assistantId, modelId,
    // "the server has said done, but the reveal has not caught up and nothing has
    // been committed yet". A new turn arriving in that window must commit the
    // previous one first, or its text is lost.
    donePending,
    setQueued, setPhase,
    begin, pushContent, pushReasoning, setSegments, restore, clear, markDone, commit,
    stopTimer, startTimer
  }), [content, reasoning, segs, phase, streaming, queued,
       begin, pushContent, pushReasoning, setSegments, restore, clear, markDone, commit, stopTimer, startTimer]);
}
