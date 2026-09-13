import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const JUMP_DISTANCE = 200;
const AT_BOTTOM = 24;
const FOLLOW_TAU = 85;
const FOLLOW_MAX_DT = 80;

const TOP_GAP = 56;
const BASE_PAD = 96;

const GLIDE_PER_PX = 17;
const GLIDE_MIN = 200;
const GLIDE_MAX = 560;
const GLIDE_GOAL_TAU = 70;
const OVER_CONFIRM = 120;
const OVER_CONFIRM_MS = 26;
const glideEase = (p) => p * p * (3 - 2 * p);

const SMOOTH_MS = GLIDE_MAX + 160;

function snapScroll(v) {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(v * dpr) / dpr;
}

export function useThreadScroll(opts = {}) {
  const canFollow = opts.canFollow;
  const auto = useRef(opts.autoscroll !== false);
  auto.current = opts.autoscroll !== false;

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
  const padTurn = useRef(-1);
  const padSpent = useRef(false);
  const glideRaf = useRef(0);
  const overSeen = useRef(0);
  const still = useRef(null);
  const [showJump, setShowJump] = useState(false);

  const setJump = useCallback((v) => {
    if (v === jumpRef.current) return;
    jumpRef.current = v;
    setShowJump(v);
  }, []);

  const setStill = useCallback((v) => {
    if (still.current === v) return;
    const el = scrollRef.current;
    const thread = el && el.querySelector('.thread');
    if (!thread) { still.current = null; return; }
    still.current = v;
    if (v) thread.dataset.still = '1';
    else delete thread.dataset.still;
  }, []);

  const syncPad = useCallback((hold) => {
    const el = scrollRef.current;
    if (!el) return false;
    const thread = el.querySelector('.thread');
    if (!thread) return false;
    if (!modern.current) {
      if (padH.current !== -1) { padH.current = -1; thread.style.removeProperty('--turn-pad'); still.current = null; delete thread.dataset.still; }
      return false;
    }
    const pad = thread.querySelector(':scope > .thread-pad');
    if (!pad) return false;
    const users = thread.querySelectorAll(':scope > .msg.user');
    const anchor = users[users.length - 1];
    if (users.length !== padTurn.current) {
      padTurn.current = users.length;
      padSpent.current = false;
      padH.current = -1;
    }
    let want = BASE_PAD;
    if (anchor) {
      const below = pad.getBoundingClientRect().top - anchor.getBoundingClientRect().top;
      want = Math.max(BASE_PAD, Math.round(el.clientHeight - TOP_GAP - below));
    }

    if (padSpent.current) {
      want = BASE_PAD;
      lastWant.current = want;
    } else if (padH.current >= 0 && want < padH.current) {
      const confirmed = Math.max(want, lastWant.current);
      lastWant.current = want;
      want = Math.min(padH.current, confirmed);
    } else {
      lastWant.current = want;
    }
    if (want <= BASE_PAD) padSpent.current = true;
    if (Math.abs(want - padH.current) >= 1) {
      padH.current = want;
      thread.style.setProperty('--turn-pad', want + 'px');
    }
    const pinned = want > BASE_PAD;
    if (!pinned || !hold || !anchor || !stick.current || glideRaf.current) return pinned;
    const shift = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - TOP_GAP;
    if (Math.abs(shift) > 0.5) { programmatic.current = true; el.scrollTop = snapScroll(el.scrollTop + shift); }
    return true;
  }, []);

  const endGlide = useCallback(() => {
    if (glideRaf.current) cancelAnimationFrame(glideRaf.current);
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
    let goal = el.scrollHeight - el.clientHeight;
    let last = t0;
    const step = () => {
      const live = scrollRef.current;
      if (!live) { glideRaf.current = 0; smoothUntil.current = 0; return; }
      const now = performance.now();
      const dt = now - t0;
      const rest = live.scrollHeight - live.clientHeight;
      goal += (rest - goal) * (1 - Math.exp(-Math.min(FOLLOW_MAX_DT, now - last) / GLIDE_GOAL_TAU));
      last = now;
      programmatic.current = true;
      if (dt >= run) { live.scrollTop = snapScroll(rest); endGlide(); return; }
      live.scrollTop = snapScroll(from + (goal - from) * glideEase(dt / run));
      glideRaf.current = requestAnimationFrame(step);
    };
    glideRaf.current = requestAnimationFrame(step);
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

  const pinToBottom = useCallback((smooth, delay = 0) => {
    stick.current = true;
    padTurn.current = -1;
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
    setJump(dist > JUMP_DISTANCE && (!stick.current || !auto.current));
  }, [syncPad, setJump]);

  const onScroll = useCallback(() => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(readScroll);
  }, [readScroll]);

  const onWheel = useCallback((e) => { if (e.deltaY < -1) { stick.current = false; endGlide(); } }, [endGlide]);
  const onTouchMove = useCallback(() => { touchDrag.current = true; onScroll(); }, [onScroll]);

  const jumpDown = useCallback(() => {
    setJump(false);
    pinToBottom(true);
  }, [pinToBottom, setJump]);

  const resetJump = useCallback(() => {
    stick.current = true;
    setJump(false);
  }, [setJump]);

  const followStep = useCallback((dt) => {
    const el = scrollRef.current;
    if (!el) return;
    if (!auto.current) setJump(el.scrollHeight - el.scrollTop - el.clientHeight > JUMP_DISTANCE);
    if (!stick.current) { setStill(true); return; }
    if (performance.now() < smoothUntil.current) { setStill(false); return; }
    if (canFollow && !canFollow()) { setStill(true); return; }
    if (syncPad(true)) { setStill(true); return; }
    if (!auto.current) {
      setStill(true);
      if (!glideRaf.current) stick.current = false;
      return;
    }
    setStill(false);

    if (!modern.current) {
      const diff = el.scrollHeight - el.clientHeight - el.scrollTop;
      if (diff > 0.5) { programmatic.current = true; el.scrollTop += Math.max(1, diff * (1 - Math.exp(-dt / FOLLOW_TAU))); }
      return;
    }

    const thread = el.querySelector('.thread');
    if (!thread) return;
    const over = thread.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
    if (over <= 0.5) { overSeen.current = 0; return; }

    if (over > OVER_CONFIRM) {
      const now = performance.now();
      if (!overSeen.current) { overSeen.current = now; return; }
      if (now - overSeen.current < OVER_CONFIRM_MS) return;
    }
    overSeen.current = 0;
    programmatic.current = true;
    el.scrollTop = snapScroll(el.scrollTop + over);
  }, [canFollow, syncPad, setStill, setJump]);

  const followNow = useCallback(() => followStep(FOLLOW_MAX_DT), [followStep]);

  const follow = useCallback(function tick() {
    const now = performance.now();
    const dt = Math.min(FOLLOW_MAX_DT, now - (followTs.current || now));
    followTs.current = now;
    followStep(dt);
    followRaf.current = requestAnimationFrame(tick);
  }, [followStep]);

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
    const release = () => { stick.current = false; setJump(true); };
    window.addEventListener('oq-release-scroll', release);
    return () => window.removeEventListener('oq-release-scroll', release);
  }, [setJump]);

  return useMemo(() => ({
    scrollRef, stick, programmatic, showJump,
    scrollBottom, pinToBottom, onScroll, onWheel, onTouchMove, jumpDown, resetJump,
    startFollow, stopFollow, followNow, syncPad, smoothPending, gliding
  }), [showJump, scrollBottom, pinToBottom, onScroll, onWheel, onTouchMove, jumpDown, resetJump, startFollow, stopFollow, followNow, syncPad, smoothPending, gliding]);
}