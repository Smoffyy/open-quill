import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const JUMP_DISTANCE = 200;
const AT_BOTTOM = 24;
const FOLLOW_TAU = 85;
const FOLLOW_MAX_DT = 80;

export function useThreadScroll(opts = {}) {
  const canFollow = opts.canFollow;
  const scrollRef = useRef(null);
  const stick = useRef(true);
  const programmatic = useRef(false);
  const lastTop = useRef(0);
  const scrollRaf = useRef(0);
  const jumpRef = useRef(false);
  const touchDrag = useRef(false);
  const followRaf = useRef(0);
  const followTs = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const scrollBottom = useCallback((smooth) => {
    const el = scrollRef.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const pinToBottom = useCallback((smooth, delay = 0) => {
    stick.current = true;
    if (delay > 0) setTimeout(() => scrollBottom(smooth), delay);
    else scrollBottom(smooth);
  }, [scrollBottom]);

  const readScroll = useCallback(() => {
    scrollRaf.current = 0;
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const dist = el.scrollHeight - top - el.clientHeight;
    const jump = dist > JUMP_DISTANCE;
    if (jump !== jumpRef.current) { jumpRef.current = jump; setShowJump(jump); }
    if (touchDrag.current) { touchDrag.current = false; if (dist > AT_BOTTOM) stick.current = false; }
    if (programmatic.current) { programmatic.current = false; lastTop.current = top; return; }
    if (top < lastTop.current - 1) stick.current = false;
    else if (dist < AT_BOTTOM) stick.current = true;
    lastTop.current = top;
  }, []);

  const onScroll = useCallback(() => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(readScroll);
  }, [readScroll]);

  const onWheel = useCallback((e) => { if (e.deltaY < -1) stick.current = false; }, []);
  const onTouchMove = useCallback(() => { touchDrag.current = true; onScroll(); }, [onScroll]);

  const jumpDown = useCallback(() => {
    jumpRef.current = false;
    setShowJump(false);
    pinToBottom(true);
  }, [pinToBottom]);

  const follow = useCallback(function tick() {
    const el = scrollRef.current;
    const now = performance.now();
    const dt = Math.min(FOLLOW_MAX_DT, now - (followTs.current || now));
    followTs.current = now;
    if (el && stick.current && (!canFollow || canFollow())) {
      const target = el.scrollHeight - el.clientHeight;
      const diff = target - el.scrollTop;
      if (diff > 0.5) {
        programmatic.current = true;
        el.scrollTop = el.scrollTop + Math.max(1, diff * (1 - Math.exp(-dt / FOLLOW_TAU)));
      }
    }
    followRaf.current = requestAnimationFrame(tick);
  }, [canFollow]);

  const startFollow = useCallback(() => {
    cancelAnimationFrame(followRaf.current);
    followTs.current = 0;
    follow();
  }, [follow]);

  const stopFollow = useCallback(() => {
    cancelAnimationFrame(followRaf.current);
    followRaf.current = 0;
  }, []);

  useEffect(() => stopFollow, [stopFollow]);

  useEffect(() => {
    const release = () => { stick.current = false; jumpRef.current = true; setShowJump(true); };
    window.addEventListener('oq-release-scroll', release);
    return () => window.removeEventListener('oq-release-scroll', release);
  }, []);

  return useMemo(() => ({
    scrollRef, stick, programmatic, showJump,
    scrollBottom, pinToBottom, onScroll, onWheel, onTouchMove, jumpDown,
    startFollow, stopFollow
  }), [showJump, scrollBottom, pinToBottom, onScroll, onWheel, onTouchMove, jumpDown, startFollow, stopFollow]);
}
