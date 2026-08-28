import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Chevron, Check } from './icons.jsx';
import { useAnchoredMenu, menuStyleOf } from '../lib/anchor.js';
import { usePointerDrag, knobRaw, knobTravel, overshoot, stretchFor, squashFor, stretchOrigin, nearestIndex, measureStops, clampPx } from '../lib/dragsteps.js';
import { t } from '../i18n.jsx';

export function SetRow({ label, desc, children }) {
  return (
    <div className="set-row">
      <div className="set-row-main">
        <span className="set-row-title">{label}</span>
        {desc && <span className="set-row-desc">{desc}</span>}
      </div>
      <div className="set-row-ctrl">{children}</div>
    </div>
  );
}

export function RangeRow({ value, min, max, step, def, format, onChange }) {
  return (
    <div className="reveal-row">
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseInt(e.target.value))} />
      <span className="reveal-val">{format(value)}</span>
      <button className={'linklike rv-reset' + (value === def ? ' off' : '')}
        onClick={() => onChange(def)}>{t('Reset')}</button>
    </div>
  );
}

const SWITCH_INSET = 2;
const SWITCH_KNOB = 16;

export function Switch({ on, onToggle, label, title, disabled }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const [origin, setOrigin] = useState('center');

  const track = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const travel = knobTravel(r, SWITCH_INSET, SWITCH_KNOB);
    const raw = knobRaw(e.clientX, r, SWITCH_INSET, SWITCH_KNOB);
    const over = overshoot(raw, 0, travel);
    if (over) setOrigin(stretchOrigin(over));
    const stretch = stretchFor(over, SWITCH_KNOB);
    setDrag({ px: clampPx(raw, 0, travel), mid: travel / 2, stretch, squash: squashFor(stretch) });
  };

  const { bind } = usePointerDrag({
    disabled,
    onTrack: (e, moving) => { if (moving) track(e); else e.currentTarget.focus(); },
    onEnd: (moved, e) => {
      const want = moved && drag ? drag.px > drag.mid : !on;
      setDrag(null);
      if (want !== !!on && onToggle) onToggle(e);
    }
  });

  const shown = drag ? drag.px > drag.mid : !!on;
  return (
    <div
      ref={ref}
      className={'switch' + (shown ? ' on' : '') + (drag ? ' dragging' : '')}
      style={{ '--knob-origin': origin, ...(drag ? { '--knob': drag.px + 'px', '--stretch': drag.stretch, '--squash': drag.squash } : null) }}
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      title={title}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onToggle(e); } }}
      {...bind}
    />
  );
}

export function SwitchRow({ label, desc, on, onToggle }) {
  return (
    <SetRow label={label} desc={desc}>
      <Switch on={on} onToggle={onToggle} label={label} />
    </SetRow>
  );
}

export function SegSlide({ value, options, onPick, label, className }) {
  const wrap = useRef(null);
  const [box, setBox] = useState(null);
  const idx = Math.max(0, options.findIndex(o => o.v === value));
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const hit = el.querySelectorAll('.segs-opt')[idx];
      if (!hit) return;
      setBox({ x: hit.offsetLeft, w: hit.offsetWidth });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [idx, options.length]);
  const [live, setLive] = useState(null);
  const [origin, setOrigin] = useState('center');
  const track = (e) => {
    const el = wrap.current;
    if (!el) return;
    const stops = measureStops(el, '.segs-opt');
    if (!stops.length) return;
    const x = e.clientX - el.getBoundingClientRect().left;
    const i = nearestIndex(stops, x);
    const seat = stops[i];
    const last = stops[stops.length - 1];
    const raw = x - seat.w / 2;
    const min = stops[0].x;
    const max = last.x + last.w - seat.w;
    const over = overshoot(raw, min, max);
    if (over) setOrigin(stretchOrigin(over));
    const stretch = stretchFor(over, seat.w);
    setLive({ x: clampPx(raw, min, max), w: seat.w, stretch, squash: squashFor(stretch) });
    if (options[i] && options[i].v !== value) onPick(options[i].v);
  };
  const { dragging, bind } = usePointerDrag({ onTrack: track, onEnd: () => setLive(null) });
  const at = live || box;
  return (
    <div className={'segs' + (className ? ' ' + className : '')} ref={wrap} role="radiogroup" aria-label={label} {...bind}>
      {at && <span className={'segs-thumb' + (dragging ? ' dragging' : '')}
        style={{ transform: `translateX(${at.x}px) scaleX(${at.stretch || 1}) scaleY(${at.squash || 1})`, width: at.w, transformOrigin: origin }} />}
      {options.map(o => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} title={o.title} aria-label={o.title}
          className={'segs-opt' + (value === o.v ? ' on' : '')} onClick={() => onPick(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function useSelectMenu() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const pos = useAnchoredMenu(open, setOpen, btnRef, menuRef, { minWidth: 224 });
  useEffect(() => {
    if (!open) return;
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [open]);
  return { open, setOpen, btnRef, menuRef, pos };
}

export function SelectRow({ value, options, onPick, label }) {
  const { open, setOpen, btnRef, menuRef, pos } = useSelectMenu();
  const cur = options.find(o => o.v === value) || options[0];
  return (
    <div className={'set-select' + (open ? ' open' : '')}>
      <button ref={btnRef} type="button" className="set-select-trigger" aria-haspopup="listbox" aria-expanded={open}
        aria-label={label} onClick={() => setOpen(o => !o)}>
        <span style={cur && cur.font ? { fontFamily: cur.font } : undefined}>{cur ? cur.label : ''}</span>
        <Chevron style={{ width: 14 }} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="set-select-menu portal" role="listbox" style={menuStyleOf(pos, { minWidth: 224 })}>
          {options.map(o => (
            <button key={o.v} type="button" role="option" aria-selected={o.v === value}
              className={'set-select-opt' + (o.v === value ? ' on' : '')}
              style={o.font ? { fontFamily: o.font } : undefined}
              onClick={() => { onPick(o.v); setOpen(false); }}>
              <span>{o.label}</span>
              {o.v === value && <Check />}
            </button>
          ))}
        </div>, document.body)}
    </div>
  );
}
