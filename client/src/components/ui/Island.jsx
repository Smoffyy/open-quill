import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dismissNotice, pickNotice, subscribeNotices } from '../../lib/notify.js';
import { createLiquid, isResting, leaveLiquid, liquidShape, retarget, settleLiquid, stepLiquid } from '../../lib/liquid.js';
import { Alert, ArchiveIcon, Bell, Chat, Check, Clock, Copy, Download, FileText, Fork, Info, Mic, Pin, Sliders, Sparkles, Star, Trash, Upload } from './icons.jsx';

const ICONS = {
  alert: Alert, archive: ArchiveIcon, bell: Bell, chat: Chat, check: Check, clock: Clock, copy: Copy, download: Download,
  file: FileText, fork: Fork, info: Info, mic: Mic, pin: Pin, sliders: Sliders, sparkles: Sparkles, star: Star, trash: Trash, upload: Upload
};
const KIND_ICON = { success: 'check', warn: 'alert', error: 'alert' };
const MIN_H = 38;
const HANG = 20;
const DENT_SPREAD = 64;
const MIN_SHOW = 1400;
const RING = 44;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sig = (n) => (n ? n.id + ':' + n.rev : '');
const settle = (a) => a.finished.catch(() => {});
const px = (n) => n + 'px';

function frameGap() {
  if (window.matchMedia('(max-width: 768px)').matches) return null;
  if (document.querySelector('.app.has-bg, .app-incognito')) return null;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--frame-gap')) || null;
}

function measure(body) {
  const r = body.getBoundingClientRect();
  return { w: Math.ceil(r.width), h: Math.max(MIN_H, Math.ceil(r.height)) };
}

function draw(canvas, shape, color) {
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  const cx = w / 2;
  if (shape.dent !== null) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    for (let x = w; x >= 0; x -= 3) {
      const k = (x - cx) / DENT_SPREAD;
      ctx.lineTo(x, shape.line + shape.dent * Math.exp(-k * k));
    }
    ctx.closePath();
    ctx.fill();
  }
  const n = shape.neck;
  if (n) {
    const hw = n.waist / 2;
    const top = hw + 10, bottom = Math.min(n.base * 0.95, hw + 8);
    ctx.beginPath();
    ctx.moveTo(cx - top, n.top);
    ctx.bezierCurveTo(cx - hw, n.top, cx - hw, n.bottom, cx - bottom, n.bottom);
    ctx.lineTo(cx + bottom, n.bottom);
    ctx.bezierCurveTo(cx + hw, n.bottom, cx + hw, n.top, cx + top, n.top);
    ctx.closePath();
    ctx.fill();
  }
  const d = shape.drop;
  if (d) {
    ctx.beginPath();
    if (d.pill) ctx.roundRect(cx - d.w / 2, d.y, d.w, d.h, d.radius);
    else ctx.ellipse(cx, d.y, Math.max(0, d.rx), Math.max(0, d.ry), 0, 0, Math.PI * 2);
    ctx.fill();
  }
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
  const canvas = useRef(null);
  const pill = useRef(null);
  const body = useRef(null);
  const sim = useRef(null);
  const color = useRef('#000');
  const frame = useRef(0);
  const waiters = useRef([]);
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

  const render = () => {
    if (canvas.current && sim.current) draw(canvas.current, liquidShape(sim.current), color.current);
  };

  const check = () => {
    const s = sim.current;
    waiters.current = waiters.current.filter(w => {
      if (!s || !w.until(s)) return true;
      w.resolve();
      return false;
    });
  };

  const wake = () => {
    if (frame.current) return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const s = sim.current;
      const active = s ? stepLiquid(s, (now - last) / 1000) : false;
      last = now;
      render();
      check();
      frame.current = active ? requestAnimationFrame(tick) : 0;
    };
    frame.current = requestAnimationFrame(tick);
  };

  const until = (cond) => new Promise(resolve => {
    waiters.current.push({ until: cond, resolve });
    check();
  });

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const enter = async (next) => {
    await paint(next);
    const el = pill.current, b = body.current, c = canvas.current;
    if (!el || !b || !c) return;
    const gap = frameGap();
    const line = gap === null ? 0 : gap - 3;
    const rest = gap === null ? 0 : gap + HANG;
    const { w, h } = measure(b);
    el.style.top = px(rest);
    el.style.width = px(w);
    el.style.height = px(h);
    color.current = getComputedStyle(c).color;
    sim.current = createLiquid({ line, rest, width: w, height: h, attached: gap !== null });
    if (reduced()) {
      settleLiquid(sim.current);
      render();
      await settle(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }));
      return;
    }
    el.style.opacity = '0';
    wake();
    await until(s => s.phase === 'pill');
    el.style.opacity = '';
    el.animate([{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 260, easing: 'ease-out' });
    await until(isResting);
  };

  const morph = async (next) => {
    const b = body.current;
    if (b && !reduced()) await settle(b.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(3px)' }], { duration: 130, easing: 'ease-in', fill: 'forwards' }));
    await paint(next);
    const el = pill.current, b2 = body.current, s = sim.current;
    if (!el || !b2 || !s) return;
    b2.getAnimations().forEach(a => a.cancel());
    const { w, h } = measure(b2);
    el.style.width = px(w);
    el.style.height = px(h);
    retarget(s, w, h);
    if (reduced()) { settleLiquid(s); render(); return; }
    b2.animate([{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 240, delay: 120, easing: 'ease-out', fill: 'backwards' });
    wake();
    await until(isResting);
  };

  const leave = async () => {
    const el = pill.current, s = sim.current;
    if (el) await settle(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'forwards' }));
    if (s && !reduced()) {
      leaveLiquid(s);
      wake();
      await until(x => x.phase === 'gone');
    }
    sim.current = null;
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
    const el = pill.current, b = body.current, s = sim.current;
    if (!el || !b || !s || running.current) return;
    const { w, h } = measure(b);
    el.style.width = px(w);
    el.style.height = px(h);
    retarget(s, w, h);
    if (reduced()) { settleLiquid(s); render(); return; }
    wake();
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
      {shown && <canvas ref={canvas} className="island-liquid" aria-hidden="true" />}
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