import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../api.js';
import { Copy, Check } from '../icons.jsx';
import { QP_ICON_LIST, QpIcon } from '../../qpIcons.jsx';
import { t, tk } from '../../i18n.jsx';
import { SegSlide, Switch } from '../settingsui.jsx';

export { Switch };

export function QpIconPicker({ value, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="qp-iconpick" ref={ref}>
      <button type="button" className="qp-iconbtn" onClick={() => setOpen(o => !o)} title={t("Choose an icon")}>
        {value && value !== 'none' ? <QpIcon name={value} style={{ width: 16, height: 16 }} /> : <span className="qp-iconnone">—</span>}
      </button>
      {open && (
        <div className="qp-iconmenu">
          {QP_ICON_LIST.map(name => (
            <button type="button" key={name} className={'qp-iconopt' + (name === (value || 'none') ? ' on' : '')}
              onClick={() => { onPick(name); setOpen(false); }} title={name}>
              {name === 'none' ? <span className="qp-iconnone">, </span> : <QpIcon name={name} style={{ width: 16, height: 16 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const Grip = (p) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" {...p}>
    <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
    <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
  </svg>
);

export function BannerCropModal({ file, onDone, onCancel }) {
  const [zoom, setZoom] = useState(1);
  const [offX, setOffX] = useState(0);
  const [offY, setOffY] = useState(0);
  const [img, setImg] = useState(null);
  const ASPECT = 2.5;
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function render() {
    const W = 800, H = Math.round(800 / ASPECT);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!img) return c;
    let cw = Math.min(img.width, img.height * ASPECT);
    cw = cw / zoom;
    const ch = cw / ASPECT;
    const roomX = img.width - cw, roomY = img.height - ch;
    const sx = roomX / 2 + (offX * roomX) / 2;
    const sy = roomY / 2 + (offY * roomY) / 2;
    ctx.drawImage(img, sx, sy, cw, ch, 0, 0, W, H);
    return c;
  }
  const previewUrl = img ? render().toDataURL('image/jpeg', 0.9) : '';
  async function apply() {
    render().toBlob(async (blob) => {
      const f = new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'banner') + '-banner.jpg', { type: 'image/jpeg' });
      const { url } = await api.upload(f);
      onDone(url);
    }, 'image/jpeg', 0.9);
  }
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="sp-modal crop-modal banner-crop" onClick={(e) => e.stopPropagation()}>
        <div className="sp-head"><h3>{t("Crop banner")}</h3><button className="sp-x" onClick={onCancel}>✕</button></div>
        <div className="crop-body">
          <div className="crop-preview banner-preview">{previewUrl && <img src={previewUrl} alt="" />}</div>
          <div className="crop-controls">
            <div className="field"><label>{t("Zoom")}</label>
              <input type="range" min="1" max="3" step="0.02" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
            <div className="field"><label>{t("Horizontal position")}</label>
              <input type="range" min="-1" max="1" step="0.02" value={offX} onChange={(e) => setOffX(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
            <div className="field"><label>{t("Vertical position")}</label>
              <input type="range" min="-1" max="1" step="0.02" value={offY} onChange={(e) => setOffY(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
            <div className="editor-actions">
              <button className="btn" onClick={onCancel}>{t('Cancel')}</button>
              <button className="btn primary" disabled={!img} onClick={apply}>{t('Use banner')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BannerPicker({ value, onChange }) {
  const ref = useRef(null);
  const [cropFile, setCropFile] = useState(null);
  const isImage = /^(https?:|data:|blob:|\/)/i.test(String(value || '').trim());
  return (
    <div className="banner-picker">
      <div className="banner-pick-preview" style={bgPreviewStyle(value)}>
        {!value && <span className="muted-note">{t('No banner set')}</span>}
      </div>
      <div className="banner-pick-actions">
        <button type="button" className="btn" onClick={() => ref.current?.click()}>{t('Upload image')}</button>
        {!!value && <button type="button" className="btn ghost danger" onClick={() => onChange('')}>{t('Remove')}</button>}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setCropFile(f); }} />
      <input value={isImage ? '' : (value || '')} onChange={(e) => onChange(e.target.value)}
        placeholder={t('Or paste a CSS gradient, e.g. linear-gradient(120deg, #f7b733, #fc4a1a)')} />
      {cropFile && <BannerCropModal file={cropFile} onDone={(url) => { setCropFile(null); onChange(url); }} onCancel={() => setCropFile(null)} />}
    </div>
  );
}

export function bgPreviewStyle(v) {
  const s = String(v || '').trim();
  if (!s) return {};
  if (/^(https?:|data:|blob:|\/)/i.test(s)) return { backgroundImage: `url("${s}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return { background: s };
}

export function IconCropModal({ file, onDone, onCancel }) {
  const [shape, setShape] = useState('rounded');
  const [zoom, setZoom] = useState(1);
  const [img, setImg] = useState(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function render() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (!img) return c;
    ctx.save();
    if (shape === 'circle') { ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip(); }
    else if (shape === 'rounded') { const r = size * 0.22; ctx.beginPath(); ctx.roundRect(0, 0, size, size, r); ctx.clip(); }
    const base = Math.min(img.width, img.height);
    const crop = base / zoom;
    ctx.drawImage(img, (img.width - crop) / 2, (img.height - crop) / 2, crop, crop, 0, 0, size, size);
    ctx.restore();
    return c;
  }
  const previewUrl = img ? render().toDataURL('image/png') : '';
  async function apply() {
    render().toBlob(async (blob) => {
      const f = new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'icon') + '-cropped.png', { type: 'image/png' });
      const { url } = await api.upload(f);
      onDone(url);
    }, 'image/png');
  }
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="sp-modal crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sp-head"><h3>{t("Crop icon")}</h3><button className="sp-x" onClick={onCancel}>✕</button></div>
        <div className="crop-body">
          <div className="crop-preview">{previewUrl && <img src={previewUrl} alt="" />}</div>
          <div className="crop-controls">
            <div className="field"><label>{t("Shape")}</label>
              <div className="seg" style={{ width: 'fit-content' }}>
                <button className={shape === 'circle' ? 'on' : ''} onClick={() => setShape('circle')}>{t("Circle")}</button>
                <button className={shape === 'rounded' ? 'on' : ''} onClick={() => setShape('rounded')}>{t("Rounded")}</button>
                <button className={shape === 'square' ? 'on' : ''} onClick={() => setShape('square')}>{t("Square")}</button>
              </div>
            </div>
            <div className="field"><label>{t("Zoom")}</label>
              <input type="range" min="1" max="3" step="0.02" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
            <div className="editor-actions">
              <button className="btn" onClick={onCancel}>{t('Cancel')}</button>
              <button className="btn primary" disabled={!img} onClick={apply}>{t("Use icon")}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SvgCropModal({ file, onDone, onCancel }) {
  const [shape, setShape] = useState('square');
  const [zoom, setZoom] = useState(1);
  const [offX, setOffX] = useState(0);
  const [offY, setOffY] = useState(0);
  const [source, setSource] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    file.text().then((raw) => {
      if (!alive) return;
      try {
        const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
        const root = doc.documentElement;
        if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
          setError(t('That file could not be read as an SVG.'));
          return;
        }
        const num = (v) => { const n = parseFloat(String(v || '').replace(/[^0-9.eE+-]/g, '')); return Number.isFinite(n) ? n : 0; };
        const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        let box = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0
          ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }
          : { x: 0, y: 0, w: num(root.getAttribute('width')), h: num(root.getAttribute('height')) };
        if (!(box.w > 0 && box.h > 0)) box = { x: 0, y: 0, w: 100, h: 100 };
        setSource({ raw, box });
      } catch {
        setError(t('That file could not be read as an SVG.'));
      }
    }).catch(() => { if (alive) setError(t('That file could not be read.')); });
    return () => { alive = false; };
  }, [file]);

  function build() {
    if (!source) return '';
    const { raw, box } = source;
    const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
    const root = doc.documentElement;
    const side = Math.min(box.w, box.h) / zoom;
    const roomX = box.w - side, roomY = box.h - side;
    const x = box.x + roomX / 2 + (offX * roomX) / 2;
    const y = box.y + roomY / 2 + (offY * roomY) / 2;
    root.setAttribute('viewBox', [x, y, side, side].map(n => Math.round(n * 1000) / 1000).join(' '));
    root.setAttribute('width', '256');
    root.setAttribute('height', '256');
    root.removeAttribute('style');
    if (shape !== 'square') {
      const cid = 'oqcrop' + Math.random().toString(36).slice(2, 8);
      const ns = 'http://www.w3.org/2000/svg';
      const defs = doc.createElementNS(ns, 'defs');
      const clip = doc.createElementNS(ns, 'clipPath');
      clip.setAttribute('id', cid);
      clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
      if (shape === 'circle') {
        const c = doc.createElementNS(ns, 'circle');
        c.setAttribute('cx', String(x + side / 2));
        c.setAttribute('cy', String(y + side / 2));
        c.setAttribute('r', String(side / 2));
        clip.appendChild(c);
      } else {
        const r = doc.createElementNS(ns, 'rect');
        r.setAttribute('x', String(x));
        r.setAttribute('y', String(y));
        r.setAttribute('width', String(side));
        r.setAttribute('height', String(side));
        r.setAttribute('rx', String(side * 0.22));
        clip.appendChild(r);
      }
      defs.appendChild(clip);
      const wrap = doc.createElementNS(ns, 'g');
      wrap.setAttribute('clip-path', 'url(#' + cid + ')');
      while (root.firstChild) wrap.appendChild(root.firstChild);
      root.appendChild(defs);
      root.appendChild(wrap);
    }
    return new XMLSerializer().serializeToString(root);
  }

  const out = source ? build() : '';
  const previewUrl = out ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out) : '';

  async function apply(original) {
    setBusy(true);
    try {
      const body = original ? await file.text() : out;
      const name = (file.name.replace(/\.[^.]+$/, '') || 'icon') + (original ? '' : '-cropped') + '.svg';
      const f = new File([body], name, { type: 'image/svg+xml' });
      const { url } = await api.upload(f);
      onDone(url);
    } catch {
      setBusy(false);
      setError(t('The upload failed, try again.'));
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="sp-modal crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sp-head"><h3>{t("Crop SVG")}</h3><button className="sp-x" onClick={onCancel}>✕</button></div>
        <div className="crop-body">
          <div className="crop-preview">{previewUrl && <img src={previewUrl} alt="" />}</div>
          <div className="crop-controls">
            {error
              ? <div className="muted-note">{error}</div>
              : <div className="muted-note">{t('The crop stays vector, only the viewBox changes, so the logo keeps its sharp edges at any size.')}</div>}
            <div className="field"><label>{t("Shape")}</label>
              <div className="seg" style={{ width: 'fit-content' }}>
                <button className={shape === 'circle' ? 'on' : ''} onClick={() => setShape('circle')}>{t('Circle')}</button>
                <button className={shape === 'rounded' ? 'on' : ''} onClick={() => setShape('rounded')}>{t('Rounded')}</button>
                <button className={shape === 'square' ? 'on' : ''} onClick={() => setShape('square')}>{t('Square')}</button>
              </div>
            </div>
            <div className="field"><label>{t("Zoom")}</label>
              <input type="range" min="1" max="3" step="0.02" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
            <div className="field"><label>{t("Horizontal position")}</label>
              <input type="range" min="-1" max="1" step="0.02" value={offX} onChange={(e) => setOffX(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
            <div className="field"><label>{t("Vertical position")}</label>
              <input type="range" min="-1" max="1" step="0.02" value={offY} onChange={(e) => setOffY(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>
            <div className="editor-actions">
              <button className="btn" onClick={onCancel}>{t('Cancel')}</button>
              <button className="btn ghost" disabled={busy} onClick={() => apply(true)}>{t('Use as is')}</button>
              <button className="btn primary" disabled={!out || busy} onClick={() => apply(false)}>{t('Use crop')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function IconSlot({ label, value, def, anim, onChange }) {
  const ref = useRef(null);
  const [cropFile, setCropFile] = useState(null);
  const [svgFile, setSvgFile] = useState(null);
  async function pick(e) {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = '';
    if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name || '')) { setSvgFile(f); return; }
    if (f.type === 'image/gif') {
      const { url } = await api.upload(f);
      onChange(url);
      return;
    }
    setCropFile(f);
  }
  const shown = value || def;
  return (
    <div className="icon-slot">
      <div className="preview-wrap">
        <button type="button" className={'preview' + (shown ? '' : ' empty')} onClick={() => ref.current?.click()} title={t("Click to upload (png, svg, jpeg, gif)")}>
          {shown ? <img src={shown} className={anim} alt="" /> : <span className="preview-none">{t("None")}</span>}
        </button>
        {value && (
          <button type="button" className="reset-icon" title={t("Remove icon")} onClick={() => onChange('')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        )}
      </div>
      <input ref={ref} type="file" hidden onChange={pick}
        accept=".png,.svg,.jpg,.jpeg,.gif,image/png,image/svg+xml,image/jpeg,image/gif" />
      {cropFile && <IconCropModal file={cropFile} onCancel={() => setCropFile(null)} onDone={(url) => { setCropFile(null); onChange(url); }} />}
      {svgFile && <SvgCropModal file={svgFile} onCancel={() => setSvgFile(null)} onDone={(url) => { setSvgFile(null); onChange(url); }} />}
      <div className="up">{label}</div>
    </div>
  );
}

const SP_VAR_RE = /(\{\{currentDateTime\}\}|\{\{currentUser\}\})/g;

function SpHighlighted({ text }) {
  const parts = (text || '').split(SP_VAR_RE);
  if (parts.length === 1) return <>{text}</>;
  return parts.map((p, i) => (p === '{{currentDateTime}}' || p === '{{currentUser}}')
    ? <mark key={i} className="sp-var-hl">{p}</mark>
    : <React.Fragment key={i}>{p}</React.Fragment>);
}

export function PromptField({ value, onChange, onExpand, label, hint, placeholder, rows = 9 }) {
  const taRef = useRef(null);
  const v = value || '';
  const chars = v.length;
  function insert(token) {
    const ta = taRef.current;
    if (!ta) { onChange(v + token); return; }
    const s = ta.selectionStart ?? v.length, e = ta.selectionEnd ?? v.length;
    onChange(v.slice(0, s) + token + v.slice(e));
    requestAnimationFrame(() => { ta.focus(); const p = s + token.length; ta.setSelectionRange(p, p); });
  }
  return (
    <div className="pf">
      <div className="pf-top">
        {label ? <label>{label}</label> : <span />}
        <div className="pf-tools">
          <button type="button" className="pf-chip" title={t("Insert local date & time")} onClick={() => insert('{{currentDateTime}}')}><code>date</code></button>
          <button type="button" className="pf-chip" title={t("Insert the user's name")} onClick={() => insert('{{currentUser}}')}><code>user</code></button>
          <button type="button" className="pf-chip pf-expand" onClick={onExpand} title={t("Open the full editor")}>{t("Expand")}</button>
        </div>
      </div>
      {hint && <div className="muted-note pf-hint">{hint}</div>}
      <textarea ref={taRef} className="pf-text" rows={rows} value={v} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
      <div className="pf-foot">
        <span>{t('{n} characters', { n: chars.toLocaleString() })}</span>
        <span>{t('~{n} tokens (estimate)', { n: Math.round(chars / 4).toLocaleString() })}</span>
      </div>
    </div>
  );
}

export function SystemPromptEditor({ value, onChange, onClose }) {
  const taRef = useRef(null);
  const [preview, setPreview] = useState(false);
  const dt = '{{currentDateTime}}';
  const cu = '{{currentUser}}';
  const v = value || '';
  const chars = v.length;
  const tokensEst = Math.round(chars / 4);
  function insert(token) {
    const ta = taRef.current;
    if (!ta) { onChange(v + token); return; }
    const s = ta.selectionStart ?? v.length, e = ta.selectionEnd ?? v.length;
    const next = v.slice(0, s) + token + v.slice(e);
    onChange(next);
    requestAnimationFrame(() => { ta.focus(); const p = s + token.length; ta.setSelectionRange(p, p); });
  }
  return (
    <div className="overlay sp-overlay" onMouseDown={(e) => e.target.classList.contains('sp-overlay') && onClose()}>
      <div className="sp-modal">
        <div className="sp-head">
          <h3>{t("System prompt")}</h3>
          <button className="sp-x" onClick={onClose} title={t("Close")}>✕</button>
        </div>
        <div className="sp-bar">
          <span className="sp-bar-label">{t("Insert")}</span>
          <button className="sp-chip" onClick={() => insert(dt)} title={t("Replaced with the current date and time from this device, in your local timezone.")}><code>{dt}</code></button>
          <button className="sp-chip" onClick={() => insert(cu)} title={t("Replaced with the signed-in user name. Everything stays on your machine.")}><code>{cu}</code></button>
          <span className="sp-bar-note">{t("Filled in on each message, on the user's own device.")}</span>
          <button type="button" className={'sp-ghost' + (preview ? ' on' : '')} onClick={() => setPreview(p => !p)}>
            {preview ? t("Back to editing") : t("Highlight variables")}
          </button>
        </div>
        <div className="sp-surface">
          {preview ? (
            <div className="sp-text sp-render" onClick={() => setPreview(false)} title={t("Click to go back to editing")}>
              {v ? <SpHighlighted text={v} /> : <span className="sp-preview-empty">{t("Click to write a system prompt…")}</span>}
            </div>
          ) : (
            <textarea ref={taRef} className="sp-text" value={v} onChange={(e) => onChange(e.target.value)} placeholder={t("You are a helpful assistant…")} autoFocus />
          )}
        </div>
        <div className="sp-foot">
          <span className="sp-count">{t("{n} characters", { n: chars.toLocaleString() })} · {t("~{n} tokens (estimate)", { n: tokensEst.toLocaleString() })}</span>
          <span className="sp-autosave-note">{t("Edits save to your draft automatically.")}</span>
          <button className="btn primary" onClick={onClose}>{t("Done")}</button>
        </div>
      </div>
    </div>
  );
}

export function Toggle({ m, set, k, label, note, inverted }) {
  const on = inverted ? m[k] !== 0 : !!m[k];
  return (
    <div className="field row">
      <div><label>{label}</label>{note && <div className="muted-note">{note}</div>}</div>
      <Switch on={on} label={label} onToggle={() => set(k, on ? 0 : 1)} />
    </div>
  );
}

export function SettingRow({ label, note, on, onToggle, last }) {
  return (
    <div className="field row" style={last ? { borderBottom: 0, marginBottom: 0 } : undefined}>
      <div><label>{label}</label>{note && <div className="muted-note">{note}</div>}</div>
      <Switch on={on} label={label} onToggle={onToggle} />
    </div>
  );
}

export function SegPick({ value, options, onChange, style, label }) {
  return (
    <div style={{ width: 'fit-content', ...style }}>
      <SegSlide value={value} label={label}
        options={options.map(([v, l]) => ({ v, label: typeof l === 'string' ? t(l) : l }))}
        onPick={onChange} />
    </div>
  );
}

export function Card({ title, sub, right, children, className }) {
  return (
    <section className={'acard' + (className ? ' ' + className : '')}>
      {(title || right) && (
        <div className="acard-head">
          <div className="acard-titles">
            {title && <h3 className="acard-title">{title}</h3>}
            {sub && <div className="acard-sub">{sub}</div>}
          </div>
          {right && <div className="acard-right">{right}</div>}
        </div>
      )}
      <div className="acard-body">{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, children, actions }) {
  return (
    <div className="aq-empty">
      {icon && <div className="aq-empty-icon">{icon}</div>}
      <h2>{title}</h2>
      {children}
      {actions && <div className="aq-empty-actions">{actions}</div>}
    </div>
  );
}

export function AutosaveNote({ status, live }) {
  return (
    <div className="settings-autosave">
      <span className={'autosave-dot' + (status === 'saved' ? ' flash' : '')} />
      {status === 'saving' ? t('Saving…') : status === 'saved' ? (live ? t('Saved, applies immediately') : t('Saved to draft, use Push to all clients to make it live')) : (live ? t('Changes save automatically') : t('Changes save automatically to your draft'))}
    </div>
  );
}

export function CopyBtn({ text, title }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={'aq-copy' + (ok ? ' ok' : '')} title={title || 'Copy'}
      onClick={async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(text || ''); setOk(true); setTimeout(() => setOk(false), 1200); } catch {} }}>
      {ok ? <Check style={{ width: 12 }} /> : <Copy style={{ width: 12 }} />}
    </button>
  );
}

export function StatusChips({ m }) {
  const chips = [];
  if (m.is_default) chips.push(['default', tk('Default')]);
  if (!m.enabled) chips.push(['dim', tk('Hidden')]);
  if (m.unavailable) chips.push(['warn', tk('Unavailable')]);
  if (m.sunset_at) chips.push(['warn', t('Retiring') + ' ' + m.sunset_at]);
  if (m.effort_enabled || m.has_reasoning || (Array.isArray(m.kwargs) && m.kwargs.length)) chips.push(['', 'Reasoning']);
  if (m.has_vision) chips.push(['', 'Vision']);
  if (m.sandbox_allowed !== 0 && m.sandbox_auto) chips.push(['', 'Sandbox']);
  if (m.in_more_models) chips.push(['dim', tk('Grouped')]);
  if (!chips.length) return null;
  return <div className="aq-chips">{chips.map(([cls, label]) => <span key={label} className={'aq-chip' + (cls ? ' ' + cls : '')}>{t(label)}</span>)}</div>;
}

export function ConfirmDialog({ ask, onClose }) {
  if (!ask) return null;
  return (
    <div className="confirm-overlay" onMouseDown={(e) => e.target.classList.contains('confirm-overlay') && onClose()}>
      <div className="confirm-box">
        <div className="confirm-msg">{ask.message}</div>
        <div className="confirm-actions">
          <button className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn danger-solid" onClick={async () => { const fn = ask.onConfirm; onClose(); await fn(); }}>{ask.danger || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

export function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - (typeof ts === 'number' ? ts : d.getTime());
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString();
}

export function fmtMoney(v) {
  const n = Number(v) || 0;
  return '$' + n.toFixed(n && n < 0.01 ? 4 : 2);
}
