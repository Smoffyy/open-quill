import { useState, useMemo, useEffect } from 'react';
import { t } from '../i18n.jsx';
import { Chevron, Search } from './icons.jsx';
import { docsSearch } from '../lib/modeldocs.js';

function Item({ label, active, indent = false, onClick }) {
  return (
    <button className={'dnav-item' + (active ? ' on' : '') + (indent ? ' sub' : '')}
      aria-current={active ? 'page' : undefined} onClick={onClick}>
      <span className="dnav-text">{label}</span>
    </button>
  );
}

function Group({ group, open, onToggle, target, onSelect }) {
  return (
    <div className="dnav-group">
      <button className={'dnav-item dnav-toggle' + (open ? ' open' : '')} aria-expanded={open} onClick={onToggle}>
        <span className="dnav-text">{group.label}</span>
        <Chevron className="dnav-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="dnav-children">
          {group.models.map(m => (
            <Item key={m.id} indent label={m.displayName}
              active={target.kind === 'model' && target.id === m.id}
              onClick={() => onSelect({ kind: 'model', id: m.id })} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocsNav({ tree, target, onSelect, onExit, appName }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const view = useMemo(() => docsSearch(tree, query) || tree, [tree, query]);
  const searching = query.trim().length > 0;

  useEffect(() => {
    if (target.kind !== 'model') return;
    const g = tree.models.groups.find(x => x.models.some(m => m.id === target.id));
    if (g) setOpen(s => (s.has(g.id) ? s : new Set([...s, g.id])));
  }, [tree, target]);

  const toggle = (id) => setOpen(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="dnav">
      <div className="dnav-head">
        <button className="dnav-back" onClick={onExit}>
          <Chevron className="dnav-back-chev" aria-hidden="true" />
          <span>{appName || t('Back')}</span>
        </button>
      </div>
      <div className="dnav-searchbox">
        <span className="dnav-search-ic"><Search /></span>
        <input className="dnav-search" type="search" value={query} placeholder={t('Search')}
          aria-label={t('Search the reference')} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="dnav-scroll">
        <div className="dnav-section">
          <div className="dnav-heading">{view.models.label}</div>
          {(!searching || tree.overviewLabel.toLowerCase().includes(query.trim().toLowerCase())) && (
            <Item label={tree.overviewLabel} active={target.kind === 'overview'}
              onClick={() => onSelect({ kind: 'overview', id: null })} />
          )}
          {view.models.top.map(m => (
            <Item key={m.id} label={m.displayName} active={target.kind === 'model' && target.id === m.id}
              onClick={() => onSelect({ kind: 'model', id: m.id })} />
          ))}
          {view.models.groups.map(g => (
            <Group key={g.id} group={g} open={searching || open.has(g.id)} onToggle={() => toggle(g.id)}
              target={target} onSelect={onSelect} />
          ))}
          {searching && view.models.top.length === 0 && view.models.groups.length === 0 && view.sections.length === 0
            && !tree.overviewLabel.toLowerCase().includes(query.trim().toLowerCase()) && (
            <div className="dnav-empty">{t('No matches')}</div>
          )}
        </div>
        {view.sections.map(s => (
          <div className="dnav-section" key={s.id}>
            <div className="dnav-heading">{s.label}</div>
            {s.pages.map(p => (
              <Item key={p.id} label={p.title} active={target.kind === 'page' && target.id === p.id}
                onClick={() => onSelect({ kind: 'page', id: p.id })} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
