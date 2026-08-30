import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, X } from '../icons.jsx';
import { Switch, SegSlide, SelectRow } from '../settingsui.jsx';
import { t } from '../../i18n.jsx';

export { Switch };

export function Block({ title, sub, actions, children }) {
  return (
    <section className="cp-block">
      {(title || actions) && (
        <div className="cp-block-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p className="cp-sub">{sub}</p>}
          </div>
          {actions && <div className="cp-acts">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Row({ label, note, children }) {
  return (
    <div className="cp-row">
      <div className="cp-row-main">
        <span className="cp-row-label">{label}</span>
        {note && <div className="cp-row-note">{note}</div>}
      </div>
      <div className="cp-row-ctrl">{children}</div>
    </div>
  );
}

export function Fields({ cols, children }) {
  return <div className={'cp-fields' + (cols ? ' cols-' + cols : '')}>{children}</div>;
}

export function Field({ label, hint, error, optional, children }) {
  return (
    <div className="cp-field">
      {label && <label>{label}{optional && <span className="opt"> {t('optional')}</span>}</label>}
      {children}
      {hint && <div className="cp-hint">{hint}</div>}
      {error && <div className="cp-err">{error}</div>}
    </div>
  );
}

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

export function Btn({ kind, size, children, ...rest }) {
  const cls = ['btn', kind, size].filter(Boolean).join(' ');
  return <button type="button" className={cls} {...rest}>{children}</button>;
}

export function Badge({ tone, children }) {
  return <span className={'cp-badge' + (tone ? ' ' + tone : '')}>{children}</span>;
}

export function Table({ head, children, empty, fixed }) {
  return (
    <div className="cp-table-wrap">
      <table className={'cp-table' + (fixed ? ' fixed' : '')}>
        <thead><tr>{head.map((h, i) => (
          <th key={i} style={h.width ? { width: h.width } : undefined}
            className={[h.mono && 'mono', h.num && 'num', h.fit && 'fit'].filter(Boolean).join(' ') || undefined}>{h.label}</th>
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

export function Empty({ title, children, actions }) {
  return (
    <div className="cp-empty">
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
    <span className={'cp-save' + (state === 'error' ? ' bad' : '')}>
      <span className={'cp-dot' + (state === 'saving' ? ' pending' : state === 'saved' ? ' live' : '')} />
      {state === 'saving' ? t('Saving') : state === 'saved' ? t('Saved') : t('Not saved')}
    </span>
  );
}

export function CopyBtn({ text, title }) {
  const [ok, setOk] = useState(false);
  return (
    <Btn kind="quiet" size="sm" title={title || t('Copy')} aria-label={title || t('Copy')}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text || ''); setOk(true); setTimeout(() => setOk(false), 1200); } catch {}
      }}>
      {ok ? <Check /> : <Copy />}
    </Btn>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, size, onClose, foot, children }) {
  const box = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const restoreTo = document.activeElement;
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
    return () => {
      document.removeEventListener('keydown', onKey);
      if (restoreTo && typeof restoreTo.focus === 'function' && document.contains(restoreTo)) restoreTo.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="cp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={'cp-dialog' + (size ? ' ' + size : '')}
        role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="cp-dialog-head">
          <h3 id={titleId}>{title}</h3>
          <Btn kind="quiet" size="sm" aria-label={t('Close')} onClick={onClose}><X /></Btn>
        </div>
        <div className="cp-dialog-body">{children}</div>
        {foot && <div className="cp-dialog-foot">{foot}</div>}
      </div>
    </div>, document.body);
}

export function Confirm({ ask, onClose }) {
  if (!ask) return null;
  return (
    <Dialog title={ask.title || t('Confirm')} size="narrow" onClose={onClose}
      foot={<>
        <Btn onClick={onClose}>{t('Cancel')}</Btn>
        <Btn kind="danger" onClick={async () => { const fn = ask.onConfirm; onClose(); await fn(); }}>{ask.confirm || t('Confirm')}</Btn>
      </>}>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>{ask.message}</p>
    </Dialog>
  );
}

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
