import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dismissNotice, pickNotice, subscribeNotices } from '../../lib/notify.js';
import { Alert, ArchiveIcon, Bell, Chat, Check, Clock, Copy, Download, FileText, Fork, Info, Mic, Pin, Sliders, Sparkles, Star, Trash, Upload } from './icons.jsx';

const ICONS = {
  alert: Alert, archive: ArchiveIcon, bell: Bell, chat: Chat, check: Check, clock: Clock, copy: Copy, download: Download,
  file: FileText, fork: Fork, info: Info, mic: Mic, pin: Pin, sliders: Sliders, sparkles: Sparkles, star: Star, trash: Trash, upload: Upload
};
const KIND_ICON = { success: 'check', warn: 'alert', error: 'alert' };
const SPRING_CURVE = 'linear(0, 0.0063, 0.0251 1.7%, 0.0995 3.5%, 0.2173 5.5%, 0.5141 9.6%, 0.7426 13.4%, 0.8988 17.2%, 0.9575 19.4%, 1.0028 21.9%, 1.0372 25%, 1.0505 27.6%, 1.0544 30.3%, 1.0498 33.7%, 1.0193 41.6%, 1.0021 49.6%, 0.9967 57.4%, 0.9979 70.7%, 1)';
const DOT = 38;
const MIN_SHOW = 1400;
const RING = 44;

let springEasing = null;
function spring() {
  if (!springEasing) springEasing = CSS.supports('transition-timing-function', SPRING_CURVE) ? SPRING_CURVE : 'cubic-bezier(.22, 1.2, .36, 1)';
  return springEasing;
}
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sig = (n) => (n ? n.id + ':' + n.rev : '');
const settle = (a) => a.finished.catch(() => {});

function measure(body) {
  const r = body.getBoundingClientRect();
  return { w: Math.ceil(r.width), h: Math.max(DOT, Math.ceil(r.height)) };
}

function Ring({ value }) {
  const spin = typeof value !== 'number';
  const offset = spin ? RING * 0.7 : RING * (1 - Math.max(0, Math.min(1, value)));
  return (
    <svg className={'island-ring' + (spin ? ' spin' : '')} viewBox="0 0 20 20" aria-hidden="true">
      <circle className="island-ring-track" cx="10" cy="10" r="7" />
      <circle className="island-ring-fill" cx="10" cy="10" r="7" strokeDasharray={RING} strokeDashoffset={offset} />
    </svg>
  );
}

