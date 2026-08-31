import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, X } from '../icons.jsx';
import { Switch, SegSlide, SelectRow } from '../settingsui.jsx';
import { t } from '../../i18n.jsx';

export { Switch };

/* ---------- layout ---------- */

// Every page is a stack of cards. A card owns its own padding and internal
// rhythm so a section never reaches for an inline margin.
export function Card({ title, sub, actions, foot, flush, children }) {
  return (
    <section className="cp-card">
      {(title || sub || actions) && (
        <div className="cp-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p className="cp-sub">{sub}</p>}
          </div>
          {actions && <div className="cp-acts">{actions}</div>}
        </div>
      )}
      <div className={'cp-card-body' + (flush ? ' flush' : '')}>{children}</div>
      {foot && <div className="cp-card-foot">{foot}</div>}
    </section>
  );
}

// A list of setting rows. Rows are hairline-separated and share one right edge,
// which is what keeps every control on a page in a single column.
export function Rows({ children }) {
  return <div className="cp-rows">{children}</div>;
}

export function Row({ label, note, wide, children }) {
  return (
    <div className="cp-row">
      <div className="cp-row-main">
        <span className="cp-row-label">{label}</span>
        {note && <div className="cp-row-note">{note}</div>}
      </div>
      <div className={'cp-row-ctrl' + (wide ? ' wide' : '')}>{children}</div>
    </div>
  );
}

// The shape almost every policy setting takes. Having one component for it is
// what makes the switches line up and the copy read the same everywhere.
export function ToggleRow({ label, note, on, onToggle, disabled }) {
  return (
    <Row label={label} note={note}>
      <Switch on={on} label={label} disabled={disabled} onToggle={onToggle} />
    </Row>
  );
}

export function Fields({ cols, children }) {
  return <div className={'cp-fields' + (cols ? ' cols-' + cols : '')}>{children}</div>;
}

export function Field({ label, hint, error, optional, children }) {
  return (
    <div className="cp-field">
      {label && <label>{label}{optional && <span className="opt"> · {t('optional')}</span>}</label>}
      {children}
      {hint && <div className="cp-hint">{hint}</div>}
      {error && <div className="cp-err">{error}</div>}
    </div>
  );
}

// A control with a button beside it — an id with a copy action, a number with a
// detect action. The control takes the space, the button keeps its size.
export function Inline({ children }) {
  return <div className="cp-inline">{children}</div>;
}

export function Acts({ end, children }) {
  return <div className={'cp-acts' + (end ? ' end' : '')}>{children}</div>;
}

/* ---------- controls ---------- */

export function Input({ mono, ...rest }) {
  return <input className={'cp-input' + (mono ? ' mono' : '')} {...rest} />;
}

export function Area({ mono, rows = 5, ...rest }) {
  return <textarea className={'cp-area' + (mono ? ' mono' : '')} rows={rows} {...rest} />;
}

export function Select({ value, onChange, options, disabled, label }) {
  return (
    <div className={'cp-select' + (disabled ? ' off' : '')}>
      <SelectRow label={label} value={value} onPick={onChange}
        options={options.map(o => ({ v: o.value, label: o.label }))} />
    </div>
  );
}

export function Seg({ value, options, onChange, label }) {
  return (
    <SegSlide value={value} label={label} className="cp-segslide"
      options={options.map(o => ({
        v: o.value,
        label: o.badge === undefined ? o.label : <>{o.label}<em className="cp-seg-n">{o.badge}</em></>
      }))} onPick={onChange} />
  );
}

export function Range({ value, min, max, step = 1, onChange, label }) {
  return (
    <input type="range" className="cp-range" min={min} max={max} step={step}
      value={value} aria-label={label} onChange={onChange} />
  );
}

export function Btn({ kind, size, icon, className, children, ...rest }) {
  const cls = ['btn', kind, size, icon && 'icon', className].filter(Boolean).join(' ');
  return <button type="button" className={cls} {...rest}>{children}</button>;
}

// An icon-only button always carries its name for a screen reader and a tooltip
// for everyone else, so the two can never drift apart.
export function IconBtn({ kind, size = 'sm', label, children, ...rest }) {
  return <Btn kind={kind} size={size} icon title={label} aria-label={label} {...rest}>{children}</Btn>;
}

export function CopyBtn({ text, title }) {
  const [ok, setOk] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <IconBtn kind="quiet" label={title || t('Copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text || '');
          setOk(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setOk(false), 1200);
        } catch {}
      }}>
      {ok ? <Check /> : <Copy />}
    </IconBtn>
  );
}

/* ---------- tabs ---------- */

