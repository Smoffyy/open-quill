import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const JUMP_DISTANCE = 200;
const AT_BOTTOM = 24;
const FOLLOW_TAU = 85;
const FOLLOW_MAX_DT = 80;

// A sent message climbs to the top of the thread and stays there while the
// reply is written under it, which only works if there is somewhere to scroll
// to. The bottom spacer grows to exactly the room the newest exchange is short
// of a screen, so "scroll to the bottom" and "put the newest message at the
// top" are the same position; as the reply fills that room the spacer gives it
// back, and the message holds still without anything having to hold it. Once
// the reply is taller than a screen the spacer is back to its resting height
// and following the bottom is ordinary again.
const TOP_GAP = 56;
const BASE_PAD = 96;
// Following the bottom by easing exists to absorb the jump a whole paragraph
// makes when a fast model catches up. A single line arriving is not that: eased,
// it drags the reply's last element down and pulls it back over the next tenth
// of a second, once per line, which is a shiver rather than a scroll. Anything
// this size or under is followed exactly, in the frame it lands.
const FOLLOW_SNAP = 60;
// The glide that carries a sent message to the top: Chrome's own smooth-scroll
// shape, measured. About 17ms per square root pixel, easing out, and it never
// runs past its resting place on the way.
const GLIDE_PER_PX = 17;
const GLIDE_MIN = 180;
const GLIDE_MAX = 520;
// The follow loop stands aside for a glide, and so does the layout effect that
// keeps a sticking thread pinned to the bottom.
const SMOOTH_MS = GLIDE_MAX + 160;

