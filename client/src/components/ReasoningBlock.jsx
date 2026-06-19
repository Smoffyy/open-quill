import React, { useState } from 'react';
import { Chevron } from './icons.jsx';

export default function ReasoningBlock({ text, live, collapsible = true }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  if (!collapsible) {
    if (!live) return null;
    return (
      <div className="reasoning">
        <div className="reasoning-head static">
          <img src="/starburst.svg" className="pulse think-dot" alt="" />
          <span><span className="rb-label">Thinking…</span></span>
        </div>
      </div>
    );
  }
  const label = live ? 'Thinking…' : (open ? 'Hide reasoning' : 'Thought process');
  return (
    <div className="reasoning">
      <button className={'reasoning-head' + (open ? ' open' : '') + (live ? ' live' : '')} onClick={() => setOpen(o => !o)}>
        {live && <img src="/starburst.svg" className="pulse think-dot" alt="" />}
        <span><span className="rb-label">{label}</span></span>
        <Chevron className="chev" />
      </button>
      <div className={'reasoning-collapse' + (open ? ' open' : '')}>
        <div className="reasoning-body">{text}</div>
      </div>
    </div>
  );
}
