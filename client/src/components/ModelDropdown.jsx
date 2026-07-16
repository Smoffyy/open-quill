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

const capLevel = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function MoreGroup({ label, items, renderOpt }) {
  const [open, setOpen] = useState(false);
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
  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 160); };
  return (
    <div className="more-wrap" ref={rowRef} onMouseEnter={show} onMouseLeave={hide}>
      <button className={'submenu-row' + (open ? ' active' : '')} onClick={() => (open ? hide() : show())}>
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

export default function ModelDropdown({ models, currentId, onSelect, extended, onToggleExtended, up, modelHasBg, bgInChat, onToggleBgInChat, reasoningEffort, onSetEffort }) {
  const [open, setOpen] = useState(false);
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
  const effortLevels = (current?.effortLevels && current.effortLevels.length) ? current.effortLevels : ['low', 'medium', 'high'];
  const effortBool = effortLevels.length === 2 && effortLevels.some(x => /^true$/i.test(x)) && effortLevels.some(x => /^false$/i.test(x));
  const effortFallback = effortBool ? effortLevels.find(x => /^false$/i.test(x)) : (effortLevels[Math.floor(effortLevels.length / 2)] || effortLevels[0]);
  const effortActive = effortLevels.includes(reasoningEffort) ? reasoningEffort
    : (effortLevels.includes(current?.effortDefault) ? current.effortDefault : effortFallback);
  const effortIdx = Math.max(0, effortLevels.indexOf(effortActive));
  const effortTrueVal = effortBool ? effortLevels.find(x => /^true$/i.test(x)) : null;
  const effortFalseVal = effortBool ? effortLevels.find(x => /^false$/i.test(x)) : null;
  const thinkingOn = effortBool && /^true$/i.test(effortActive);
  const main = models.filter(m => !m.inMoreModels);
  const groups = [];
  {
    const seen = new Map();
    for (const m of models) {
      if (!m.inMoreModels) continue;
      const label = (m.moreModelsLabel || '').trim() || 'More models';
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
      {m.id === currentId && <Check className="check" />}
      {m.capCompact && <CapInfo m={m} />}
    </button>
  );

  return (
    <div className="model-select" ref={ref}>
      <button className="model-trigger" onClick={() => setOpen(o => !o)}>
        {current?.displayName || 'Model'}
        {current?.effortEnabled
          ? (effortBool
              ? (thinkingOn && <span className="ext ext-effort">Thinking</span>)
              : <span className="ext ext-effort">{capLevel(effortActive)}</span>)
          : (extended && current?.hasReasoning && <span className="ext">Extended</span>)}
        <ChevDown style={{ width: 16, height: 16 }} />
      </button>
      {open && <div className="model-scrim" onClick={() => setOpen(false)} />}
      {open && (
        <div ref={menuRef} className={'model-menu' + (place.down ? ' up' : '')} style={place.maxH ? { maxHeight: place.maxH, overflowY: 'auto' } : undefined}>
          <div className="model-main-list" ref={listRef} style={listMaxH ? { maxHeight: listMaxH, overflowY: 'auto' } : undefined}>
            {main.map(Opt)}
          </div>
          {current?.effortEnabled ? (
            effortBool ? (
              <>
                <hr />
                <div className="toggle-row" onClick={() => onSetEffort && onSetEffort(thinkingOn ? effortFalseVal : effortTrueVal)}>
                  <div className="tr-main">
                    <div className="mo-name">Extended thinking</div>
                    <div className="mo-desc">Let the model think before answering</div>
                  </div>
                  <div className={'switch' + (thinkingOn ? ' on' : '')} />
                </div>
              </>
            ) : (
              <>
                <hr />
                <div className="effort-row">
                  <div className="effort-head">
                    <span className="mo-name">Reasoning effort</span>
                    <span className="effort-cur">{capLevel(effortActive)}</span>
                  </div>
                  <div className="effort-seg" style={{ '--n': effortLevels.length, '--i': effortIdx }}>
                    <span className="effort-seg-thumb" />
                    {effortLevels.map((lvl, i) => (
                      <button key={lvl} className={'effort-seg-btn' + (i === effortIdx ? ' on' : '')} onClick={() => onSetEffort && onSetEffort(lvl)}>{capLevel(lvl)}</button>
                    ))}
                  </div>
                </div>
              </>
            )
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
              {groups.map(g => <MoreGroup key={g.label} label={g.label} items={g.items} renderOpt={Opt} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