export function useThreadScroll(opts = {}) {
  const canFollow = opts.canFollow;
  // The modern thread motion: the newest message pinned to the top, the glide
  // that puts it there, and a single line followed exactly rather than eased.
  const modern = useRef(!!opts.modern);
  modern.current = !!opts.modern;
  const scrollRef = useRef(null);
  const stick = useRef(true);
  const programmatic = useRef(false);
  const lastTop = useRef(0);
  const scrollRaf = useRef(0);
  const jumpRef = useRef(false);
  const touchDrag = useRef(false);
  const followRaf = useRef(0);
  const followTs = useRef(0);
  const smoothUntil = useRef(0);
  const padH = useRef(-1);
  const lastWant = useRef(0);
  const glideRaf = useRef(0);
  const [showJump, setShowJump] = useState(false);

  // Cheap enough to run on every scroll and every follow frame, and it has to:
  // the spacer is only correct if it is recomputed before anything reads
  // scrollHeight. Returns whether there is reserved room left, which is the
  // same question as whether the newest message is still pinned.
  //
  // `hold` asks it to place the view as well as measure it. While the room is
  // there the view is positioned by the message rather than by the bottom, and
  // that is not a preference: a code block halfway through its first render
  // measures a couple of hundred pixels too tall for one frame, and a view
  // anchored to the bottom answers that by throwing the whole thread down the
  // screen and pulling it back. Anchored to the message, the same bad frame
  // costs nothing.
  const syncPad = useCallback((hold) => {
    const el = scrollRef.current;
    if (!el) return false;
    const thread = el.querySelector('.thread');
    if (!thread) return false;
    if (!modern.current) {
      if (padH.current !== -1) { padH.current = -1; thread.style.removeProperty('--turn-pad'); delete thread.dataset.pinned; }
      return false;
    }
    const pad = thread.querySelector(':scope > .thread-pad');
    if (!pad) return false;
    const users = thread.querySelectorAll(':scope > .msg.user');
    const anchor = users[users.length - 1];
    let want = BASE_PAD;
    if (anchor) {
      const below = pad.getBoundingClientRect().top - anchor.getBoundingClientRect().top;
      want = Math.max(BASE_PAD, Math.round(el.clientHeight - TOP_GAP - below));
    }
    // A block halfway through its first render can measure a couple of hundred
    // pixels too tall, and a spacer that believes it shrinks the room out from
    // under the message: the view hits the bottom of a document that is briefly
    // too short and the whole thread lurches. Taking room is immediate, giving
    // it back waits for a second frame to say the same thing. A frame's worth of
    // room too much costs nothing, because the view is placed by the message.
    if (padH.current >= 0 && want < padH.current) {
      const confirmed = Math.max(want, lastWant.current);
      lastWant.current = want;
      want = Math.min(padH.current, confirmed);
    } else {
      lastWant.current = want;
    }
    if (Math.abs(want - padH.current) >= 1) {
      padH.current = want;
      thread.style.setProperty('--turn-pad', want + 'px');
      // While there is reserved room left, the newest message is holding still
      // and anything under it may animate its own way down. Once the room is
      // spent the thread itself is moving and a second animation only fights it.
      if (want > BASE_PAD) thread.dataset.pinned = '1';
      else delete thread.dataset.pinned;
    }
    const pinned = want > BASE_PAD;
    if (!pinned || !hold || !anchor || !stick.current || glideRaf.current) return pinned;
    const shift = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - TOP_GAP;
    if (Math.abs(shift) > 0.5) { programmatic.current = true; el.scrollTop += shift; }
    return true;
  }, []);

  const endGlide = useCallback(() => {
    if (!glideRaf.current) return;
    cancelAnimationFrame(glideRaf.current);
    glideRaf.current = 0;
    smoothUntil.current = 0;
  }, []);

  const glide = useCallback((el) => {
    endGlide();
    syncPad();
    const from = el.scrollTop;
    const dist = el.scrollHeight - el.clientHeight - from;
    if (dist < 2) { programmatic.current = true; el.scrollTop = el.scrollHeight; return; }
    const run = Math.max(GLIDE_MIN, Math.min(GLIDE_MAX, Math.round(Math.sqrt(dist) * GLIDE_PER_PX)));
    const t0 = performance.now();
    smoothUntil.current = t0 + run + 60;
    // The resting place is read again every frame: the reply's own placeholder
    // arrives mid-glide and the spacer gives back exactly as much room, so a
    // target captured at the start is stale before the glide lands on it.
    const step = () => {
      const live = scrollRef.current;
      if (!live) { glideRaf.current = 0; smoothUntil.current = 0; return; }
      const dt = performance.now() - t0;
      const goal = live.scrollHeight - live.clientHeight;
      programmatic.current = true;
      if (dt >= run) { live.scrollTop = goal; endGlide(); return; }
      live.scrollTop = from + (goal - from) * (1 - Math.pow(1 - dt / run, 2.2));
      glideRaf.current = requestAnimationFrame(step);
    };
    step();
  }, [endGlide, syncPad]);

  const scrollBottom = useCallback((smooth) => {
    const el = scrollRef.current;
    if (!el) return;
    if (smooth && modern.current) { glide(el); return; }
    endGlide();
    // While there is reserved room, the bottom is not where the view belongs.
    if (syncPad(true)) return;
    programmatic.current = true;
    smoothUntil.current = smooth ? performance.now() + SMOOTH_MS : 0;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, [glide, endGlide, syncPad]);

  // Claimed before React commits, not when the timer fires: the layout effect
  // that keeps a sticking thread at the bottom runs in between, and it has to
  // know the jump it is about to make is the start of a glide, not the end of
  // one.
  const pinToBottom = useCallback((smooth, delay = 0) => {
    stick.current = true;
    if (smooth) smoothUntil.current = performance.now() + delay + SMOOTH_MS;
    if (delay > 0) setTimeout(() => scrollBottom(smooth), delay);
    else scrollBottom(smooth);
  }, [scrollBottom]);

  const smoothPending = useCallback(() => performance.now() < smoothUntil.current, []);
  const gliding = useCallback(() => glideRaf.current !== 0, []);

  const readScroll = useCallback(() => {
    scrollRaf.current = 0;
    const el = scrollRef.current;
    if (!el) return;
    syncPad();
    const top = el.scrollTop;
    const dist = el.scrollHeight - top - el.clientHeight;
    if (touchDrag.current) { touchDrag.current = false; if (dist > AT_BOTTOM) stick.current = false; }
    // The settle at the end of a glide runs upwards, which is the one thing
    // that otherwise means "the user scrolled away".
    if (programmatic.current || performance.now() < smoothUntil.current) { programmatic.current = false; lastTop.current = top; return; }
    if (top < lastTop.current - 1) stick.current = false;
    else if (dist < AT_BOTTOM) stick.current = true;
    lastTop.current = top;
    const jump = dist > JUMP_DISTANCE && !stick.current;
    if (jump !== jumpRef.current) { jumpRef.current = jump; setShowJump(jump); }
  }, [syncPad]);

  const onScroll = useCallback(() => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(readScroll);
  }, [readScroll]);

  const onWheel = useCallback((e) => { if (e.deltaY < -1) { stick.current = false; endGlide(); } }, [endGlide]);
  const onTouchMove = useCallback(() => { touchDrag.current = true; onScroll(); }, [onScroll]);

  const jumpDown = useCallback(() => {
    jumpRef.current = false;
    setShowJump(false);
    pinToBottom(true);
  }, [pinToBottom]);

  const resetJump = useCallback(() => {
    stick.current = true;
    jumpRef.current = false;
    setShowJump(false);
  }, []);

  const follow = useCallback(function tick() {
    const el = scrollRef.current;
    const now = performance.now();
    const dt = Math.min(FOLLOW_MAX_DT, now - (followTs.current || now));
    followTs.current = now;
    if (el && stick.current && now >= smoothUntil.current && (!canFollow || canFollow()) && !syncPad(true)) {
      const target = el.scrollHeight - el.clientHeight;
      const diff = target - el.scrollTop;
      if (diff > 0.5) {
        programmatic.current = true;
        const eased = Math.max(1, diff * (1 - Math.exp(-dt / FOLLOW_TAU)));
        el.scrollTop = el.scrollTop + (modern.current && diff <= FOLLOW_SNAP ? diff : eased);
      }
    }
    followRaf.current = requestAnimationFrame(tick);
  }, [canFollow, syncPad]);

  const startFollow = useCallback(() => {
    cancelAnimationFrame(followRaf.current);
    followTs.current = 0;
    follow();
  }, [follow]);

  const stopFollow = useCallback(() => {
    cancelAnimationFrame(followRaf.current);
    followRaf.current = 0;
  }, []);

  useEffect(() => () => { stopFollow(); cancelAnimationFrame(glideRaf.current); }, [stopFollow]);

  useEffect(() => {
    const release = () => { stick.current = false; jumpRef.current = true; setShowJump(true); };
    window.addEventListener('oq-release-scroll', release);
    return () => window.removeEventListener('oq-release-scroll', release);
  }, []);

  return useMemo(() => ({
    scrollRef, stick, programmatic, showJump,
    scrollBottom, pinToBottom, onScroll, onWheel, onTouchMove, jumpDown, resetJump,
    startFollow, stopFollow, syncPad, smoothPending, gliding
  }), [showJump, scrollBottom, pinToBottom, onScroll, onWheel, onTouchMove, jumpDown, resetJump, startFollow, stopFollow, syncPad, smoothPending, gliding]);
}
