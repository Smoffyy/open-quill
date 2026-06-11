import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevDown, Chevron } from './icons.jsx';

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
    <button key={m.id} className="model-opt" onClick={() => { onSelect(m.id); setOpen(false); setShowMore(false); }}>
      {m.dropdownIcon !== false && <img className="mo-icon" src={m.staticIcon || '/starburst.svg'} alt="" />}
      <div className="mo-main">
        <div className="mo-name">{m.displayName}</div>
        {m.description && <div className="mo-desc">{m.description}</div>}
      </div>
      {m.id === currentId && <Check className="check" />}
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