// Arrow keys move between tabs the way the ARIA pattern expects; the active
// underline is painted on the strip so switching never resizes a tab.
export function Tabs({ items, value, onChange, label, panelId }) {
  const ref = useRef(null);

  function onKeyDown(e) {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = items.findIndex(it => it.id === value);
    const next = items[(i + dir + items.length) % items.length];
    onChange(next.id);
    ref.current?.querySelector(`[data-tab="${next.id}"]`)?.focus();
  }

  return (
    <div className="cp-tabs" role="tablist" aria-label={label} ref={ref} onKeyDown={onKeyDown}>
      {items.map(it => {
        const on = it.id === value;
        return (
          <button key={it.id} type="button" role="tab" data-tab={it.id}
            className="cp-tab" aria-selected={on} tabIndex={on ? 0 : -1}
            aria-controls={panelId} onClick={() => onChange(it.id)}>
            {it.Icon && <it.Icon />}
            <span>{it.label}</span>
            {it.count > 0 && <span className="cp-tab-n">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- data display ---------- */

export function Badge({ tone, children }) {
  return <span className={'cp-badge' + (tone ? ' ' + tone : '')}>{children}</span>;
}

export function Table({ head, children, empty, fixed }) {
  return (
    <div className="cp-table-wrap">
      <table className={'cp-table' + (fixed ? ' fixed' : '')}>
        <thead><tr>{head.map((h, i) => (
          <th key={i} scope="col" style={h.width ? { width: h.width } : undefined}
            className={[h.mono && 'mono', h.num && 'num', h.fit && 'fit'].filter(Boolean).join(' ') || undefined}>
            {h.label}
          </th>
        ))}</tr></thead>
        <tbody>
          {children}
          {empty && <tr><td colSpan={head.length} className="dim">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Stats({ items }) {
  return (
    <div className="cp-stats">
      {items.map(s => (
        <div key={s.k} className="cp-stat">
          <div className="cp-stat-k">{s.k}</div>
          <div className="cp-stat-v">{s.v}</div>
          {s.n && <div className="cp-stat-n">{s.n}</div>}
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, actions }) {
  return (
    <div className="cp-empty">
      {Icon && <Icon />}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {actions && <div className="cp-acts">{actions}</div>}
    </div>
  );
}

export function Note({ tone, icon, children }) {
  return (
    <div className={'cp-note' + (tone ? ' ' + tone : '')}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function KV({ items }) {
  return (
    <dl className="cp-kv">
      {items.map(([k, v, mono]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd className={mono ? 'mono' : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// Silent when nothing is happening. A status line that always says something
// trains people to stop reading it.
export function SaveState({ state }) {
  if (state !== 'saving' && state !== 'saved' && state !== 'error') return null;
  return (
    <span className={'cp-state' + (state === 'error' ? ' bad' : '')} role="status">
      <span className={'cp-dot' + (state === 'saving' ? ' pending' : state === 'saved' ? ' live' : ' bad')} />
      {state === 'saving' ? t('Saving') : state === 'saved' ? t('Saved') : t('Not saved')}
    </span>
  );
}

/* ---------- overlays ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIRST_FIELD = 'input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

export function Dialog({ title, size, onClose, foot, children }) {
  const box = useRef(null);
  const titleId = useId();

  // Opening focus and restoring it belong to the dialog's lifetime, not to the
  // identity of onClose. Callers pass an inline arrow, so folding these into the
  // key-handler effect below would re-focus the first field on every keystroke.
  useEffect(() => {
    const restoreTo = document.activeElement;
    // A form dialog opens on its first field; one without fields falls back to
    // its first control, so focus is never left outside the dialog.
    const open = box.current?.querySelector(FIRST_FIELD) || box.current?.querySelector(FOCUSABLE);
    open?.focus();
    return () => {
      if (restoreTo && typeof restoreTo.focus === 'function' && document.contains(restoreTo)) restoreTo.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const items = [...box.current.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const on = document.activeElement;
      if (e.shiftKey && (on === first || !box.current.contains(on))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && on === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="cp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={'cp-dialog' + (size ? ' ' + size : '')}
        role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="cp-dialog-head">
          <h3 id={titleId}>{title}</h3>
          <IconBtn kind="quiet" label={t('Close')} onClick={onClose}><X /></IconBtn>
        </div>
        <div className="cp-dialog-body">{children}</div>
        {foot && <div className="cp-dialog-foot">{foot}</div>}
      </div>
    </div>, document.body);
}

export function Confirm({ ask, onClose }) {
  const [busy, setBusy] = useState(false);
  if (!ask) return null;
  return (
    <Dialog title={ask.title || t('Confirm')} size="narrow" onClose={busy ? () => {} : onClose}
      foot={<>
        <Btn disabled={busy} onClick={onClose}>{t('Cancel')}</Btn>
        <Btn kind="danger" disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await ask.onConfirm(); } finally { setBusy(false); onClose(); }
          }}>
          {ask.confirm || t('Confirm')}
        </Btn>
      </>}>
      {ask.message}
    </Dialog>
  );
}

// A menu anchored to a point rather than an element — the models list opens one
// on right-click. Clicking away, resizing or Escape all dismiss it.
export function PointMenu({ at, onClose, width = 250, anchorEl, children }) {
  useEffect(() => {
    const away = (e) => { if (anchorEl && anchorEl.contains(e.target)) return; onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', away);
    window.addEventListener('resize', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('resize', away);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose, anchorEl]);

  return createPortal(
    <div className="cp-menu" role="menu"
      style={{ position: 'fixed', left: at.x, top: at.y, width }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>, document.body);
}

export function MenuItem({ tone, sub, active, children, ...rest }) {
  const cls = ['cp-menu-item', tone, sub && 'sub', active && 'on'].filter(Boolean).join(' ');
  return <button type="button" role="menuitem" className={cls} {...rest}>{children}</button>;
}

// Keeps a pointer position inside the viewport, so a menu opened near an edge
// is never drawn off-screen.
export function clampToViewport(x, y, w, h) {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - h - 8))
  };
}

/* ---------- helpers ---------- */

export function useAutoFocus() {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

export function fmtInt(n) {
  return Number(n || 0).toLocaleString();
}

export function fmtMoney(v) {
  const n = Number(v) || 0;
  return '$' + n.toFixed(n && n < 0.01 ? 4 : 2);
}

export function fmtAgo(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - (typeof ts === 'number' ? ts : d.getTime());
  if (diff < 60000) return t('just now');
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  if (diff < 2592000000) return Math.floor(diff / 86400000) + 'd';
  return d.toLocaleDateString();
}

export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
