import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevDown, Chevron, ImageIcon, Brain, Info, TextIcon } from './icons.jsx';
import { t, tk } from '../i18n.jsx';
import { controlOf, defaultValueOf, falseValueOf, trueValueOf, kwargValuesArr, kwargChip, resolveKwargValues, isRange, clampToRange, rangeStep, kwargVisible, gateSourceIds } from '../kwargs.js';

const CAP_ICONS = [
  { key: 'capText', label: tk('Text-Only'), Icon: TextIcon },
  { key: 'capVision', label: tk('Vision'), Icon: ImageIcon },
  { key: 'capReasoning', label: tk('Reasoning'), Icon: Brain }
];

const EDGE = 10;
const GAP = 6;
function fullHeight(el) {
  if (!el) return 0;
  const s = el.style;
  const maxH = s.maxHeight;
  const ov = s.overflow;
  if (maxH) { s.maxHeight = 'none'; s.overflow = 'visible'; }
  const frame = Math.max(0, el.offsetHeight - el.clientHeight);
  const h = el.scrollHeight + frame + 4;
  if (maxH) { s.maxHeight = maxH; s.overflow = ov; }
  return h;
}

function heightBudget(vh) {
  return Math.max(160, vh - EDGE * 2);
}

function viewport() {
  const d = document.documentElement;
  return {
    w: (d && d.clientWidth) || window.innerWidth || 0,
    h: (d && d.clientHeight) || window.innerHeight || 0
  };
}

function CapRow({ m }) {
  const active = CAP_ICONS.filter(c => m[c.key]);
  if (!active.length) return null;
  return (
    <div className="mo-caps">
      {active.map(({ key, label, Icon }) => (
        <span key={key} className="mo-cap-ic" title={t(label)}>
          <Icon style={{ width: 12, height: 12 }} />
          <span className="mo-cap-lbl">{t(label)}</span>
        </span>
      ))}
    </div>
  );
}
function CapInfo({ m }) {
  const active = CAP_ICONS.filter(c => m[c.key]);
  if (!active.length) return null;
  return (
    <span className="mo-capinfo">
      <Info style={{ width: 14, height: 14 }} />
      <span className="mo-capinfo-pop">
        {active.map(({ key, label, Icon }) => (
          <span key={key} className="mo-capinfo-item"><Icon style={{ width: 12, height: 12 }} /> {t(label)}</span>
        ))}
      </span>
    </span>
  );
}

const capLevel = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function KwargControl({ def, value, isAdmin, onSet }) {
  const values = kwargValuesArr(def);
  const locked = (!!def.adminOnly && !isAdmin) || !!def.parentId;
  const label = def.label || def.name || t('Option');
  const note = def.parentId
    ? (value == null ? t('Follows the setting above, not sent right now') : t('Follows the setting above'))
    : (locked ? t('Set by your administrator') : def.description);
  if (def.parentId) {
    return (
      <div className="kw-static">
        <div className="tr-main">
          <div className="mo-name">{label}</div>
          {note && <div className="mo-desc">{note}</div>}
        </div>
        <span className="kw-pill">{value == null ? t('off') : String(value)}</span>
      </div>
    );
  }
  if (isRange(def)) {
    const cur = clampToRange(def, value);
    const at = cur == null ? Number(defaultValueOf(def)) : cur;
    const min = Number(def.min), max = Number(def.max), step = rangeStep(def);
    const pct = max > min ? ((at - min) / (max - min)) * 100 : 0;
    return (
      <div className={'kw-range' + (locked ? ' locked' : '')}>
        <div className="kw-head">
          <span className="mo-name">{label}</span>
          <span className="kw-cur">{at}{locked ? ' · ' + t('admin set') : ''}</span>
        </div>
        {note && <div className="mo-desc" style={{ marginBottom: 8, marginTop: -2 }}>{note}</div>}
        <input type="range" className="kw-slider" style={{ '--pct': pct + '%' }}
          min={min} max={max} step={step} value={at} disabled={locked}
          aria-label={label}
          onChange={(e) => { if (!locked) onSet(def.id, String(clampToRange(def, e.target.value))); }} />
        <div className="kw-range-ends"><span>{min}</span><span>{max}</span></div>
      </div>
    );
  }
  if (!values.length) return null;
  const control = controlOf(def);
  const active = values.includes(String(value)) ? String(value) : defaultValueOf(def);
  if (control === 'toggle') {
    const on = /^true$/i.test(active);
    return (
      <div className={'toggle-row' + (locked ? ' locked' : '')}
        onClick={() => { if (!locked) onSet(def.id, on ? falseValueOf(def) : trueValueOf(def)); }}>
        <div className="tr-main">
          <div className="mo-name">{label}</div>
          {note && <div className="mo-desc">{note}</div>}
        </div>
        <div className={'switch' + (on ? ' on' : '')} />
      </div>
    );
  }
  if (control === 'select') {
    return (
      <div className="kw-row">
        <div className="kw-head">
          <span className="mo-name">{label}</span>
          {locked && <span className="kw-cur">{t('admin set')}</span>}
        </div>
        {note && <div className="mo-desc">{note}</div>}
        <select className="kw-select" value={active} disabled={locked}
          onChange={(e) => { if (!locked) onSet(def.id, e.target.value); }}>
          {values.map(v => <option key={v} value={v}>{capLevel(v)}</option>)}
        </select>
      </div>
    );
  }
  const idx = Math.max(0, values.indexOf(active));
  return (
    <EffortSlider label={label} note={note} values={values} idx={idx} locked={locked}
      onPick={(v) => onSet(def.id, v)} />
  );
}

