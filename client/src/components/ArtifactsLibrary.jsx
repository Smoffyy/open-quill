import { useState, useEffect } from 'react';
import { api } from '../api.js';
import LibraryPage, { LibraryEmpty } from './LibraryPage.jsx';
import { Plus, ChevDown, Paper } from './icons.jsx';
import { t } from '../i18n.jsx';

const KB = 1024;
const sizeLabel = (n) => (n >= KB * KB ? (n / (KB * KB)).toFixed(1) + ' MB' : n >= KB ? Math.round(n / KB) + ' KB' : n + ' B');

function ArtifactCard({ item, onOpen }) {
  return (
    <button type="button" className="lib-card" onClick={onOpen}>
      <div className="lib-card-preview" aria-hidden="true">
        {item.preview
          ? <pre className="lib-card-snippet">{item.preview}</pre>
          : <span className="lib-card-ext">{item.ext || 'file'}</span>}
      </div>
      <div className="lib-card-foot">
        <span className="lib-card-title">{item.name}</span>
        <span className="lib-card-meta">{item.chatTitle || t('Untitled')} · {sizeLabel(item.size)}</span>
      </div>
    </button>
  );
}

export default function ArtifactsLibrary({ onSearch, onNew, onOpen }) {
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    api.get('/api/artifacts')
      .then(r => { if (live) setItems(r.artifacts || []); })
      .catch(() => { if (live) setItems([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const shown = items.filter(i => filter === 'all' || i.ext === filter);
  const exts = [...new Set(items.map(i => i.ext).filter(Boolean))].sort();

  return (
    <LibraryPage
      title={t('Artifacts')}
      onSearch={onSearch}
      actions={<>
        <button className="lib-pill" onClick={() => {
          const i = exts.indexOf(filter);
          setFilter(i === -1 ? (exts[0] || 'all') : (exts[i + 1] || 'all'));
        }}>
          <span className="lib-pill-key">{t('Filter by')}</span>
          <span className="lib-pill-val">{filter === 'all' ? t('All') : filter}</span>
          <ChevDown />
        </button>
        <button className="lib-primary" onClick={onNew}><Plus /> {t('New artifact')}</button>
      </>}>
      {loading ? null : shown.length === 0 ? (
        <LibraryEmpty icon={<Paper />} line={t('No artifacts yet.')} />
      ) : (
        <div className="lib-grid">{shown.map(i => (
          <ArtifactCard key={i.id} item={i} onOpen={() => onOpen && onOpen(i)} />
        ))}</div>
      )}
    </LibraryPage>
  );
}
