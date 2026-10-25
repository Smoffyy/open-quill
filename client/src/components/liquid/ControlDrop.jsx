import { useRef, useState } from 'react';
import LiquidBuds, { BUD_GAP, BUD_SIZE } from './LiquidBuds.jsx';
import { capture, panelRect, usePull } from './usePull.jsx';
import { gridTargets } from '../../lib/liquid.js';
import { t } from '../../i18n.jsx';

const FIRE = 36;
const RESIST = 0.55;
const TAIL = 14;

function plan(count, grip) {
  const r = panelRect();
  const g = grip.getBoundingClientRect();
  const source = { x: g.left + g.width / 2, y: r.top - 1, nx: 0, ny: 1 };
  const targets = gridTargets({
    count, cols: Math.max(3, Math.ceil(count / 3)), gap: BUD_GAP, size: BUD_SIZE,
    x: source.x, y: source.y + 46, rowStep: BUD_GAP, width: window.innerWidth
  });
  const bottom = Math.max(...targets.map(p => p.y)) + BUD_SIZE / 2 + TAIL;
  return { source, targets, top: g.top, reach: Math.max(FIRE, bottom - g.top) };
}

function shownAt(geo, extent) {
  return geo.targets.filter(p => p.y - BUD_SIZE / 2 <= geo.top + extent).length;
}

export default function ControlDrop({ items }) {
  const [open, setOpen] = useState(false);
  const [geo, setGeo] = useState(null);
  const [limit, setLimit] = useState(Infinity);
  const [keyboard, setKeyboard] = useState(false);
  const zone = useRef(null);
  const grip = useRef(null);
  const pull = usePull('var(--sidebar)', { rim: 'var(--frame-edge, var(--border-soft))' });

  const slide = (y) => {
    if (grip.current) grip.current.style.transform = y ? 'translateY(' + y + 'px)' : '';
  };

  const show = (next, viaKeyboard) => {
    setGeo(next);
    setKeyboard(viaKeyboard);
    setLimit(Infinity);
    setOpen(true);
    slide(next.reach);
  };

  const hide = () => {
    setOpen(false);
    slide(0);
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    const wasOpen = open;
    const shade = wasOpen ? geo : plan(items.length, grip.current);
    const start = wasOpen ? shade.reach : 0;
    const x0 = e.clientX, y0 = e.clientY;
    let extent = start;
    let moved = false;
    let poured = wasOpen;
    capture(zone.current, e.pointerId);
    zone.current.classList.add('pulling');
    if (!wasOpen) pull.begin(shade.source);
    const move = (ev) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) moved = true;
      extent = Math.min(Math.max(start + ev.clientY - y0, 0), shade.reach);
      if (extent < FIRE) {
        slide(extent * (poured ? 1 : RESIST));
        if (poured) {
          poured = false;
          setOpen(false);
          pull.begin(shade.source);
        }
        pull.update(extent);
        return;
      }
      slide(extent);
      if (!poured) {
        poured = true;
        pull.end(false);
        setGeo(shade);
        setKeyboard(false);
        setOpen(true);
      }
      setLimit(shownAt(shade, extent));
    };
    const up = () => {
      zone.current?.removeEventListener('pointermove', move);
      zone.current?.removeEventListener('pointerup', up);
      zone.current?.removeEventListener('pointercancel', up);
      zone.current?.classList.remove('pulling');
      if (!poured) pull.end(false);
      const keep = moved ? extent > (wasOpen ? shade.reach - FIRE : FIRE) : !wasOpen;
      if (keep) show(shade, false);
      else hide();
    };
    zone.current.addEventListener('pointermove', move);
    zone.current.addEventListener('pointerup', up);
    zone.current.addEventListener('pointercancel', up);
  };

  return (
    <>
      <div ref={zone} className={'cd-zone' + (open ? ' open' : '')} onPointerDown={onDown}>
        <button ref={grip} type="button" className="cd-grip" aria-label={t('Quick controls')} aria-expanded={open} data-tip={t('Quick controls')}
          onClick={(e) => {
            if (e.detail !== 0) return;
            if (open) hide();
            else show(plan(items.length, grip.current), true);
          }}>
          <span className={'lq-hint ' + (open ? 'up' : 'down')} aria-hidden="true" />
        </button>
      </div>
      {pull.node}
      {geo && (
        <LiquidBuds open={open} limit={limit} source={geo.source} targets={geo.targets} items={items} color="var(--sidebar)" rim="var(--frame-edge, var(--border-soft))"
          label={t('Quick controls')} trigger={zone} focusFirst={keyboard} onClose={hide} />
      )}
    </>
  );
}