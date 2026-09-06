import { useState, useEffect, useCallback, useRef } from 'react';
import { t } from '../../i18n.jsx';
import { api } from '../../api.js';
import { useTheme } from '../../lib/theme/store.jsx';
import { toast } from '../../toast.js';
import { Dialog, Confirm, Text } from './controls.jsx';
import { Copy, Trash, Download, Upload, Pencil, Check, Clock, Refresh } from '../icons.jsx';

/* Theme management. A theme is a document plus a name; the builder edits
   whichever one is active, and Publish is what moves the admin's staged store
   over the one members read. */

export function useThemes() {
  const { reload } = useTheme();
  const [list, setList] = useState({ themes: [], activeId: '', publishedActiveId: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setList(await api.get('/api/admin/themes')); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (fn, done) => {
    setBusy(true);
    try {
      const r = await fn();
      await load();
      if (done) done(r);
      return r;
    } catch (e) {
      toast(e?.message || t('That did not work.'));
      return null;
    } finally { setBusy(false); }
  }, [load]);

  return {
    list, busy, reload: load,
    create: (body) => run(() => api.post('/api/admin/themes', body), () => reload()),
    rename: (id, name) => run(() => api.patch('/api/admin/themes/' + id, { name })),
    activate: (id) => run(() => api.post(`/api/admin/themes/${id}/activate`, {}), () => reload()),
    remove: (id) => run(() => api.del('/api/admin/themes/' + id), () => reload()),
    reset: (id, to) => run(() => api.post(`/api/admin/themes/${id}/reset`, { to }), () => reload()),
    restore: (id, index) => run(() => api.post(`/api/admin/themes/${id}/restore`, { index }), () => reload()),
    snapshot: (id, label) => run(() => api.post(`/api/admin/themes/${id}/snapshot`, { label })),
    publish: () => run(() => api.post('/api/admin/themes/publish', {}), () => reload()),
    importTheme: (body) => run(() => api.post('/api/admin/themes/import', body), () => reload())
  };
}

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ThemesPanel({ compact }) {
  const themes = useThemes();
  const { theme: current } = useTheme();
  const [ask, setAsk] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [creating, setCreating] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const file = useRef(null);

  const { list } = themes;

  const exportTheme = async (id, name) => {
    try {
      const data = await api.get(`/api/admin/themes/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (name || 'theme').replace(/[^\w-]+/g, '-').toLowerCase() + '.theme.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast(t('That theme could not be exported.')); }
  };

  const onImport = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const body = JSON.parse(await f.text());
      const r = await themes.importTheme(body);
      if (r) toast(t('Imported “{name}”.', { name: r.name }));
    } catch { toast(t('That file is not a theme export.')); }
  };

  return (
    <div className={'bx-themes' + (compact ? ' compact' : '')}>
      <div className="bx-themes-bar">
        <button type="button" className="bx-btn primary"
          onClick={() => setCreating({ name: '', from: list.themes.find(th => th.builtin)?.id || '' })}>
          {t('New theme')}
        </button>
        <button type="button" className="bx-btn" onClick={() => file.current?.click()}>
          <Upload /> {t('Import')}
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={onImport} />
      </div>

      <div className="bx-theme-list">
        {list.themes.map(th => {
          const active = th.id === list.activeId;
          return (
            <article key={th.id} className={'bx-theme' + (active ? ' on' : '')}>
              <div className="bx-theme-main">
                <div className="bx-theme-name">
                  <b>{th.name}</b>
                  {th.builtin && <span className="bx-tag">{t('Preset')}</span>}
                  {active && <span className="bx-tag live">{t('Active')}</span>}
                  {th.dirty && <span className="bx-tag pending">{t('Unpublished')}</span>}
                </div>
                <div className="bx-theme-meta">
                  {th.note ? t(th.note) : t('Based on {preset}', { preset: th.basePreset === 'openai' ? 'OpenAI' : 'Anthropic' })}
                  {' · '}
                  {t('{n} customisations', { n: th.edits })}
                  {' · '}
                  {t('edited {when}', { when: fmt(th.updatedAt) })}
                </div>
              </div>
              <div className="bx-theme-acts">
                {!active && (
                  <button type="button" className="bx-btn sm" onClick={() => themes.activate(th.id)}>{t('Use this')}</button>
                )}
                <button type="button" className="bx-icon" title={t('Rename')} aria-label={t('Rename')}
                  onClick={() => setRenaming({ id: th.id, name: th.name })}><Pencil /></button>
                <button type="button" className="bx-icon" title={t('Duplicate')} aria-label={t('Duplicate')}
                  onClick={() => themes.create({ from: th.id, name: th.name + ' copy' })}><Copy /></button>
                <button type="button" className="bx-icon" title={t('Version history')} aria-label={t('Version history')}
                  onClick={() => setHistoryFor(th)}><Clock /></button>
                <button type="button" className="bx-icon" title={t('Export')} aria-label={t('Export')}
                  onClick={() => exportTheme(th.id, th.name)}><Download /></button>
                <button type="button" className="bx-icon" title={t('Reset')} aria-label={t('Reset')}
                  onClick={() => setAsk({
                    title: t('Reset “{name}”?', { name: th.name }),
                    message: th.builtin
                      ? t('This goes back to the {name} layout exactly as it ships. The current version is kept in history so you can undo this.', { name: th.name })
                      : t('Every customisation in this theme goes back to the plain {preset} layout. The current version is kept in history so you can undo this.', { preset: th.basePreset === 'openai' ? 'OpenAI' : 'Anthropic' }),
                    confirmLabel: t('Reset'),
                    danger: true,
                    onConfirm: () => themes.reset(th.id, 'preset')
                  })}><Refresh /></button>
                {!th.builtin && (
                  <button type="button" className="bx-icon danger" title={t('Delete')} aria-label={t('Delete')}
                    onClick={() => setAsk({
                      title: t('Delete “{name}”?', { name: th.name }),
                      message: t('This cannot be undone. Export it first if you might want it back.'),
                      confirmLabel: t('Delete'),
                      danger: true,
                      onConfirm: () => themes.remove(th.id)
                    })}><Trash /></button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {current?.id && (
        <div className="bx-theme-foot">
          <button type="button" className="bx-btn"
            onClick={() => setAsk({
              title: t('Discard your changes?'),
              message: t('This theme goes back to exactly what members are running right now.'),
              confirmLabel: t('Discard'),
              danger: true,
              onConfirm: () => themes.reset(current.id, 'published')
            })}>
            {t('Revert to published')}
          </button>
        </div>
      )}

      {creating && (
        <Dialog title={t('New theme')} onClose={() => setCreating(null)}
          foot={<>
            <button type="button" className="bx-btn" onClick={() => setCreating(null)}>{t('Cancel')}</button>
            <button type="button" className="bx-btn primary"
              onClick={async () => {
                const r = await themes.create(creating);
                setCreating(null);
                if (r?.id) themes.activate(r.id);
              }}>{t('Create and open')}</button>
          </>}>
          <label className="bx-dlg-label">{t('Name')}</label>
          <Text value={creating.name} onChange={(v) => setCreating(c => ({ ...c, name: v }))} placeholder={t('My layout')} />
          <label className="bx-dlg-label">{t('Start from')}</label>
          <select className="bx-select" value={creating.from}
            onChange={(e) => setCreating(c => ({ ...c, from: e.target.value }))}>
            {list.themes.filter(th => th.builtin).map(th => (
              <option key={th.id} value={th.id}>{t('{name} layout', { name: th.name })}</option>
            ))}
            {list.themes.filter(th => !th.builtin).map(th => (
              <option key={th.id} value={th.id}>{t('Copy of {name}', { name: th.name })}</option>
            ))}
          </select>
          <p className="bx-hint">{t('Presets are fully editable starting points, not fixed skins.')}</p>
        </Dialog>
      )}

      {renaming && (
        <Dialog title={t('Rename theme')} onClose={() => setRenaming(null)}
          foot={<>
            <button type="button" className="bx-btn" onClick={() => setRenaming(null)}>{t('Cancel')}</button>
            <button type="button" className="bx-btn primary"
              onClick={() => { themes.rename(renaming.id, renaming.name); setRenaming(null); }}>{t('Save')}</button>
          </>}>
          <Text value={renaming.name} onChange={(v) => setRenaming(r => ({ ...r, name: v }))} />
        </Dialog>
      )}

      {historyFor && (
        <Dialog title={t('Versions of “{name}”', { name: historyFor.name })} onClose={() => setHistoryFor(null)}>
          {!historyFor.history?.length && <p className="bx-hint">{t('No saved versions yet. One is kept automatically before every publish and every reset.')}</p>}
          <ul className="bx-versions">
            {(historyFor.history || []).map((h, i) => (
              <li key={i}>
                <div>
                  <b>{h.label || t('Snapshot')}</b>
                  <em>{fmt(h.ts)}</em>
                </div>
                <button type="button" className="bx-btn sm"
                  onClick={() => { themes.restore(historyFor.id, i); setHistoryFor(null); toast(t('Restored.')); }}>
                  {t('Restore')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="bx-btn" onClick={() => { themes.snapshot(historyFor.id, t('manual save')); setHistoryFor(null); toast(t('Version saved.')); }}>
            <Check /> {t('Save a version now')}
          </button>
        </Dialog>
      )}

      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
