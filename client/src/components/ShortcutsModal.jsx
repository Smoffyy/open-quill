import React, { useMemo, useRef } from 'react';
import { useFocusTrap } from '../lib/focus.js';
import { t } from '../i18n.jsx';

const GROUPS = [
  { title: 'General', items: [
    ['Command palette', ['Ctrl', 'K']],
    ['Search chats', ['Ctrl', 'Shift', 'F']],
    ['New chat', ['Ctrl', 'Shift', 'O']],
    ['Toggle sidebar', ['Ctrl', 'Shift', 'S']],
    ['Shortcuts (this)', ['?']],
  ]},
  { title: 'Composer', items: [
    ['Send message', ['Enter']],
    ['New line', ['Shift', 'Enter']],
    ['Attach files', ['Ctrl', 'U']],
    ['Paste image', ['Ctrl', 'V']],
  ]},
  { title: 'In this conversation', items: [
    ['Find in conversation', ['Ctrl', 'F'], 'threadFind'],
    ['Next / previous match', ['Enter', 'Shift+Enter'], 'threadFind'],
    ['Branch map', ['B'], 'branchMap'],
    ['Jump between messages', ['J', 'K'], 'msgKeys'],
  ]},
  { title: 'Focused message', items: [
    ['Copy', ['C'], 'msgKeys'],
    ['Edit (your message)', ['E'], 'msgKeys'],
    ['Retry (assistant)', ['R'], 'msgKeys'],
    ['Branch into new chat', ['Y'], 'msgKeys'],
    ['Clear focus', ['Esc'], 'msgKeys'],
  ]},
  { title: 'Messages', items: [
    ['Pin / unpin', ['Hover', '📌']],
    ['Cycle versions', ['‹', '›']],
  ]},
];

function Keys({ keys }) {
  return <span className="kbd-row">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>;
}

export default function ShortcutsModal({ prefs, onClose }) {
  const boxRef = useRef(null);
  useFocusTrap(boxRef, onClose);
  const groups = useMemo(() => GROUPS
    .map(g => ({ ...g, items: g.items.filter(([, , need]) => !need || (prefs || {})[need] !== false) }))
    .filter(g => g.items.length), [prefs]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="shortcuts-modal" ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="oq-sc-title">
        <button className="modal-close" onClick={onClose} aria-label={t('Close')} title={t('Close')}>✕</button>
        <h2 className="sc-title" id="oq-sc-title">{t('Keyboard shortcuts')}</h2>
        <div className="sc-grid">
          {groups.map(g => (
            <div className="sc-group" key={g.title}>
              <div className="sc-group-title">{t(g.title)}</div>
              {g.items.map(([label, keys], i) => (
                <div className="sc-item" key={i} style={{ animationDelay: (i * 22) + 'ms' }}>
                  <span className="sc-label">{t(label)}</span>
                  <Keys keys={keys} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
