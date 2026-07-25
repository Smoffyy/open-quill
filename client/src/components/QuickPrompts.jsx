import React, { useState, useEffect } from 'react';
import { t } from '../i18n.jsx';
import { QpIcon } from '../qpIcons.jsx';

export default function QuickPrompts({ prompts, visible, disabled, onPick }) {
  const [render, setRender] = useState(visible);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (visible) { setRender(true); setLeaving(false); return; }
    if (!render) return;
    setLeaving(true);
    const off = document.documentElement.getAttribute('data-entrance') === 'off';
    const dur = off ? 0 : 260 + prompts.length * 45 + 60;
    const t = setTimeout(() => setRender(false), dur);
    return () => clearTimeout(t);
  }, [visible]);
  const keepSpace = document.documentElement.getAttribute('data-preset') === 'openai';
  if (!render && !keepSpace) return null;
  return (
    <div className={'quick-prompts' + (leaving ? ' leaving' : '') + (keepSpace && !visible ? ' qp-ghost' : '')}>
      {prompts.map((q, i) => (
        <button key={i} className="quick-prompt" style={{ animationDelay: i * 45 + 'ms' }} onClick={() => onPick(t(q.prompt))} disabled={disabled}>
          {q.icon && q.icon !== 'none' && <span className="qp-icon"><QpIcon name={q.icon} style={{ width: 15, height: 15 }} /></span>}{t(q.label)}
        </button>
      ))}
    </div>
  );
}
