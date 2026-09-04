import { useMemo, useRef } from 'react';
import { X, TextIcon } from './icons.jsx';
import { t } from '../i18n.jsx';
import { useDismiss } from '../lib/dismiss.js';
import { focusUnlessTouch } from '../lib/touch.js';

export default function Outline({ items, onJump, onClose }) {
  const panelRef = useRef(null);
  useDismiss(true, onClose, panelRef);

  const base = useMemo(() => items.reduce((m, it) => Math.min(m, it.level), 6), [items]);

  return (
    <nav className="outline-panel" ref={panelRef} aria-label={t('Contents')}
      style={{ visibility: 'visible' }}>
      <div className="outline-head">
        <TextIcon style={{ width: 15 }} />
        <span className="outline-title">{t('Contents')}</span>
        <button type="button" className="outline-x" onClick={onClose} aria-label={t('Close')} title={t('Close')}>
          <X style={{ width: 14 }} />
        </button>
      </div>
      <div className="outline-list">
        {items.map((it, i) => (
          <button
            key={it.mid + ':' + it.li + ':' + i}
            type="button"
            className={'outline-item lv-' + Math.min(3, Math.max(0, it.level - base))}
            ref={i === 0 ? (el => focusUnlessTouch(el)) : undefined}
            onClick={() => onJump(it)}
            title={it.text}
          >
            <span className="outline-text">{it.text}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
