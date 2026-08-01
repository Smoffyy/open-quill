import React, { useMemo, useRef } from 'react';
import { useFocusTrap } from '../lib/focus.js';
import { t } from '../i18n.jsx';
import { KEYBIND_ACTIONS, comboKeys, resolveKeybinds } from '../lib/keybinds.js';

const STATIC_GROUPS = [
  { title: 'Composer', items: [
    ['Send message', ['Enter']],
    ['New line', ['Shift', 'Enter']],
    ['Attach files', ['Ctrl', 'U']],
    ['Paste image', ['Ctrl', 'V']],
  ]},
  { title: 'In this conversation', items: [
    ['Next / previous match', ['Enter', 'Shift+Enter'], 'threadFind'],
  ]},
  { title: 'Messages', items: [
    ['Pin / unpin', ['Hover', '📌']],
    ['Cycle versions', ['‹', '›']],
  ]},
];

const GROUP_ORDER = ['General', 'Composer', 'In this conversation', 'Focused message', 'Messages'];

function Keys({ keys }) {
  return <span className="kbd-row">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>;
}

export default function ShortcutsModal({ prefs, onClose, onCustomize }) {
  const boxRef = useRef(null);
  useFocusTrap(boxRef, onClose);
  const groups = useMemo(() => {
    const p = prefs || {};
    const binds = resolveKeybinds(p);
    const map = new Map();
    const push = (title, item) => {
      if (!map.has(title)) map.set(title, []);
      map.get(title).push(item);
    };
    for (const a of KEYBIND_ACTIONS) {
      if (a.pref && p[a.pref] === false) continue;
      push(a.group, [a.label, comboKeys(binds[a.id])]);
    }
    for (const g of STATIC_GROUPS) {
      for (const [label, keys, need] of g.items) {
        if (need && p[need] === false) continue;
        push(g.title, [label, keys]);
      }
    }
    return [...map.entries()]
      .filter(([, items]) => items.length)
      .sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]))
      .map(([title, items]) => ({ title, items }));
  }, [prefs]);
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
        {onCustomize && (
          <div className="sc-foot">
            <button className="btn ghost" onClick={onCustomize}>{t('Customize shortcuts')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
