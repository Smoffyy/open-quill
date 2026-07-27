import React, { useEffect } from 'react';

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
  { title: 'Messages', items: [
    ['Edit (your message)', ['Hover', '✎']],
    ['Fork into new chat', ['Hover', '⑂']],
    ['Pin / unpin', ['Hover', '📌']],
    ['Cycle versions', ['‹', '›']],
  ]},
];

function Keys({ keys }) {
  return <span className="kbd-row">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>;
}

export default function ShortcutsModal({ onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="shortcuts-modal">
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="sc-title">Keyboard shortcuts</h2>
        <div className="sc-grid">
          {GROUPS.map(g => (
            <div className="sc-group" key={g.title}>
              <div className="sc-group-title">{g.title}</div>
              {g.items.map(([label, keys], i) => (
                <div className="sc-item" key={i} style={{ animationDelay: (i * 22) + 'ms' }}>
                  <span className="sc-label">{label}</span>
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
