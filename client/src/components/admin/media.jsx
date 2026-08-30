import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api } from '../../api.js';
import { Dialog, Btn, Field, Fields, Seg, Note } from './ui.jsx';
import { QP_ICON_LIST, QpIcon } from '../../qpIcons.jsx';
import { t, tk } from '../../i18n.jsx';

function Slider({ label, min, max, step, value, onChange }) {
  return (
    <Field label={label}>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--text)' }} />
    </Field>
  );
}

const SHAPE_KEYS = [['square', tk('Square')], ['rounded', tk('Rounded')], ['circle', tk('Circle')]];
const shapes = () => SHAPE_KEYS.map(([value, label]) => ({ value, label: t(label) }));

function useObjectImage(file) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    let alive = true;
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { if (alive) setImg(i); };
    i.src = url;
    return () => { alive = false; URL.revokeObjectURL(url); };
  }, [file]);
  return img;
}

function RasterCrop({ file, onDone, onCancel }) {
  const [shape, setShape] = useState('rounded');
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const img = useObjectImage(file);

  const paint = useCallback(() => {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (!img) return c;
    ctx.save();
    if (shape === 'circle') { ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip(); }
    else if (shape === 'rounded') { ctx.beginPath(); ctx.roundRect(0, 0, size, size, size * 0.22); ctx.clip(); }
    const base = Math.min(img.width, img.height);
    const crop = base / zoom;
    ctx.drawImage(img, (img.width - crop) / 2, (img.height - crop) / 2, crop, crop, 0, 0, size, size);
    ctx.restore();
    return c;
  }, [img, shape, zoom]);

  const preview = useMemo(() => (img ? paint().toDataURL('image/png') : ''), [img, paint]);

  function apply() {
    setBusy(true);
    setError('');
    paint().toBlob(async (blob) => {
      if (!blob) { setBusy(false); setError(t('The image could not be encoded.')); return; }
      try {
        const f = new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'icon') + '-crop.png', { type: 'image/png' });
        const { url } = await api.upload(f);
        onDone(url);
      } catch { setBusy(false); setError(t('The upload failed.')); }
    }, 'image/png');
  }

  return (
    <Dialog title={t('Crop image')} size="narrow" onClose={onCancel}
      foot={<>
        <Btn onClick={onCancel}>{t('Cancel')}</Btn>
        <Btn kind="primary" disabled={!img || busy} onClick={apply}>{t('Use image')}</Btn>
      </>}>
      <div style={{ display: 'grid', placeItems: 'center', padding: '4px 0 18px' }}>
        {preview && <img src={preview} alt="" style={{ width: 128, height: 128 }} />}
      </div>
      {error && <div style={{ marginBottom: 14 }}><Note tone="bad">{error}</Note></div>}
      <Fields>
        <Field label={t('Shape')}><Seg value={shape} options={shapes()} onChange={setShape} label={t('Shape')} /></Field>
        <Slider label={t('Zoom')} min={1} max={3} step={0.02} value={zoom} onChange={setZoom} />
      </Fields>
    </Dialog>
  );
}

