import React, { useState } from 'react';
import { Chevron } from './icons.jsx';

export default function ReasoningBlock({ text, live }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const label = live ? 'Thinking…' : (open ? 'Hide reasoning' : 'Thought process');
  return (
    <div className="reasoning">
      <button className={'reasoning-head' + (open ? ' open' : '')} onClick={() => setOpen(o => !o)}>
        {live && <img src="/starburst.svg" className="pulse think-dot" alt="" />}
        <span>{label}</span>
        <Chevron className="chev" />
      </button>
      <div className={'reasoning-collapse' + (open ? ' open' : '')}>
        <div className="reasoning-body">{text}</div>
      </div>
    </div>
  );
}
