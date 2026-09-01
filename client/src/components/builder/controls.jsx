import { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n.jsx';
import { tokenRefs } from '../../lib/theme/schema.js';
import { X, Check, Refresh } from '../icons.jsx';

/* Controls are deliberately plain: a label, a widget, and a reset affordance
   that appears only once the value has been touched. An admin should be able to
   tell at a glance which properties they have changed and which are still
   whatever the preset decided. */

export function Group({ title, hint, open, onToggle, count, children }) {
  return (
    <section className={'bx-group' + (open ? ' open' : '')}>
      <button type="button" className="bx-group-head" onClick={onToggle} aria-expanded={open}>
        <span className="bx-group-title">{title}</span>
        {count > 0 && <span className="bx-group-n">{count}</span>}
        <span className="bx-group-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="bx-group-body">
          {hint && <p className="bx-hint">{hint}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

export function Field({ label, set, onReset, wide, children }) {
  return (
    <div className={'bx-field' + (wide ? ' wide' : '') + (set ? ' set' : '')}>
      <label className="bx-label">
        <span>{label}</span>
        {set && onReset && (
          <button type="button" className="bx-reset" title={t('Reset to default')} aria-label={t('Reset {name}', { name: label })}
            onClick={onReset}><Refresh /></button>
        )}
      </label>
      <div className="bx-ctrl">{children}</div>
    </div>
  );
}

/* Controls show what the element is doing right now even when the theme has not
   overridden it. The inherited value is rendered dimmed and stays out of the
   document until the admin actually changes it, so "has this been customised"
   remains a straight answer. */

export function Text({ value, onChange, placeholder, base, mono }) {
  const inherited = !value && base;
  return <input className={'bx-input' + (mono ? ' mono' : '') + (inherited ? ' inherited' : '')}
    value={value ?? ''} placeholder={base || placeholder}
    onChange={(e) => onChange(e.target.value)} />;
}

export function Area({ value, onChange, placeholder, rows = 3 }) {
  return <textarea className="bx-area" rows={rows} value={value ?? ''} placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)} />;
}

export function Select({ value, onChange, options, placeholder, base }) {
  const inherited = !value && base;
  const match = inherited ? options.find(o => o.value === base) : null;
  return (
    <select className={'bx-select' + (inherited ? ' inherited' : '')} value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}>
      <option value="">{match ? match.label : (base || placeholder || t('Default'))}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label}
      className={'bx-switch' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span className="bx-switch-dot" />
    </button>
  );
}

// A number that carries a unit. The slider is the fast path and the box is the
// precise one; both write the same string so the document never holds two shapes
// for one property.
export function Num({ value, onChange, min = 0, max = 100, step = 1, unit = 'px', units, base }) {
  const shown = value || '';
  const parsed = parseValue(shown || base, unit);
  const [u, setU] = useState(parsed.unit);
  useEffect(() => { setU(parseValue(value || base, unit).unit); }, [value, base, unit]);
  const inherited = !shown && Number.isFinite(parsed.n);
  // A measured pixel value carries sub-pixel noise the admin has no use for and
  // the box has no room for. Other units keep their precision.
  const n = inherited && parsed.unit === 'px' ? Math.round(parsed.n) : parsed.n;
  const write = (num, useUnit) => {
    if (num === '' || num == null || Number.isNaN(num)) return onChange('');
    onChange(useUnit === 'none' ? String(num) : String(num) + useUnit);
  };
  // The slider can only travel as far as its range, but an inherited value may
  // sit outside it (a sidebar wider than the width slider's ceiling). Widening
  // the track to reach it beats parking the thumb at the end and lying.
  const lo = Math.min(min, Number.isFinite(n) ? Math.floor(n) : min);
  const hi = Math.max(max, Number.isFinite(n) ? Math.ceil(n) : max);
  return (
    <div className={'bx-num' + (inherited ? ' inherited' : '')}>
      <input type="range" className="bx-range" min={lo} max={hi} step={step}
        value={Number.isFinite(n) ? n : lo} onChange={(e) => write(Number(e.target.value), u)} />
      <input type="number" className="bx-numbox" value={Number.isFinite(n) ? n : ''} step={step}
        onChange={(e) => write(e.target.value === '' ? '' : Number(e.target.value), u)} />
      {units && units.length > 1 && (
        <select className="bx-unit" value={u} onChange={(e) => { setU(e.target.value); if (Number.isFinite(n)) write(n, e.target.value); }}>
          {units.map(x => <option key={x} value={x}>{x === 'none' ? '–' : x}</option>)}
        </select>
      )}
    </div>
  );
}

export function parseValue(v, def = 'px') {
  const s = String(v ?? '').trim();
  if (!s) return { n: NaN, unit: def };
  const m = s.match(/^(-?[\d.]+)\s*([a-z%]*)$/i);
  if (!m) return { n: NaN, unit: def };
  return { n: Number(m[1]), unit: m[2] || 'none' };
}

/* ---------- colour ---------- */

const SWATCHES = ['#ffffff', '#f4f3ee', '#d97757', '#c6613f', '#2a78d6', '#4caf7d', '#e2b03f', '#e5484d', '#6f6e66', '#30302e', '#1a1a19', '#000000'];

function toHex(v) {
  const s = String(v || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(s)) return '#' + s.slice(1).split('').map(c => c + c).join('');
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(0, 7);
  return '';
}

export function Color({ value, onChange, allowTokens = true, inherited }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const pop = useRef(null);
  const hex = toHex(value);
  const refs = allowTokens ? tokenRefs('color') : [];

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (btn.current?.contains(e.target) || pop.current?.contains(e.target)) return;
      setOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const rect = open && btn.current ? btn.current.getBoundingClientRect() : null;

  return (
    <div className="bx-color">
      <button type="button" ref={btn} className={'bx-swatch' + (!value && inherited ? ' faded' : '')} onClick={() => setOpen(o => !o)}
        aria-label={t('Pick a color')} aria-expanded={open}>
        <span className="bx-swatch-fill" style={{ background: value || inherited || 'transparent' }} />
      </button>
      <input className="bx-input mono" value={value ?? ''} placeholder={inherited || t('inherit')}
        onChange={(e) => onChange(e.target.value)} />
      {open && rect && createPortal(
        <div ref={pop} className="bx-pop" data-oq-builder="" style={{ position: 'fixed', top: Math.min(rect.bottom + 6, window.innerHeight - 320), left: Math.max(8, rect.left - 180) }}>
          <input type="color" className="bx-colorpick" value={hex || '#888888'} onChange={(e) => onChange(e.target.value)} />
          <div className="bx-swatches">
            {SWATCHES.map(s => (
              <button key={s} type="button" className="bx-sw" style={{ background: s }} title={s}
                aria-label={s} onClick={() => onChange(s)} />
            ))}
          </div>
          <label className="bx-pop-label">{t('Opacity')}</label>
          <AlphaRow value={value} onChange={onChange} />
          {!!refs.length && (
            <>
              <label className="bx-pop-label">{t('Use a global color')}</label>
              <div className="bx-tokens">
                {refs.map(r => (
                  <button key={r.id} type="button" className={'bx-token' + (value === r.value ? ' on' : '')}
                    onClick={() => onChange(r.value)}>
                    <span className="bx-token-dot" style={{ background: r.value }} />
                    {t(r.label)}
                  </button>
                ))}
              </div>
            </>
          )}
          <button type="button" className="bx-pop-clear" onClick={() => { onChange(''); setOpen(false); }}>
            {t('Clear')}
          </button>
        </div>, document.body)}
    </div>
  );
}

// Opacity is expressed by wrapping whatever the value is in color-mix, which
// works for hex, named colours and var() alike, so the builder never has to
// parse a colour in order to fade it.
function AlphaRow({ value, onChange }) {
  const m = String(value || '').match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*transparent\)$/);
  const base = m ? m[1] : (value || '');
  const pct = m ? Number(m[2]) : 100;
  return (
    <input type="range" className="bx-range" min={0} max={100} step={1} value={pct}
      aria-label={t('Opacity')}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!base) return;
        onChange(v >= 100 ? base : `color-mix(in srgb, ${base} ${v}%, transparent)`);
      }} />
  );
}

