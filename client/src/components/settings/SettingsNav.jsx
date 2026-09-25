import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Gear, Chat, Info, Clock, Shield, Brain, Keyboard, Search, SkillIcon, Plug, Palette } from '../ui/icons.jsx';
import { t, tk } from '../../i18n.jsx';
import { menuStyleOf, useAnchoredMenu } from '../../lib/anchor.js';

export const NAV_GROUPS = [
  { label: tk('Settings'), items: [
    { id: 'general', label: tk('General'), Icon: Gear },
    { id: 'interface', label: tk('Interface'), Icon: Palette },
    { id: 'security', label: tk('Security'), Icon: Shield },
    { id: 'chat', label: tk('Chat'), Icon: Chat },
    { id: 'keybinds', label: tk('Keybinds'), Icon: Keyboard },
    { id: 'memory', label: tk('Memory'), Icon: Brain, needs: 'memoryFeature' },
    { id: 'usage', label: tk('Usage'), Icon: Clock },
  ] },
  { label: tk('Customize'), items: [
    { id: 'skills', label: tk('Skills'), Icon: SkillIcon },
    { id: 'mcp', label: tk('MCP'), Icon: Plug },
  ] },
  { label: tk('About'), items: [
    { id: 'version', label: tk('Version'), Icon: Info },
  ] },
];

export const TAB_LABELS = Object.fromEntries(NAV_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label])));

const SETTINGS_INDEX = {
  __proto__: null,
  general: [
    tk('What should we call you?'), tk('Language'), tk('Instructions for the Assistant'), tk('Export everything'), tk('Import'),
  ],
  interface: [
    tk('Theme'), tk('Chat font'), tk('Message density'), tk('Reading width'), tk('OLED screen protection'),
    tk('Text reveal'), tk('Reveal speed'), tk('Streaming cursor'), tk('Cursor style'), tk('Blink speed'), tk('Pulse speed'),
    tk('Conversation map'), tk('Find in conversation'), tk('Branch map'), tk('Message shortcuts'),
  ],
  security: [tk('Password'), tk('Two-factor authentication'), tk('Active sessions')],
  chat: [
    tk('Auto-scroll'),
    tk('Web search on by default'), tk('Engine telemetry'), tk('Context gauge'),
    tk('Speed on each reply'), tk('Progress line'), tk('Context ledger on open'), tk('Mid-stream steering'),
  ],
  memory: [tk('Use memory in chats'), tk('Update from recent chats'), tk('Forget everything')],
  skills: [tk('Browse'), tk('Add'), tk('Create with the assistant'), tk('Write skill instructions'), tk('Upload a skill')],
  mcp: [tk('Add server'), tk('Server name'), tk('URL'), tk('Headers'), tk('From this workspace')],
  usage: [tk('Usage window'), tk('By model')],
  version: [tk('Release notes'), tk('Changelog'), tk('Copy details')],
};

function Marked({ text, needle }) {
  if (!needle) return text;
  const at = text.toLowerCase().indexOf(needle);
  if (at === -1) return text;
  return <>{text.slice(0, at)}<span className="ms-hit">{text.slice(at, at + needle.length)}</span>{text.slice(at + needle.length)}</>;
}

function searchSettings(needle, cfg) {
  const out = [];
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (it.needs && !cfg?.[it.needs]) continue;
      const page = t(it.label);
      const pageHit = page.toLowerCase().includes(needle);
      const hits = (SETTINGS_INDEX[it.id] || []).map(s => t(s)).filter(s => s.toLowerCase().includes(needle));
      if (pageHit || hits.length) out.push({ ...it, page, pageHit, hits });
    }
  }
  return out;
}

export default function SettingsNav({ tab, cfg, onPick }) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef(null);
  const menuRef = useRef(null);
  const needle = q.trim().toLowerCase();
  const results = needle ? searchSettings(needle, cfg) : [];
  const open = !!needle;
  const pos = useAnchoredMenu(open, () => setQ(''), boxRef, menuRef, { align: 'left', minWidth: 280, gap: 4 });

  useEffect(() => { setCursor(0); }, [q]);

  function pick(id, hit) { onPick(id, hit || null); setQ(''); }
  function onKey(e) {
    if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[Math.min(cursor, results.length - 1)];
      pick(r.id, !r.pageHit && r.hits.length === 1 ? r.hits[0] : null);
    }
  }

  return (
    <nav className="modal-side" aria-label={t('Settings')}>
      <div className="ms-searchbox" ref={boxRef}>
        <div className="ms-search">
          <Search />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder={t('Search')} aria-label={t('Search settings')} />
        </div>
        {open && createPortal(
          <div className="ms-results" role="listbox" ref={menuRef}
            style={menuStyleOf(pos, { width: 280, maxHeight: Math.min(320, (pos && pos.maxH) || 320), overflow: 'hidden auto' })}>
            {!results.length && <div className="ms-empty">{t('No matching settings')}</div>}
            {results.map((r, i) => (
              <div key={r.id} className="ms-res">
                <button className={'ms-res-page' + (i === cursor ? ' on' : '')} role="option" aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)} onClick={() => pick(r.id)}>
                  <r.Icon />
                  <span className="ms-res-name"><Marked text={r.page} needle={needle} /></span>
                </button>
                {!r.pageHit && r.hits.length === 1 && (
                  <button className="ms-res-sub" onClick={() => pick(r.id, r.hits[0])}><Marked text={r.hits[0]} needle={needle} /></button>
                )}
                {r.hits.length > 1 && r.hits.map(h => (
                  <button key={h} className="ms-res-line" onClick={() => pick(r.id, h)}>
                    <span className="ms-res-name"><Marked text={h} needle={needle} /></span>
                  </button>
                ))}
              </div>
            ))}
          </div>, document.body)}
      </div>
      <div className="ms-nav">
        {NAV_GROUPS.map(g => {
          const items = g.items.filter(i => !i.needs || cfg?.[i.needs]);
          if (!items.length) return null;
          return (
            <div className="ms-sec" key={g.label}>
              <div className="ms-group">{t(g.label)}</div>
              {items.map(({ id, label, Icon }) => (
                <button key={id} className={'modal-tab' + (tab === id ? ' active' : '')}
                  aria-current={tab === id ? 'page' : undefined} onClick={() => onPick(id, null)}>
                  <Icon /> {t(label)}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
