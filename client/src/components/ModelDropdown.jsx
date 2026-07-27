import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Check, ChevDown, Chevron, ImageIcon, Brain, Info, TextIcon } from './icons.jsx';
import { t } from '../i18n.jsx';
import { controlOf, defaultValueOf, falseValueOf, trueValueOf, kwargValuesArr, kwargChip, resolveKwargValues } from '../kwargs.js';

const CAP_ICONS = [
  { key: 'capText', label: 'Text-Only', Icon: TextIcon },
  { key: 'capVision', label: 'Vision', Icon: ImageIcon },
  { key: 'capReasoning', label: 'Reasoning', Icon: Brain }
];
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
          <span key={key} className="mo-capinfo-item"><Icon style={{ width: 12, height: 12 }} /> {label}</span>
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
    <div className={'effort-row' + (locked ? ' locked' : '')}>
      <div className="effort-head">
        <span className="mo-name">{label}</span>
        <span className="effort-cur">{locked ? capLevel(active) + ' \u00b7 ' + t('admin set') : capLevel(active)}</span>
      </div>
      {note && <div className="mo-desc" style={{ marginBottom: 8, marginTop: -4 }}>{note}</div>}
      <div className="effort-seg" style={{ '--n': values.length, '--i': idx }}>
        <span className="effort-seg-thumb" />
        {values.map((v, i) => (
          <button key={v} disabled={locked} className={'effort-seg-btn' + (i === idx ? ' on' : '')}
            onClick={() => { if (!locked) onSet(def.id, v); }}>{capLevel(v)}</button>
        ))}
      </div>
    </div>
  );
}

function MoreGroup({ label, items, renderOpt, openKey, setOpenKey }) {
  const open = openKey === label;
  const [place, setPlace] = useState({ up: false, maxH: 0 });
  const rowRef = useRef(null);
  const subRef = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const row = rowRef.current, sub = subRef.current;
    if (!row || !sub) return;
    const rr = row.getBoundingClientRect();
    const subH = sub.scrollHeight;
    const below = window.innerHeight - rr.top;
    const above = rr.bottom;
    const flip = below < subH + 14 && above > below;
    const avail = (flip ? above : below) - 16;
    const flipLeft = rr.right + 4 + sub.offsetWidth > window.innerWidth - 8;
    setPlace({ up: flip, maxH: subH > avail ? Math.max(140, avail) : 0, left: flipLeft });
  }, [open]);
  const show = () => { clearTimeout(timer.current); setOpenKey(label); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpenKey(k => (k === label ? null : k)), 160); };
  return (
    <div className="more-wrap" ref={rowRef} onMouseEnter={show} onMouseLeave={hide}>
      <button className={'submenu-row' + (open ? ' active' : '')} onClick={() => (open ? setOpenKey(null) : show())}>
        <span>{label}</span><Chevron className="sub-chev" />
      </button>
      {open && (
        <div ref={subRef} className={'model-submenu' + (place.up ? ' up' : '') + (place.left ? ' left' : '')} style={place.maxH ? { maxHeight: place.maxH, overflowY: 'auto' } : undefined} onMouseEnter={show} onMouseLeave={hide}>
          {items.map(renderOpt)}
        </div>
      )}
    </div>
  );
}

export default function ModelDropdown({ models, currentId, onSelect, extended, onToggleExtended, up, modelHasBg, bgInChat, onToggleBgInChat, reasoningEffort, onSetEffort, kwargValues, onSetKwarg, isAdmin = false }) {
  const [open, setOpen] = useState(false);
  const [openSub, setOpenSub] = useState(null);
  const [place, setPlace] = useState({ down: !!up, maxH: 0 });
  const [listMaxH, setListMaxH] = useState(0);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { if (!open) setOpenSub(null); }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const trig = ref.current && ref.current.querySelector('.model-trigger');
    if (!trig) return;
    const r = trig.getBoundingClientRect();
    const menuH = (menuRef.current && menuRef.current.scrollHeight) || 340;
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const down = below >= menuH + 14 ? true : below >= above;
    const avail = (down ? below : above) - 16;
    setPlace({ down, maxH: menuH > avail ? Math.max(160, avail) : 0 });
  }, [open, listMaxH]);
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
  const shownKwargs = kwDefs.filter(d => d.visible !== false);
  const chips = ownKwargs
    .filter(d => d.visible !== false)
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

  const Opt = (m) => (
    <button key={m.id} className={'model-opt' + (m.unavailable ? ' unavail' : '')} onClick={() => { onSelect(m.id); setOpen(false); }}
      title={m.unavailable ? (m.displayName + ' is currently unavailable.') : undefined}>
      {m.dropdownIcon !== false && m.staticIcon && <img className="mo-icon" src={m.staticIcon} alt="" />}
      <div className="mo-main">
        <div className="mo-name">
          {m.displayName}
          {m.unavailable && <span className="mo-unavail"><span className="mo-unavail-dot">ⓘ</span> Currently unavailable</span>}
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

  return (
    <div className="model-select" ref={ref}>
      <button className="model-trigger" onClick={() => setOpen(o => !o)}>
        {current?.displayName || 'Model'}
        {chips.length
          ? chips.map((c, i) => <span key={c + i} className="ext ext-effort">{t(c)}</span>)
          : (extended && current?.hasReasoning && <span className="ext">Extended</span>)}
        <ChevDown style={{ width: 16, height: 16 }} />
      </button>
      {open && <div className="model-scrim" onClick={() => setOpen(false)} />}
      {open && (
        <div ref={menuRef} className={'model-menu' + (place.down ? ' up' : '')} style={place.maxH ? { maxHeight: place.maxH, overflowY: 'auto' } : undefined}>
          <div className="model-main-list" ref={listRef} style={listMaxH ? { maxHeight: listMaxH, overflowY: 'auto' } : undefined}>
            {main.map(Opt)}
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
                  <div className="mo-name">Extended</div>
                  <div className="mo-desc">Always uses deep reasoning</div>
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
                  <div className="mo-name">Background in chat</div>
                  <div className="mo-desc">Keep this model's backdrop during conversations</div>
                </div>
                <div className={'switch' + (bgInChat ? ' on' : '')} />
              </div>
            </>
          )}
          {groups.length > 0 && (
            <>
              <hr />
              {groups.map(g => <MoreGroup key={g.label} label={g.label} items={g.items} renderOpt={Opt} openKey={openSub} setOpenKey={setOpenSub} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
