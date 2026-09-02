import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../../api.js';
import { t } from '../../../i18n.jsx';

const SAVE_DELAY = 450;
const SAVED_LINGER = 1800;
// How long after a write this tab keeps ignoring the server's copy of a row, so
// a broadcast triggered by our own PATCH cannot overwrite what is on screen.
const ECHO_WINDOW = 1200;
const REFOCUS_RETRY = 2500;

// Models are the only thing publish() snapshots, so this hook owns the whole
// draft story: local edits, debounced PATCHes, and whether the draft has
// diverged from what clients are running.
export function useCatalog({ confirm }) {
  const [models, setModels] = useState([]);
  const [providers, setProviders] = useState([]);
  const [providerTypes, setProviderTypes] = useState({});
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ published: false, dirty: false, publishedAt: null });
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [probe, setProbe] = useState({});

  const modelsRef = useRef([]);
  const providersRef = useRef([]);
  const timers = useRef({});
  const inFlight = useRef(new Map());
  const linger = useRef(null);

  useEffect(() => { modelsRef.current = models; }, [models]);
  useEffect(() => { providersRef.current = providers; }, [providers]);

  // Nothing may fire after the panel closes: a pending debounce would PATCH a
  // row the admin has already navigated away from, and settle state on an
  // unmounted tree.
  useEffect(() => () => {
    for (const id of Object.values(timers.current)) clearTimeout(id);
    for (const id of inFlight.current.values()) clearTimeout(id);
    clearTimeout(linger.current);
  }, []);

  const settle = useCallback((state) => {
    setSaveState(state);
    clearTimeout(linger.current);
    if (state !== 'saved') return;
    linger.current = setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), SAVED_LINGER);
  }, []);

  const readDraft = useCallback(async () => {
    try { setDraft(await api.get('/api/admin/models/publish-state')); } catch {}
  }, []);

  const loadModels = useCallback(async () => {
    try { setModels(await api.get('/api/admin/models')); } catch {}
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const p = await api.get('/api/admin/providers');
      setProviders(p.providers || []);
      setProviderTypes(p.types || {});
    } catch {}
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([loadModels(), loadProviders()]);
    readDraft();
  }, [loadModels, loadProviders, readDraft]);

  useEffect(() => { reload(); }, [reload]);

  // A live edit elsewhere should refresh the list, but never clobber a row this
  // tab is still typing into, and never yank focus out of a field.
  useEffect(() => {
    let retry;
    async function onConfig() {
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.closest('.cp, .cp-dialog')) {
        clearTimeout(retry);
        retry = setTimeout(onConfig, REFOCUS_RETRY);
        return;
      }
      try {
        const fresh = await api.get('/api/admin/models');
        setModels(cur => fresh.map(f => (inFlight.current.has(f.id) || timers.current[f.id])
          ? (cur.find(c => c.id === f.id) || f)
          : f));
        readDraft();
      } catch {}
    }
    window.addEventListener('oq-config', onConfig);
    return () => { clearTimeout(retry); window.removeEventListener('oq-config', onConfig); };
  }, [readDraft]);

  const patchModel = useCallback((next) => {
    setModels(ms => ms.map(m => {
      if (m.id === next.id) return next;
      if (next.is_default && m.is_default) return { ...m, is_default: 0 };
      return m;
    }));
    settle('saving');
    // Guard the row from broadcast refreshes for the whole write, debounce
    // included, not only once the request has come back.
    if (!inFlight.current.has(next.id)) inFlight.current.set(next.id, null);
    clearTimeout(timers.current[next.id]);
    timers.current[next.id] = setTimeout(async () => {
      delete timers.current[next.id];
      try {
        await api.patch('/api/admin/models/' + next.id, next);
        settle('saved');
        readDraft();
      } catch { settle('error'); }
      finally {
        clearTimeout(inFlight.current.get(next.id));
        inFlight.current.set(next.id, setTimeout(() => inFlight.current.delete(next.id), ECHO_WINDOW));
      }
    }, SAVE_DELAY);
  }, [readDraft, settle]);

  const bulkPatch = useCallback(async (ids, patch) => {
    setModels(ms => ms.map(m => (ids.includes(m.id) ? { ...m, ...patch } : m)));
    settle('saving');
    try {
      for (const id of ids) await api.patch('/api/admin/models/' + id, patch);
      settle('saved');
    } catch {
      settle('error');
      loadModels();
    }
    readDraft();
  }, [readDraft, settle, loadModels]);

  const createModel = useCallback(async () => {
    const { id } = await api.post('/api/admin/models', { display_name: 'New model', internal_name: 'local-model' });
    await loadModels();
    setSelected(id);
    readDraft();
    return id;
  }, [loadModels, readDraft]);

  const copyModels = useCallback(async (ids) => {
    let last = null;
    for (const id of ids) {
      const src = modelsRef.current.find(m => m.id === id);
      if (!src) continue;
      // The create route fixes sampling, price and reference fields to their
      // defaults, so the copy is completed with a patch of the source row.
      const body = { ...src, display_name: (src.display_name || 'Model') + ' copy', is_default: false };
      const { id: newId } = await api.post('/api/admin/models', body);
      await api.patch('/api/admin/models/' + newId, body);
      last = newId;
    }
    await loadModels();
    if (ids.length === 1 && last) setSelected(last);
    readDraft();
  }, [loadModels, readDraft]);

  const removeModels = useCallback((ids, after) => {
    confirm({
      title: ids.length === 1 ? t('Delete model') : t('Delete models'),
      message: ids.length === 1
        ? t('This removes the model from the catalog. Chats that used it keep their messages. This cannot be undone.')
        : t('This removes {n} models from the catalog. Chats that used them keep their messages. This cannot be undone.', { n: ids.length }),
      confirm: ids.length === 1 ? t('Delete model') : t('Delete {n} models', { n: ids.length }),
      onConfirm: async () => {
        try {
          for (const id of ids) await api.del('/api/admin/models/' + id);
          setModels(ms => ms.filter(m => !ids.includes(m.id)));
        } catch { await loadModels(); }
        setSelected(s => (ids.includes(s) ? null : s));
        readDraft();
        if (after) after();
      }
    });
  }, [confirm, readDraft, loadModels]);

  // The list is reordered on screen first; a rejected write puts the server's
  // order back rather than leaving the two silently disagreeing.
  const reorderModels = useCallback(async (arr) => {
    setModels(arr);
    try { await api.post('/api/admin/models/reorder', { ids: arr.map(m => m.id) }); }
    catch { await loadModels(); }
    readDraft();
  }, [loadModels, readDraft]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setPublishError('');
    try {
      const r = await api.post('/api/admin/models/publish', {});
      setDraft({ published: true, dirty: false, publishedAt: r.publishedAt });
    } catch (e) {
      setPublishError(e?.message || t('The catalog could not be published.'));
    } finally { setPublishing(false); }
  }, []);

  const addProvider = useCallback(async () => {
    await api.post('/api/admin/providers', { type: 'llamacpp' });
    await loadProviders();
  }, [loadProviders]);

  const patchProvider = useCallback(async (id, patch) => {
    setProviders(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)));
    try { await api.patch('/api/admin/providers/' + id, patch); }
    catch { await loadProviders(); }
  }, [loadProviders]);

  const removeProvider = useCallback(async (id) => {
    await api.del('/api/admin/providers/' + id);
    await reload();
  }, [reload]);

  const probeProvider = useCallback(async (id) => {
    setProbe(p => ({ ...p, [id]: { busy: true } }));
    const prov = providersRef.current.find(x => x.id === id);
    try {
      const r = await api.get('/api/admin/discover-models?provider=' + encodeURIComponent(id));
      let engine = null;
      if (prov && prov.type === 'llamacpp') {
        try { engine = await api.get('/api/admin/providers/' + encodeURIComponent(id) + '/engine'); } catch {}
      }
      setProbe(p => ({ ...p, [id]: { ok: true, count: (r.models || []).length, engine } }));
    } catch (e) {
      setProbe(p => ({ ...p, [id]: { ok: false, error: e?.message || 'unreachable' } }));
    }
  }, []);

  return {
    models, providers, providerTypes, selected, setSelected,
    draft, publishing, publish, publishError, saveState,
    patchModel, bulkPatch, createModel, copyModels, removeModels, reorderModels,
    addProvider, patchProvider, removeProvider, probeProvider, probe,
    reload, loadModels, loadProviders
  };
}