const THUMB = 16;
const glowAt = (fill) => Math.max(0, (fill - 0.25) * 0.86);
function EffortSlider({ label, note, values, idx, locked, onPick }) {
  const railRef = useRef(null);
  const inputRef = useRef(null);
  const dragging = useRef(false);
  const [free, setFree] = useState(null);
  const last = values.length - 1;
  const span = Math.max(1, last);

  const at = (clientX) => {
    const rail = railRef.current;
    if (!rail) return null;
    const r = rail.getBoundingClientRect();
    if (!r.width) return null;
    const centre = Math.min(r.width, Math.max(0, clientX - r.left));
    const travel = Math.max(1, r.width - THUMB);
    return {
      pos: Math.min(1, Math.max(0, (centre - THUMB / 2) / travel)),
      fill: centre / r.width,
      i: Math.min(last, Math.max(0, Math.round((centre / r.width) * span)))
    };
  };

  const track = (e) => {
    const hit = at(e.clientX);
    if (!hit) return;
    setFree({ pos: hit.pos, fill: hit.fill });
    if (hit.i !== idx) onPick(values[hit.i]);
  };

  const onDown = (e) => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (inputRef.current) inputRef.current.focus();
    track(e);
  };
  const onMove = (e) => { if (dragging.current) track(e); };
  const stop = () => { dragging.current = false; setFree(null); };

  const cur = capLevel(values[idx]);
  const pos = free ? free.pos : idx / span;
  const fill = free ? free.fill : idx / span;

  return (
    <div className={'effort-row' + (locked ? ' locked' : '') + (idx === last ? ' at-max' : '')}>
      <div className="effort-head">
        <span className="mo-name">{label}</span>
        <span className="effort-cur">{locked ? cur + ' · ' + t('admin set') : cur}</span>
      </div>
      {note && <div className="mo-desc" style={{ marginBottom: 10, marginTop: -8 }}>{note}</div>}
      <div className="effort-ends"><span>{capLevel(values[0])}</span><span>{capLevel(values[last])}</span></div>
      <div className={'effort-slider' + (free ? ' dragging' : '')}
        style={{ '--pos': pos, '--fill': fill, '--glow': glowAt(fill) }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
        <span className="effort-rail" ref={railRef}>
          <span className="effort-fill" />
          <span className="effort-glow" />
        </span>
        <span className="effort-dots">
          {values.map((v, i) => (
            <span key={v} className={'effort-dot' + (i === last ? ' top' : '')} style={{ '--i': i, '--n1': span }} />
          ))}
        </span>
        <input ref={inputRef} type="range" className="effort-input" min={0} max={span} step={1}
          value={idx} disabled={locked} aria-label={label} aria-valuetext={cur}
          onChange={(e) => { if (!locked) onPick(values[Math.min(last, Number(e.target.value))]); }} />
        <span className="effort-thumb" />
      </div>
    </div>
  );
}

