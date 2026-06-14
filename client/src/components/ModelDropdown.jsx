import React, { useState, useRef, useEffect } from 'react';
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

export default function ModelDropdown({ models, currentId, onSelect, extended, onToggleExtended, up }) {
  const [open, setOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setShowMore(false); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const current = models.find(m => m.id === currentId);
  const main = models.filter(m => !m.inMoreModels);
  const more = models.filter(m => m.inMoreModels);
  const moreLabel = more[0]?.moreModelsLabel || 'More models';
  const list = showMore ? more : main;

  const Opt = (m) => (
    <button key={m.id} className={'model-opt' + (m.unavailable ? ' unavail' : '')} onClick={() => { onSelect(m.id); setOpen(false); setShowMore(false); }}
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
        <div className={'model-menu' + (up ? ' up' : '')}>
          {showMore && (
            <button className="submenu-row" onClick={() => setShowMore(false)} style={{ color: 'var(--text-muted)' }}>
              <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}><Chevron style={{ width: 15 }} /></span>
              <span style={{ marginLeft: 6 }}>{moreLabel}</span>
            </button>
          )}
          {list.map(Opt)}
          {!showMore && current?.hasReasoning && (
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
          {!showMore && more.length > 0 && (
            <>
              <hr />
              <button className="submenu-row" onClick={() => setShowMore(true)}>
                <span>{moreLabel}</span><Chevron style={{ width: 15 }} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