export default function Island() {
  const [notices, setNotices] = useState([]);
  const [shown, setShown] = useState(null);
  const [hover, setHover] = useState(false);
  const pill = useRef(null);
  const body = useRef(null);
  const shownRef = useRef(null);
  const target = useRef(null);
  const running = useRef(false);
  const painted = useRef(null);
  const clock = useRef({ sig: '', spent: 0 });

  useEffect(() => subscribeNotices(setNotices), []);
  const current = pickNotice(notices);
  target.current = current;
  const currentSig = sig(current);
  const shownSig = sig(shown);
  const live = shown ? notices.find(n => n.id === shown.id) || shown : null;
  const activities = notices.filter(n => n.sticky).length;
  const extra = shown && shown.sticky ? activities - 1 : 0;
  const waiting = notices.filter(n => !n.sticky).length > 1;

  const paint = (item) => new Promise(resolve => {
    painted.current = resolve;
    shownRef.current = item;
    setShown(item);
  });
  useLayoutEffect(() => {
    const resolve = painted.current;
    if (resolve) { painted.current = null; resolve(); }
  }, [shown]);

  const enter = async (next) => {
    await paint(next);
    const el = pill.current, b = body.current;
    if (!el || !b) return;
    const { w, h } = measure(b);
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    if (reduced()) { await settle(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 })); return; }
    b.animate([{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 240, delay: 200, easing: 'ease-out', fill: 'backwards' });
    await settle(el.animate([
      { width: DOT + 'px', height: DOT + 'px', transform: 'scale(.5)', opacity: 0 },
      { width: DOT + 'px', height: DOT + 'px', transform: 'scale(1)', opacity: 1, offset: 0.2 },
      { width: w + 'px', height: h + 'px', transform: 'scale(1)', opacity: 1 }
    ], { duration: 720, easing: spring() }));
  };

  const morph = async (next) => {
    const el = pill.current, b = body.current;
    const from = el ? el.getBoundingClientRect() : null;
    if (b && !reduced()) await settle(b.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(3px)' }], { duration: 130, easing: 'ease-in', fill: 'forwards' }));
    await paint(next);
    const el2 = pill.current, b2 = body.current;
    if (!el2 || !b2) return;
    b2.getAnimations().forEach(a => a.cancel());
    const { w, h } = measure(b2);
    el2.style.width = w + 'px';
    el2.style.height = h + 'px';
    if (reduced() || !from) return;
    b2.animate([{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 240, delay: 110, easing: 'ease-out', fill: 'backwards' });
    await settle(el2.animate([{ width: from.width + 'px', height: from.height + 'px' }, { width: w + 'px', height: h + 'px' }], { duration: 560, easing: spring() }));
  };

  const leave = async () => {
    const el = pill.current, b = body.current;
    if (el && b && !reduced()) {
      await settle(b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-in', fill: 'forwards' }));
      const r = el.getBoundingClientRect();
      await settle(el.animate([
        { width: r.width + 'px', height: r.height + 'px', transform: 'scale(1)', opacity: 1 },
        { width: DOT + 'px', height: DOT + 'px', transform: 'scale(1)', opacity: 1, offset: 0.62 },
        { width: DOT + 'px', height: DOT + 'px', transform: 'scale(.5)', opacity: 0 }
      ], { duration: 460, easing: 'cubic-bezier(.45, 0, .2, 1)', fill: 'forwards' }));
    } else if (el) {
      await settle(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }));
    }
    setHover(false);
    await paint(null);
  };

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = target.current;
        const prev = shownRef.current;
        if (sig(next) === sig(prev)) break;
        if (!prev) await enter(next);
        else if (!next) await leave();
        else await morph(next);
      }
    } finally {
      running.current = false;
    }
  }, []);
  useEffect(() => { run(); }, [currentSig, run]);

  useEffect(() => {
    if (!shown || shown.sticky) return;
    const c = clock.current;
    if (c.sig !== shownSig) { c.sig = shownSig; c.spent = 0; }
    if (hover) return;
    const limit = waiting ? Math.min(shown.duration, MIN_SHOW) : shown.duration;
    const started = performance.now();
    const timer = setTimeout(() => dismissNotice(shown.id), Math.max(0, limit - c.spent));
    return () => { clearTimeout(timer); c.spent += performance.now() - started; };
  }, [shownSig, hover, waiting]);

  const resync = useCallback(() => {
    const el = pill.current, b = body.current;
    if (!el || !b || running.current) return;
    const from = el.getBoundingClientRect();
    const { w, h } = measure(b);
    if (Math.abs(from.width - w) < 1 && Math.abs(from.height - h) < 1) return;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    if (!reduced()) el.animate([{ width: from.width + 'px', height: from.height + 'px' }, { width: w + 'px', height: h + 'px' }], { duration: 480, easing: spring() });
  }, []);
  useLayoutEffect(() => { resync(); }, [extra, resync]);
  useEffect(() => {
    window.addEventListener('resize', resync);
    return () => window.removeEventListener('resize', resync);
  }, [resync]);

  const clickable = !!live && (!!live.onClick || !live.sticky);
  const activate = () => {
    if (!live) return;
    if (live.onClick) live.onClick();
    if (!live.sticky) dismissNotice(live.id);
  };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    else if (e.key === 'Escape' && live && !live.sticky) { e.preventDefault(); dismissNotice(live.id); }
  };
  const Icon = shown ? ICONS[shown.icon || KIND_ICON[shown.kind]] : null;

  return (
    <div className="island-host" role="status" aria-live="polite">
      {shown && (
        <div ref={pill} className={'island' + (clickable ? ' clickable' : '')} data-kind={shown.kind}
          role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined}
          onClick={clickable ? activate : undefined} onKeyDown={clickable ? onKey : undefined}
          onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
          onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
          <span ref={body} className="island-body">
            {Icon && <span className="island-ico"><Icon /></span>}
            <span className="island-text">{shown.text}</span>
            {live.progress != null && <Ring value={live.progress} />}
            {extra > 0 && <span className="island-count" aria-hidden="true">+{extra}</span>}
          </span>
        </div>
      )}
    </div>
  );
}