function MoreGroup({ label, items, renderOpt, openKey, setOpenKey }) {
  const open = openKey === label;
  const rowRef = useRef(null);
  const subRef = useRef(null);
  const timer = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const measure = () => {
      const row = rowRef.current, sub = subRef.current;
      if (!row || !sub) return;
      const rr = row.getBoundingClientRect();
      const vp = viewport();
      const w = sub.offsetWidth;
      const nat = fullHeight(sub);
      const budget = heightBudget(vp.h);
      const h = Math.min(nat, budget);
      const flip = rr.right + GAP + w > vp.w - EDGE && rr.left - GAP - w >= EDGE;
      let left = flip ? rr.left - GAP - w : rr.right + GAP;
      left = Math.max(EDGE, Math.min(left, Math.max(EDGE, vp.w - EDGE - w)));
      const top = Math.max(EDGE, Math.min(rr.top, Math.max(EDGE, vp.h - EDGE - h)));
      const next = { left: Math.round(left), top: Math.round(top), maxH: nat > budget ? Math.round(budget) : 0, flip };
      setPos(p => (p && p.left === next.left && p.top === next.top && p.maxH === next.maxH && p.flip === next.flip) ? p : next);
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); if (subRef.current) ro.observe(subRef.current); }
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, items]);
  const show = () => { clearTimeout(timer.current); setOpenKey(label); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpenKey(k => (k === label ? null : k)), 160); };
  const sub = (
    <div ref={subRef}
      className={'model-submenu pinned' + (pos && pos.flip ? ' flip' : '')}
      style={{
        top: pos ? pos.top : 0,
        left: pos ? pos.left : 0,
        maxHeight: pos && pos.maxH ? pos.maxH : undefined,
        overflow: pos && pos.maxH ? 'hidden auto' : undefined,
        visibility: pos ? undefined : 'hidden'
      }}
      onMouseEnter={show} onMouseLeave={hide}>
      {items.map(renderOpt)}
    </div>
  );
  const host = typeof document !== 'undefined' ? document.body : null;
  return (
    <div className="more-wrap" ref={rowRef} onMouseEnter={show} onMouseLeave={hide}>
      <button type="button" className={'submenu-row' + (open ? ' active' : '')} onClick={() => (open ? setOpenKey(null) : show())}>
        <span>{label}</span><Chevron className="sub-chev" />
      </button>
      {open && (host ? createPortal(sub, host) : sub)}
    </div>
  );
}