function VectorCrop({ file, onDone, onCancel }) {
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
          setError(t('That file is not valid SVG.'));
          return;
        }
        const num = (v) => { const n = parseFloat(String(v || '').replace(/[^0-9.eE+-]/g, '')); return Number.isFinite(n) ? n : 0; };
        const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        let box = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0
          ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }
          : { x: 0, y: 0, w: num(root.getAttribute('width')), h: num(root.getAttribute('height')) };
        if (!(box.w > 0 && box.h > 0)) box = { x: 0, y: 0, w: 100, h: 100 };
        setSource({ raw, box });
      } catch { setError(t('That file could not be parsed.')); }
    }).catch(() => { if (alive) setError(t('That file could not be read.')); });
    return () => { alive = false; };
  }, [file]);

  const build = useCallback(() => {
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
      const cid = 'crop' + Math.random().toString(36).slice(2, 8);
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
  }, [source, shape, zoom, offX, offY]);

  const out = useMemo(() => (source ? build() : ''), [source, build]);
  const preview = useMemo(
    () => (out ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out) : ''), [out]);

  async function apply(asIs) {
    setBusy(true);
    try {
      const body = asIs ? await file.text() : out;
      const name = (file.name.replace(/\.[^.]+$/, '') || 'icon') + (asIs ? '' : '-crop') + '.svg';
      const { url } = await api.upload(new File([body], name, { type: 'image/svg+xml' }));
      onDone(url);
    } catch { setBusy(false); setError(t('The upload failed.')); }
  }

  return (
    <Dialog title={t('Crop vector')} size="narrow" onClose={onCancel}
      foot={<>
        <Btn onClick={onCancel}>{t('Cancel')}</Btn>
        <div className="cp-spacer" />
        <Btn disabled={busy} onClick={() => apply(true)}>{t('Use uncropped')}</Btn>
        <Btn kind="primary" disabled={!out || busy} onClick={() => apply(false)}>{t('Use crop')}</Btn>
      </>}>
      <div style={{ display: 'grid', placeItems: 'center', padding: '4px 0 18px' }}>
        {preview && <img src={preview} alt="" style={{ width: 128, height: 128 }} />}
      </div>
      {error
        ? <Note tone="bad">{error}</Note>
        : <Note>{t('Only the viewBox changes, so the result stays vector and keeps its edges at any size.')}</Note>}
      <div style={{ marginTop: 14 }}>
        <Fields cols={2}>
          <Field label={t('Shape')}><Seg value={shape} options={shapes()} onChange={setShape} label={t('Shape')} /></Field>
          <Slider label={t('Zoom')} min={1} max={3} step={0.02} value={zoom} onChange={setZoom} />
          <Slider label={t('Horizontal')} min={-1} max={1} step={0.02} value={offX} onChange={setOffX} />
          <Slider label={t('Vertical')} min={-1} max={1} step={0.02} value={offY} onChange={setOffY} />
        </Fields>
      </div>
    </Dialog>
  );
}

export function ImagePicker({ value, fallback, onChange, hint }) {
  const ref = useRef(null);
  const [raster, setRaster] = useState(null);
  const [vector, setVector] = useState(null);
  const shown = value || fallback;

  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name || '')) { setVector(f); return; }
    if (f.type === 'image/gif') { const { url } = await api.upload(f); onChange(url); return; }
    setRaster(f);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={() => ref.current?.click()} title={t('Replace')}
          style={{
            width: 48, height: 48, borderRadius: 10, display: 'grid', placeItems: 'center',
            border: '1px solid var(--border-soft)', background: 'var(--surface-2)', overflow: 'hidden', flexShrink: 0
          }}>
          {shown ? <img src={shown} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} /> : <span className="cp-hint">{t('none')}</span>}
        </button>
        <div className="cp-acts">
          <Btn size="sm" onClick={() => ref.current?.click()}>{value ? t('Replace') : t('Upload')}</Btn>
          {!!value && <Btn size="sm" kind="danger" onClick={() => onChange('')}>{t('Reset')}</Btn>}
        </div>
      </div>
      {hint && <div className="cp-hint">{hint}</div>}
      <input ref={ref} type="file" hidden onChange={pick}
        accept=".png,.svg,.jpg,.jpeg,.gif,image/png,image/svg+xml,image/jpeg,image/gif" />
      {raster && <RasterCrop file={raster} onCancel={() => setRaster(null)} onDone={(url) => { setRaster(null); onChange(url); }} />}
      {vector && <VectorCrop file={vector} onCancel={() => setVector(null)} onDone={(url) => { setVector(null); onChange(url); }} />}
    </div>
  );
}

export function GlyphPicker({ value, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <Btn size="sm" style={{ width: 26, padding: 0 }} onClick={() => setOpen(o => !o)} title={t('Choose a glyph')} aria-label={t('Choose a glyph')}>
        {value && value !== 'none' ? <QpIcon name={value} style={{ width: 15, height: 15 }} /> : <span className="cp-hint">—</span>}
      </Btn>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 30,
          display: 'grid', gridTemplateColumns: 'repeat(6, 28px)', gap: 2, padding: 5,
          borderRadius: 9, background: 'var(--pop-bg)',
          boxShadow: 'inset 0 0 0 1px var(--pop-border), var(--pop-shadow)'
        }}>
          {QP_ICON_LIST.map(name => (
            <button type="button" key={name} title={name}
              onClick={() => { onPick(name); setOpen(false); }}
              style={{
                width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center',
                background: name === (value || 'none') ? 'var(--pop-hover)' : 'none',
                color: 'var(--pop-text, var(--text))'
              }}>
              {name === 'none' ? <span style={{ opacity: .5 }}>—</span> : <QpIcon name={name} style={{ width: 15, height: 15 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