/* ---------- pickers ---------- */

export function Seg({ value, onChange, options, label, base, allowClear = true }) {
  return (
    <div className="bx-seg" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" title={o.title || o.label}
          className={'bx-seg-btn' + (value === o.value ? ' on' : (!value && base === o.value ? ' inherited' : ''))}
          onClick={() => onChange(allowClear && value === o.value ? '' : o.value)}>
          {o.icon || o.label}
        </button>
      ))}
    </div>
  );
}

// One control for the four sides of a box. Linking is the default because
// matching padding on all sides is what an admin means nine times out of ten.
export function BoxSides({ label, value, onChange, base, max = 80 }) {
  const [linked, setLinked] = useState(() => !value || (value.top === value.right && value.right === value.bottom && value.bottom === value.left));
  const sides = ['top', 'right', 'bottom', 'left'];
  const set = (side, v) => {
    if (linked) onChange({ top: v, right: v, bottom: v, left: v });
    else onChange({ ...value, [side]: v });
  };
  return (
    <div className="bx-box">
      <div className="bx-box-head">
        <span>{label}</span>
        <button type="button" className={'bx-link' + (linked ? ' on' : '')} onClick={() => setLinked(l => !l)}
          title={linked ? t('Edit each side separately') : t('Link all sides')}>
          {linked ? '⛓' : '⛓̸'}
        </button>
      </div>
      {linked ? (
        <Num value={value?.top} base={base?.top} onChange={(v) => set('top', v)} min={0} max={max} units={['px', 'rem', '%', 'none']} />
      ) : (
        <div className="bx-box-grid">
          {sides.map(s => (
            <label key={s} className="bx-box-cell">
              <span>{s[0].toUpperCase()}</span>
              <input className={'bx-numbox' + (!value?.[s] && base?.[s] ? ' inherited' : '')}
                value={value?.[s] ?? ''} placeholder={base?.[s] || t('auto')}
                onChange={(e) => set(s, e.target.value)} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function Dialog({ title, onClose, wide, foot, children }) {
  const id = useId();
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', esc, true);
    return () => document.removeEventListener('keydown', esc, true);
  }, [onClose]);
  return createPortal(
    <div className="bx-scrim" data-oq-builder="" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'bx-dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="bx-dialog-head">
          <h3 id={id}>{title}</h3>
          <button type="button" className="bx-icon" onClick={onClose} aria-label={t('Close')}><X /></button>
        </header>
        <div className="bx-dialog-body">{children}</div>
        {foot && <footer className="bx-dialog-foot">{foot}</footer>}
      </div>
    </div>, document.body);
}

export function Confirm({ title, message, confirmLabel, onConfirm, onClose, danger }) {
  return (
    <Dialog title={title} onClose={onClose}
      foot={<>
        <button type="button" className="bx-btn" onClick={onClose}>{t('Cancel')}</button>
        <button type="button" className={'bx-btn ' + (danger ? 'danger' : 'primary')}
          onClick={() => { onConfirm(); onClose(); }}>{confirmLabel || t('Confirm')}</button>
      </>}>
      <p className="bx-dialog-msg">{message}</p>
    </Dialog>
  );
}

export function Saved({ state }) {
  if (state !== 'saving' && state !== 'saved' && state !== 'error') return null;
  return (
    <span className={'bx-saved' + (state === 'error' ? ' bad' : '')} role="status">
      {state === 'saving' ? t('Saving…') : state === 'saved' ? <><Check /> {t('Saved')}</> : t('Not saved')}
    </span>
  );
}