export default function ModelDropdown({ models, currentId, onSelect, extended, onToggleExtended, up, modelHasBg, bgInChat, onToggleBgInChat, reasoningEffort, onSetEffort, kwargValues, onSetKwarg, isAdmin = false }) {
  const [open, setOpen] = useState(false);
  const [openSub, setOpenSub] = useState(null);
  const [place, setPlace] = useState({ shift: 0, left: null, maxH: 0, sheet: false, ready: false });
  const [listMaxH, setListMaxH] = useState(0);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => {
    const h = (e) => {
      const el = e.target;
      if (ref.current && ref.current.contains(el)) return;
      if (el && typeof el.closest === 'function' && el.closest('.model-submenu')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { if (!open) setOpenSub(null); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (e.key === 'Escape') { setOpenSub(null); setOpen(false); } };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) {
      setPlace(p => (p.ready ? { shift: 0, left: null, maxH: 0, sheet: false, ready: false } : p));
      return undefined;
    }
    const measure = () => {
      const wrap = ref.current, menu = menuRef.current;
      if (!wrap || !menu) return;
      const trig = wrap.querySelector('.model-trigger') || wrap;
      const r = trig.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      const vp = viewport();
      const nat = fullHeight(menu);
      const budget = heightBudget(vp.h);
      const h = Math.min(nat, budget);
      const below = vp.h - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      let top;
      if (h <= below) top = r.bottom + GAP;
      else if (h <= above) top = r.top - GAP - h;
      else top = below >= above ? vp.h - EDGE - h : EDGE;
      top = Math.max(EDGE, Math.min(top, Math.max(EDGE, vp.h - EDGE - h)));
      const mw = menu.offsetWidth || 0;
      const restLeft = wr.right - mw;
      let left = null;
      if (restLeft < EDGE) left = Math.round(EDGE - wr.left);
      else if (wr.right > vp.w - EDGE) left = Math.round(vp.w - EDGE - mw - wr.left);
      const next = { shift: Math.round(top - wr.top), left, maxH: nat > budget ? Math.round(budget) : 0, sheet: false, ready: true };
      setPlace(p => (p.ready && !p.sheet && p.shift === next.shift && p.left === next.left && p.maxH === next.maxH) ? p : next);
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      if (menuRef.current) ro.observe(menuRef.current);
      if (ref.current) ro.observe(ref.current);
    }
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, listMaxH, extended]);
  useLayoutEffect(() => {
    if (!open) { setListMaxH(0); return; }
    const list = listRef.current;
    if (!list) return;
    const kids = list.children;
    if (kids.length > 4) {
      const h = Math.round(kids[4].getBoundingClientRect().top - kids[0].getBoundingClientRect().top);
      setListMaxH(h > 0 ? h : 0);
    } else {
      setListMaxH(0);
    }
  }, [open, models]);

  const current = models.find(m => m.id === currentId);
  const kwDefs = Array.isArray(current?.kwargs) ? current.kwargs : [];
  const selected = { ...(reasoningEffort ? { effort: reasoningEffort } : {}), ...(kwargValues && typeof kwargValues === 'object' ? kwargValues : {}) };
  const kwActive = resolveKwargValues(kwDefs, selected, isAdmin);
  const setKwarg = (id, value) => {
    if (onSetKwarg) onSetKwarg(id, value);
    else if (id === 'effort' && onSetEffort) onSetEffort(value);
  };
  const ownKwargs = kwDefs.filter(d => !d.parentId);
  const shownKwargs = kwDefs.filter(d => kwargVisible(kwDefs, kwActive, d));
  const gates = gateSourceIds(kwDefs, kwActive);
  const chips = ownKwargs
    .filter(d => kwargVisible(kwDefs, kwActive, d) && !gates.has(d.id))
    .map(d => kwargChip(d, kwActive[d.id]))
    .filter(Boolean)
    .slice(0, 2);
  const main = models.filter(m => !m.inMoreModels);
  const groups = [];
  {
    const seen = new Map();
    for (const m of models) {
      if (!m.inMoreModels) continue;
      const label = (m.moreModelsLabel || '').trim() || t('More models');
      if (!seen.has(label)) { seen.set(label, { label, items: [] }); groups.push(seen.get(label)); }
      seen.get(label).items.push(m);
    }
  }

  const renderOpt = (m) => (
    <button key={m.id} type="button" className={'model-opt' + (m.unavailable ? ' unavail' : '')} onClick={() => { onSelect(m.id); setOpenSub(null); setOpen(false); }}
      title={m.unavailable ? (m.displayName + ' is currently unavailable.') : undefined}>
      {m.dropdownIcon !== false && m.staticIcon && <img className="mo-icon" src={m.staticIcon} alt="" />}
      <div className="mo-main">
        <div className="mo-name">
          {m.displayName}
          {m.unavailable && <span className="mo-unavail"><span className="mo-unavail-dot">ⓘ</span> {t("Currently unavailable")}</span>}
        </div>
        {m.description && <div className="mo-desc">{m.description}</div>}
        {!m.capCompact && <CapRow m={m} />}
      </div>
      <span className="mo-side">
        {m.id === currentId && <Check className="check" />}
        {m.capCompact && <CapInfo m={m} />}
      </span>
    </button>
  );

  const menuStyle = place.sheet ? undefined : {
    top: place.shift,
    bottom: 'auto',
    ...(place.left == null ? null : { left: place.left, right: 'auto' }),
    maxHeight: place.maxH || undefined,
    overflow: place.maxH ? 'hidden auto' : undefined,
    visibility: place.ready ? undefined : 'hidden'
  };

  return (
    <div className="model-select" ref={ref}>
      <button type="button" className={'model-trigger' + (open ? ' on' : '')} onClick={() => setOpen(o => !o)}>
        {current?.displayName || 'Model'}
        {chips.length
          ? chips.map((c, i) => <span key={c + i} className="ext ext-effort">{t(c)}</span>)
          : (extended && current?.hasReasoning && <span className="ext">{t("Extended")}</span>)}
        <ChevDown style={{ width: 12, height: 12 }} />
      </button>
      {open && <div className="model-scrim" onClick={() => setOpen(false)} />}
      {open && (
        <div ref={menuRef} className={'model-menu' + (place.sheet ? '' : ' up')} style={menuStyle}>
          <div className="model-main-list" ref={listRef} style={listMaxH ? { maxHeight: listMaxH, overflow: 'hidden auto' } : undefined}>
            {main.map(renderOpt)}
          </div>
          {shownKwargs.length ? (
            <>
              <hr />
              {shownKwargs.map(d => (
                <KwargControl key={d.id} def={d} value={kwActive[d.id]} isAdmin={isAdmin} onSet={setKwarg} />
              ))}
            </>
          ) : current?.hasReasoning ? (
            <>
              <hr />
              <div className="toggle-row" onClick={onToggleExtended}>
                <div className="tr-main">
                  <div className="mo-name">{t("Extended")}</div>
                  <div className="mo-desc">{t("Always uses deep reasoning")}</div>
                </div>
                <div className={'switch' + (extended ? ' on' : '')} />
              </div>
            </>
          ) : null}
          {modelHasBg && (
            <>
              <hr />
              <div className="toggle-row" onClick={onToggleBgInChat}>
                <div className="tr-main">
                  <div className="mo-name">{t("Background in chat")}</div>
                  <div className="mo-desc">{t("Keep this model's backdrop during conversations")}</div>
                </div>
                <div className={'switch' + (bgInChat ? ' on' : '')} />
              </div>
            </>
          )}
          {groups.length > 0 && (
            <>
              <hr />
              {groups.map(g => <MoreGroup key={g.label} label={g.label} items={g.items} renderOpt={renderOpt} openKey={openSub} setOpenKey={setOpenSub} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
