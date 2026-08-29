import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../../api.js';

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
  const [saveState, setSaveState] = useState('idle');
  const [probe, setProbe] = useState({});

  const modelsRef = useRef([]);
  const providersRef = useRef([]);
  const timers = useRef({});
  const inFlight = useRef(new Set());

  useEffect(() => { modelsRef.current = models; }, [models]);
  useEffect(() => { providersRef.current = providers; }, [providers]);

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
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
        clearTimeout(retry);
        retry = setTimeout(onConfig, 2500);
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
    setSaveState('saving');
    inFlight.current.add(next.id);
    clearTimeout(timers.current[next.id]);
    timers.current[next.id] = setTimeout(async () => {
      try {
        await api.patch('/api/admin/models/' + next.id, next);
        setSaveState('saved');
        readDraft();
        setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1800);
      } catch { setSaveState('error'); }
      finally {
        delete timers.current[next.id];
        setTimeout(() => inFlight.current.delete(next.id), 1200);
      }
    }, 450);
  }, [readDraft]);

  const bulkPatch = useCallback(async (ids, patch) => {
    for (const id of ids) await api.patch('/api/admin/models/' + id, patch);
    setModels(ms => ms.map(m => (ids.includes(m.id) ? { ...m, ...patch } : m)));
    readDraft();
  }, [readDraft]);

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
      title: ids.length === 1 ? 'Delete model' : 'Delete models',
      message: ids.length === 1
        ? 'This removes the model from the catalog. Chats that used it keep their messages. This cannot be undone.'
        : `This removes ${ids.length} models from the catalog. Chats that used them keep their messages. This cannot be undone.`,
      confirm: ids.length === 1 ? 'Delete model' : `Delete ${ids.length} models`,
      onConfirm: async () => {
        for (const id of ids) await api.del('/api/admin/models/' + id);
        setModels(ms => ms.filter(m => !ids.includes(m.id)));
        setSelected(s => (ids.includes(s) ? null : s));
        readDraft();
        if (after) after();
      }
    });
  }, [confirm, readDraft]);

  const reorderModels = useCallback((arr) => {
    setModels(arr);
    api.post('/api/admin/models/reorder', { ids: arr.map(m => m.id) }).catch(() => {});
    readDraft();
  }, [readDraft]);

  const publish = useCallback(async () => {
    setPublishing(true);
    try {
      const r = await api.post('/api/admin/models/publish', {});
      setDraft({ published: true, dirty: false, publishedAt: r.publishedAt });
    } finally { setPublishing(false); }
  }, []);

  const addProvider = useCallback(async () => {
    await api.post('/api/admin/providers', { type: 'lmstudio' });
    await loadProviders();
  }, [loadProviders]);

  const patchProvider = useCallback(async (id, patch) => {
    setProviders(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)));
    await api.patch('/api/admin/providers/' + id, patch);
  }, []);

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
    draft, publishing, publish, saveState,
    patchModel, bulkPatch, createModel, copyModels, removeModels, reorderModels,
    addProvider, patchProvider, removeProvider, probeProvider, probe,
    reload, loadModels, loadProviders
  };
}
