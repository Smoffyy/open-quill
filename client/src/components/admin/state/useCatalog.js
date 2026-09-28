import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../../lib/api.js';
import { t } from '../../../i18n.jsx';
import { touchesBlocks, syncModelPrompt } from '../../../lib/promptblocks.js';

const SAVE_DELAY = 450;
const SAVED_LINGER = 1800;
const ECHO_WINDOW = 1200;
const REFOCUS_RETRY = 2500;

export function useCatalog({ confirm, features }) {
  const [models, setModels] = useState([]);
  const [providers, setProviders] = useState([]);
  const [providerTypes, setProviderTypes] = useState({});
  const [selection, setSelection] = useState([]);
  const [folders, setFolders] = useState([]);
  const [draft, setDraft] = useState({ published: false, dirty: false, publishedAt: null, changed: [] });
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [probe, setProbe] = useState({});
  const [ready, setReady] = useState(false);

  const modelsRef = useRef([]);
  const providersRef = useRef([]);
  const pending = useRef(new Map());
  const guard = useRef(new Map());
  const flushTimer = useRef(null);
  const queue = useRef(Promise.resolve());
  const linger = useRef(null);

  useEffect(() => { modelsRef.current = models; }, [models]);
  useEffect(() => { providersRef.current = providers; }, [providers]);

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

  const loadFolders = useCallback(async () => {
    try { setFolders((await api.get('/api/admin/models/folders')).folders || []); } catch {}
  }, []);

  const saveFolders = useCallback(async (list) => {
    const clean = [...new Set(list.map(n => String(n).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    setFolders(clean);
    try { setFolders((await api.put('/api/admin/models/folders', { folders: clean })).folders || clean); }
    catch { loadFolders(); }
  }, [loadFolders]);

  const keepFolders = useCallback(async (names) => {
    try { setFolders((await api.post('/api/admin/models/folders/add', { folders: names })).folders || []); } catch {}
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([loadModels(), loadProviders(), loadFolders()]);
    setReady(true);
    readDraft();
  }, [loadModels, loadProviders, loadFolders, readDraft]);

  useEffect(() => { reload(); }, [reload]);

  const takeRows = useCallback(() => {
    const rows = [...pending.current].map(([id, patch]) => ({ ...patch, id }));
    pending.current.clear();
    return rows;
  }, []);

  const flush = useCallback(() => {
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const rows = takeRows();
    if (!rows.length) return queue.current;
    queue.current = queue.current.then(async () => {
      try {
        await api.patch('/api/admin/models', { rows });
        settle('saved');
        readDraft();
      } catch {
        settle('error');
        loadModels();
      } finally {
        for (const { id } of rows) {
          clearTimeout(guard.current.get(id));
          guard.current.set(id, setTimeout(() => guard.current.delete(id), ECHO_WINDOW));
        }
      }
    });
    return queue.current;
  }, [takeRows, settle, readDraft, loadModels]);

  useEffect(() => () => {
    clearTimeout(flushTimer.current);
    clearTimeout(linger.current);
    for (const id of guard.current.values()) clearTimeout(id);
    const rows = takeRows();
    if (rows.length) api.patch('/api/admin/models', { rows }).catch(() => {});
  }, [takeRows]);

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
        setModels(cur => fresh.map(f => ((pending.current.has(f.id) || guard.current.has(f.id))
          ? (cur.find(c => c.id === f.id) || f)
          : f)));
        setSelection(sel => sel.filter(id => fresh.some(f => f.id === id)));
        readDraft();
        loadFolders();
      } catch {}
    }
    window.addEventListener('oq-config', onConfig);
    return () => { clearTimeout(retry); window.removeEventListener('oq-config', onConfig); };
  }, [readDraft, loadFolders]);

  const edit = useCallback((ids, change) => {
    const per = typeof change === 'function' ? change : () => change;
    const patches = new Map();
    for (const id of ids) {
      const m = modelsRef.current.find(x => x.id === id);
      let p = m && per(m);
      if (p && touchesBlocks(p)) {
        const next = { ...m, ...p };
        const text = syncModelPrompt(m, next, features?.current || {});
        if (text !== (next.system_prompt ?? '')) p = { ...p, system_prompt: text };
      }
      if (p && Object.keys(p).length) patches.set(id, p);
    }
    if (!patches.size) return;
    const makesDefault = [...patches.values()].some(p => p.is_default);
    const next = modelsRef.current.map(m => {
      if (patches.has(m.id)) return { ...m, ...patches.get(m.id) };
      return makesDefault && m.is_default ? { ...m, is_default: 0 } : m;
    });
    modelsRef.current = next;
    setModels(next);
    for (const [id, p] of patches) {
      pending.current.set(id, { ...(pending.current.get(id) || {}), ...p });
      clearTimeout(guard.current.get(id));
      guard.current.set(id, null);
    }
    settle('saving');
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, SAVE_DELAY);
  }, [flush, settle, features]);

  const createModel = useCallback(async () => {
    await flush();
    const { id } = await api.post('/api/admin/models', { display_name: t('New model'), internal_name: 'local-model' });
    await loadModels();
    setSelection([id]);
    readDraft();
    return id;
  }, [flush, loadModels, readDraft]);

  const duplicateModels = useCallback(async (ids) => {
    await flush();
    try {
      const r = await api.post('/api/admin/models/duplicate', { ids });
      await loadModels();
      setSelection(r.ids || []);
    } catch { settle('error'); }
    readDraft();
  }, [flush, loadModels, readDraft, settle]);

  const removeModels = useCallback((ids) => {
    const one = ids.length === 1;
    confirm({
      title: one ? t('Delete model') : t('Delete models'),
      message: one
        ? t('This removes the model from the catalog. Chats that used it keep their messages. This cannot be undone.')
        : t('This removes {n} models from the catalog. Chats that used them keep their messages. This cannot be undone.', { n: ids.length }),
      confirm: one ? t('Delete model') : t('Delete {n} models', { n: ids.length }),
      onConfirm: async () => {
        for (const id of ids) pending.current.delete(id);
        try {
          await api.post('/api/admin/models/remove', { ids });
          setModels(ms => ms.filter(m => !ids.includes(m.id)));
        } catch { await loadModels(); }
        setSelection(sel => sel.filter(id => !ids.includes(id)));
        readDraft();
      }
    });
  }, [confirm, readDraft, loadModels]);

  const reorderModels = useCallback(async (arr) => {
    modelsRef.current = arr;
    setModels(arr);
    try { await api.post('/api/admin/models/reorder', { ids: arr.map(m => m.id) }); }
    catch { await loadModels(); }
    readDraft();
  }, [loadModels, readDraft]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setPublishError('');
    try {
      await flush();
      await api.post('/api/admin/models/publish', {});
      await readDraft();
    } catch (e) {
      setPublishError(e?.message || t('The catalog could not be published.'));
    } finally { setPublishing(false); }
  }, [flush, readDraft]);

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
    models, providers, providerTypes, ready, selection, setSelection, folders, saveFolders, keepFolders,
    draft, publishing, publish, publishError, saveState,
    edit, flush, createModel, duplicateModels, removeModels, reorderModels,
    addProvider, patchProvider, removeProvider, probeProvider, probe,
    reload, loadModels, loadProviders
  };
}
