import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeAtCursor, placeTip, TIP_DELAY } from '../../lib/tip.js';

export default function TipLayer() {
  const [active, setActive] = useState(null);
  const [pos, setPos] = useState(null);
  const tipRef = useRef(null);
  const timer = useRef(0);
  const current = useRef(null);
  const pinned = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const source = useRef(null);

  useEffect(() => {
    const trigger = (node) => (node && node.closest ? node.closest('[data-tip]') : null);
    const close = () => {
      clearTimeout(timer.current);
      if (current.current) current.current.toggleAttribute('data-tip-pinned', false);
      current.current = null;
      pinned.current = false;
      setActive(null);
      setPos(null);
    };
    const open = (el) => {
      if (el === current.current) return;
      close();
      current.current = el;
      timer.current = setTimeout(() => setActive(el), TIP_DELAY);
    };
    const pin = (el) => {
      clearTimeout(timer.current);
      if (el !== current.current) {
        close();
        current.current = el;
      }
      pinned.current = true;
      source.current = 'pointer';
      el.toggleAttribute('data-tip-pinned', true);
      setActive(el);
    };
    const onOver = (e) => {
      const el = trigger(e.target);
      if (!el || (pinned.current && el === current.current)) return;
      source.current = 'pointer';
      open(el);
    };
    const onMove = (e) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      if (!tipRef.current || !current.current || pinned.current || source.current !== 'pointer') return;
      setPos(placeAtCursor({
        x: e.clientX, y: e.clientY, width: tipRef.current.offsetWidth, height: tipRef.current.offsetHeight,
        vw: window.innerWidth, vh: window.innerHeight
      }));
    };
    const onOut = (e) => {
      const el = current.current;
      if (el && !pinned.current && !el.contains(e.relatedTarget)) close();
    };
    const onDown = (e) => {
      if (pinned.current && current.current && current.current.contains(e.target)) return;
      close();
    };
    const onClick = (e) => {
      const el = trigger(e.target);
      if (!el || !el.hasAttribute('data-tip-toggle')) return;
      if (pinned.current && el === current.current) close();
      else pin(el);
    };
    const onFocus = (e) => {
      const el = trigger(e.target);
      if (!el || !el.matches(':focus-visible')) return;
      source.current = 'focus';
      open(el);
    };
    const onBlur = (e) => {
      if (current.current && current.current === trigger(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('click', onClick);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('click', onClick);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, []);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!active || !tip) return;
    const size = { width: tip.offsetWidth, height: tip.offsetHeight, vw: window.innerWidth, vh: window.innerHeight };
    setPos(source.current === 'pointer'
      ? placeAtCursor({ x: pointer.current.x, y: pointer.current.y, ...size })
      : placeTip({ anchor: active.getBoundingClientRect(), ...size }));
  }, [active]);

  const label = active && active.isConnected ? active.getAttribute('data-tip') : null;
  if (!label) return null;
  const keys = active.getAttribute('data-tip-keys');
  const tone = active.getAttribute('data-tip-tone');
  return createPortal(
    <div className={'tip' + (tone ? ' tip-' + tone : '')} role="tooltip" ref={tipRef}
      style={{ top: pos ? pos.top : 0, left: pos ? pos.left : 0, opacity: pos ? undefined : 0, pointerEvents: 'none' }}>
      <span className="tip-label">{label}</span>
      {keys && <span className="tip-keys">{keys}</span>}
    </div>, document.body);
}