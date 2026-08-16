import { useState, useEffect, useRef } from 'react';
import { useFocusTrap } from '../lib/focus.js';
import { t } from '../i18n.jsx';

export default function CommandPalette({ commands, onClose }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const boxRef = useRef(null);
  useFocusTrap(boxRef, onClose, { initial: inputRef });
  const filtered = commands.filter(c => {
    const s = (c.label + ' ' + (c.keywords || '')).toLowerCase();
    return q.trim().toLowerCase().split(/\s+/).every(t => s.includes(t));
  });
  useEffect(() => { setIdx(0); }, [q]);
  function run(c) { onClose(); c.action(); }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = filtered[idx]; if (c) run(c); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
  useEffect(() => {
    const el = listRef.current?.children[idx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [idx]);
  return (
    <div className="overlay cmdk-overlay" onMouseDown={(e) => e.target.classList.contains('cmdk-overlay') && onClose()}>
      <div className="cmdk" ref={boxRef} role="dialog" aria-modal="true" aria-label={t('Command palette')}>
        <input ref={inputRef} className="cmdk-input" placeholder={t('Type a command…')} aria-label={t('Command palette')} aria-expanded="true" aria-controls="oq-cmdk-list" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        <div className="cmdk-list" id="oq-cmdk-list" role="listbox" aria-label={t('Commands')} ref={listRef}>
          {filtered.length === 0 && <div className="cmdk-empty">{t('No matching commands')}</div>}
          {filtered.map((c, i) => (
            <button key={c.id} role="option" aria-selected={i === idx} className={'cmdk-item' + (i === idx ? ' active' : '')} onMouseMove={() => setIdx(i)} onClick={() => run(c)}>
              <span className="cmdk-label">{c.label}</span>
              {c.shortcut && <span className="cmdk-shortcut">{c.shortcut}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
