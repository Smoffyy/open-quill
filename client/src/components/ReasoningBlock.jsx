import React, { useState } from 'react';
import { Chevron } from './icons.jsx';
import { t } from '../i18n.jsx';

export default function ReasoningBlock({ text, live, collapsible = true }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  if (!collapsible) {
    if (!live) return null;
    return (
      <div className="reasoning">
        <div className="reasoning-head static live">
          <span><span className="rb-label">{t("Thinking…")}</span></span>
        </div>
      </div>
    );
  }
  const label = live ? 'Thinking…' : (open ? t('Hide reasoning') : t('Thought process'));
  return (
    <div className="reasoning">
      <button className={'reasoning-head' + (open ? ' open' : '') + (live ? ' live' : '')} onClick={() => setOpen(o => !o)}>
        <span><span className="rb-label">{label}</span></span>
        <Chevron className="chev" />
      </button>
      <div className={'reasoning-collapse' + (open ? ' open' : '')}>
        <div className="reasoning-body">{text}</div>
      </div>
    </div>
  );
}
