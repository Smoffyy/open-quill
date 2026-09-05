import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { t } from '../../i18n.jsx';
import { useTheme } from '../../lib/theme/store.jsx';

/* The very first thing an owner sees on a fresh workspace. It is deliberately a
   layout picker rather than a settings screen: pick a starting point, keep
   working, and restyle it later. The list comes from the server's builtin seeds,
   so a layout added there shows up here without touching this file.

   Picking one also publishes it. On a brand-new workspace there is nothing to
   protect, and leaving the choice staged would mean the first member to join
   rendered a different interface from the person who chose it. */

const KNOWN_SWATCH = new Set(['anthropic', 'openai', 'blank']);

export default function FirstRun({ onDone }) {
  const { reload } = useTheme();
  const [themes, setThemes] = useState([]);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/api/admin/themes')
      .then(r => { if (live) setThemes((r.themes || []).filter(x => x.builtin)); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function choose(id) {
    if (busy) return;
    setBusy(id);
    try {
      await api.post(`/api/admin/themes/${id}/activate`, {});
      await api.post('/api/admin/themes/publish', {});
      await reload();
    } catch { /* the picker closes either way; the layout is changeable later */ }
    onDone();
  }

  if (!themes.length) return null;

  return (
    <div className="preset-scrim">
      <div className="preset-modal">
        <h2 className="preset-title">{t('Choose a starting layout')}</h2>
        <p className="preset-sub">
          {t('Every layout is a starting point, not a fixed skin. You can restyle any part of it later in Admin → Interface.')}
        </p>
        <div className="preset-grid">
          {themes.map(th => (
            <button key={th.id} type="button" className={'preset-card' + (busy === th.id ? ' busy' : '')}
              disabled={!!busy} onClick={() => choose(th.id)}>
              <span className={'preset-swatch ' + (KNOWN_SWATCH.has(th.id) ? th.id : 'plain')}>
                <span className="ps-dot" />
              </span>
              <span className="preset-name">{th.name}</span>
              <span className="preset-desc">{t(th.blurb || th.note || '')}</span>
            </button>
          ))}
        </div>
        <p className="preset-foot">{t('You can switch layouts, or design your own, at any time.')}</p>
      </div>
    </div>
  );
}
