import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { api } from '../../lib/api.js';
import Markdown from '../chat/Markdown.jsx';
import { LibraryEmpty, LibraryGridSkeleton } from '../pages/LibraryPage.jsx';
import { Search, Paper, X } from '../ui/icons.jsx';
import Tip from '../ui/Tip.jsx';
import { t } from '../../i18n.jsx';
import { useSkeleton } from '../../lib/skeleton.js';

const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;

function dateLabel(ms) {
  if (!ms) return '';
  const age = Date.now() - ms;
  if (age < MINUTE) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(0, 'second');
  const d = new Date(ms);
  const opts = age > 300 * DAY ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

const DESIGN_WIDTH = { html: 1280, md: 720 };

function Scaled({ width, children }) {
  const box = useRef(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    const fit = () => setScale(el.clientWidth / width);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={box} className="alib-scaled">
      <div className="alib-scaled-inner" style={{ width, transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}>{children}</div>
    </div>
  );
}

function svgSource(markup) {
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#ccc';
  const withNs = /<svg[^>]*\sxmlns=/.test(markup) ? markup : markup.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(withNs.replace(/currentColor/gi, ink));
}

function Thumb({ item }) {
  const svg = useMemo(() => (item.rendered && item.ext === 'svg' ? svgSource(item.preview) : ''), [item]);
  if (svg) return <img className="alib-card-img" alt="" src={svg} />;
  if (item.rendered && item.ext === 'html') {
    return (
      <Scaled width={DESIGN_WIDTH.html}>
        <iframe className="alib-card-frame" sandbox="" srcDoc={item.preview} tabIndex={-1} loading="lazy" referrerPolicy="no-referrer" />
      </Scaled>
    );
  }
  if (item.ext === 'md' && item.preview) {
    return <Scaled width={DESIGN_WIDTH.md}><div className="art-md alib-card-md"><Markdown>{item.preview}</Markdown></div></Scaled>;
  }
  return item.preview
    ? <pre className="alib-card-snippet">{item.preview}</pre>
    : <span className="alib-card-ext">{item.ext || 'file'}</span>;
}

function ArtifactCard({ item, index, onOpen }) {
  return (
    <button type="button" className="alib-card" style={{ animationDelay: (index % 18) * 26 + 'ms' }} onClick={onOpen}>
      <div className="alib-card-preview" aria-hidden="true">
        <div className={'alib-card-page' + (item.rendered || item.ext === 'md' ? ' rendered' : '')}>
          <Thumb item={item} />
        </div>
      </div>
      <div className="alib-card-foot">
        <span className="alib-card-title">{item.name}</span>
        <span className="alib-card-meta">{dateLabel(item.updated_at)}</span>
      </div>
    </button>
  );
}

export default function ArtifactsLibrary({ onOpen }) {
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [exts, setExts] = useState([]);
  const input = useRef(null);
  const showSkeleton = useSkeleton(loading);

  useEffect(() => {
    const id = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let live = true;
    api.get('/api/artifacts' + (term ? '?q=' + encodeURIComponent(term) : ''))
      .then(r => {
        if (!live) return;
        const list = r.artifacts || [];
        setItems(list);
        if (!term) setExts([...new Set(list.map(i => i.ext).filter(Boolean))].sort());
      })
      .catch(() => { if (live) setItems([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [term]);

  useEffect(() => {
    if (searching) input.current?.focus();
  }, [searching]);

  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };

  const tabs = [{ id: 'all', label: t('All') }, ...exts.map(e => ({ id: e, label: e.toUpperCase() }))];
  const shown = items.filter(i => filter === 'all' || i.ext === filter);

  return (
    <div className="lib-page alib-page">
      <div className="alib-col">
        <h1 className="alib-title">{t('Artifacts')}</h1>
        <div className="alib-bar">
          <div className="alib-tabs" role="tablist">
            {tabs.map(tab => (
              <button key={tab.id} type="button" role="tab" aria-selected={filter === tab.id}
                className={'alib-tab' + (filter === tab.id ? ' on' : '')}
                onClick={() => setFilter(tab.id)}>{tab.label}</button>
            ))}
          </div>
          {searching ? (
            <div className="alib-search">
              <Search />
              <input ref={input} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search artifacts…')}
                aria-label={t('Search artifacts…')} spellCheck={false}
                onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); closeSearch(); } }} />
              <button type="button" className="alib-search-x" onClick={closeSearch} aria-label={t('Close search')}><X /></button>
            </div>
          ) : (
            <Tip label={t('Search')}>
              <button className="alib-icon-btn" onClick={() => setSearching(true)} aria-label={t('Search')}><Search /></button>
            </Tip>
          )}
        </div>
        <div className="alib-body">
          {loading ? (showSkeleton ? <LibraryGridSkeleton /> : null) : shown.length === 0 ? (
            term
              ? <p className="alib-none">{t('No artifacts matching "{query}"', { query: term })}</p>
              : <LibraryEmpty icon={<Paper />} line={t('No artifacts yet. Ask for a document in any chat and it is kept here.')} />
          ) : (
            <div className="alib-grid">{shown.map((i, n) => (
              <ArtifactCard key={i.id} item={i} index={n} onOpen={() => onOpen && onOpen(i)} />
            ))}</div>
          )}
        </div>
      </div>
    </div>
  );
}