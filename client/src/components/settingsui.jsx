import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Chevron, Check } from './icons.jsx';
import { useAnchoredMenu, menuStyleOf } from '../lib/anchor.js';

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

export function SwitchRow({ label, desc, on, onToggle }) {
  return (
    <SetRow label={label} desc={desc}>
      <div
        className={'switch' + (on ? ' on' : '')}
        role="switch"
        aria-checked={!!on}
        aria-label={label}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(e); } }}
      />
    </SetRow>
  );
}

export function SegSlide({ value, options, onPick, label }) {
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
  return (
    <div className="segs" ref={wrap} role="radiogroup" aria-label={label}>
      {box && <span className="segs-thumb" style={{ transform: `translateX(${box.x}px)`, width: box.w }} />}
      {options.map(o => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v}
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
