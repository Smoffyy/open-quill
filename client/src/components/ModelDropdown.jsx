import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Check, ChevDown, Chevron, ImageIcon, Brain, Info, TextIcon } from './icons.jsx';

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
        <span key={key} className="mo-cap-ic" title={label}>
          <Icon style={{ width: 12, height: 12 }} />
          <span className="mo-cap-lbl">{label}</span>
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

export default function ModelDropdown({ models, currentId, onSelect, extended, onToggleExtended, up, modelHasBg, bgInChat, onToggleBgInChat }) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [place, setPlace] = useState({ down: !!up, maxH: 0 });
  const [subPlace, setSubPlace] = useState({ up: false, maxH: 0 });
  const ref = useRef(null);
  const menuRef = useRef(null);
  const moreRef = useRef(null);
  const subRef = useRef(null);
  const moreTimer = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setMoreOpen(false); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => () => clearTimeout(moreTimer.current), []);
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
  }, [open]);
  useLayoutEffect(() => {
    if (!moreOpen) return;
    const row = moreRef.current, sub = subRef.current;
    if (!row || !sub) return;
    const rr = row.getBoundingClientRect();
    const subH = sub.scrollHeight;
    const below = window.innerHeight - rr.top;
    const above = rr.bottom;
    const flip = below < subH + 14 && above > below;
    const avail = (flip ? above : below) - 16;
    setSubPlace({ up: flip, maxH: subH > avail ? Math.max(140, avail) : 0 });
  }, [moreOpen]);
  const openMore = () => { clearTimeout(moreTimer.current); setMoreOpen(true); };
  const closeMore = () => { clearTimeout(moreTimer.current); moreTimer.current = setTimeout(() => setMoreOpen(false), 160); };

  const current = models.find(m => m.id === currentId);
  const main = models.filter(m => !m.inMoreModels);
  const more = models.filter(m => m.inMoreModels);
  const moreLabel = more[0]?.moreModelsLabel || 'More models';

  const Opt = (m) => (
    <button key={m.id} className={'model-opt' + (m.unavailable ? ' unavail' : '')} onClick={() => { onSelect(m.id); setOpen(false); setMoreOpen(false); }}
      title={m.unavailable ? (m.displayName + ' is currently unavailable.') : undefined}>
      {m.dropdownIcon !== false && <img className="mo-icon" src={m.staticIcon || '/starburst.svg'} alt="" />}
      <div className="mo-main">
        <div className="mo-name">
          {m.displayName}
          {m.unavailable && <span className="mo-unavail"><span className="mo-unavail-dot">ⓘ</span> Currently unavailable</span>}
        </div>
        {m.description && <div className="mo-desc">{m.description}</div>}
        {!m.capCompact && <CapRow m={m} />}
      </div>
      {m.id === currentId && <Check className="check" />}
      {m.capCompact && <CapInfo m={m} />}
    </button>
  );

  return (
    <div className="model-select" ref={ref}>
      <button className="model-trigger" onClick={() => setOpen(o => !o)}>
        {current?.displayName || 'Model'}
        {extended && current?.hasReasoning && <span className="ext">Extended</span>}
        <ChevDown style={{ width: 15, height: 15 }} />
      </button>
      {open && (
        <div ref={menuRef} className={'model-menu' + (place.down ? ' up' : '')} style={place.maxH ? { maxHeight: place.maxH, overflowY: 'auto' } : undefined}>
          {main.map(Opt)}
          {current?.hasReasoning && (
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
          )}
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
          {more.length > 0 && (
            <>
              <hr />
              <div className="more-wrap" ref={moreRef} onMouseEnter={openMore} onMouseLeave={closeMore}>
                <button className={'submenu-row' + (moreOpen ? ' active' : '')} onClick={() => (moreOpen ? closeMore() : openMore())}>
                  <span>{moreLabel}</span><Chevron style={{ width: 15 }} />
                </button>
                {moreOpen && (
                  <div ref={subRef} className={'model-submenu' + (subPlace.up ? ' up' : '')} style={subPlace.maxH ? { maxHeight: subPlace.maxH, overflowY: 'auto' } : undefined} onMouseEnter={openMore} onMouseLeave={closeMore}>
                    {more.map(Opt)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
