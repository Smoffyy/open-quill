import { useState, useEffect, useRef, useCallback } from 'react';
import { api, TAB_ID } from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
import { t } from '../../../i18n.jsx';
import { touchesBlocks, syncModelPrompt } from '../../../lib/promptblocks.js';
import { pick } from './history.js';

const SAVE_DELAY = 450;

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function useCatalog({ confirm, features, history, changes }) {
  const [models, setModels] = useState([]);
  const [providers, setProviders] = useState([]);
  const [providerTypes, setProviderTypes] = useState({});
  const [selection, setSelection] = useState([]);
  const [folders, setFolders] = useState([]);
  const [probe, setProbe] = useState({});
  const [ready, setReady] = useState(false);

  const modelsRef = useRef([]);
  const providersRef = useRef([]);
  const pending = useRef(new Map());
  const inflight = useRef(new Map());
  const flushTimer = useRef(null);
  const queue = useRef(Promise.resolve());

  useEffect(() => { modelsRef.current = models; }, [models]);
  useEffect(() => { providersRef.current = providers; }, [providers]);

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

  const foldersRef = useRef([]);
  useEffect(() => { foldersRef.current = folders; }, [folders]);

  const writeFolders = useCallback(async (list) => {
    const clean = [...new Set(list.map(n => String(n).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    setFolders(clean);
    try { setFolders((await api.put('/api/admin/models/folders', { folders: clean })).folders || clean); }
    catch { loadFolders(); }
  }, [loadFolders]);

  const saveFolders = useCallback((list) => {
    const was = foldersRef.current;
    history?.record({ undo: () => writeFolders(was), redo: () => writeFolders(list) });
    return writeFolders(list);
  }, [history, writeFolders]);

  const keepFolders = useCallback(async (names) => {
    try { setFolders((await api.post('/api/admin/models/folders/add', { folders: names })).folders || []); } catch {}
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([loadModels(), loadProviders(), loadFolders()]);
    setReady(true);
  }, [loadModels, loadProviders, loadFolders]);

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
    for (const row of rows) inflight.current.set(row.id, { ...(inflight.current.get(row.id) || {}), ...row });
    queue.current = queue.current.then(async () => {
      try {
        await api.patch('/api/admin/models', { rows });
      } catch (e) {
        toast(e?.message || t('A model change could not be saved.'), { kind: 'error', icon: 'info' });
        loadModels();
      } finally {
        for (const { id } of rows) inflight.current.delete(id);
      }
    });
    return queue.current;
  }, [takeRows, loadModels]);

  useEffect(() => () => {
    clearTimeout(flushTimer.current);
    const rows = takeRows();
    if (rows.length) api.patch('/api/admin/models', { rows }).catch(() => {});
  }, [takeRows]);

  const unsaved = useCallback(() => pending.current.size > 0 || inflight.current.size > 0, []);

  useEffect(() => {
    const local = (id) => ({ ...(inflight.current.get(id) || {}), ...(pending.current.get(id) || {}) });
    function merge(rows) {
      const clashes = [];
      const next = new Map(modelsRef.current.map(m => [m.id, m]));
      for (const row of rows) {
        const mine = local(row.id);
        const cur = next.get(row.id);
        for (const k of Object.keys(mine)) {
          if (k !== 'id' && cur && !same(cur[k], row[k]) && !same(mine[k], row[k])) clashes.push(row.display_name || row.internal_name || '');
        }
        next.set(row.id, { ...row, ...mine, id: row.id });
      }
      const list = [...next.values()].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      modelsRef.current = list;
      setModels(list);
      if (clashes.length) toast(t('Another admin changed “{name}” while you were editing it. Your edit is kept.', { name: clashes[0] }), { icon: 'info' });
    }
    function onDraft(e) {
      const f = e.detail || {};
      const own = !!f.tab && f.tab === TAB_ID;
      if (f.scope === 'all') { reload(); return; }
      if (f.scope === 'providers') { if (!own) loadProviders(); return; }
      if (f.scope === 'folders') { if (Array.isArray(f.folders)) setFolders(f.folders); return; }
      if (f.scope !== 'models' || own) return;
      if (f.reload) { loadModels(); return; }
      if (Array.isArray(f.rows) && f.rows.length) merge(f.rows);
      if (Array.isArray(f.removed) && f.removed.length) {
        const gone = new Set(f.removed);
        for (const id of gone) pending.current.delete(id);
        modelsRef.current = modelsRef.current.filter(m => !gone.has(m.id));
        setModels(modelsRef.current);
        setSelection(sel => sel.filter(id => !gone.has(id)));
      }
      if (Array.isArray(f.order) && f.order.length) {
        const rank = new Map(f.order.map((id, i) => [id, i]));
        const list = modelsRef.current
          .map(m => (rank.has(m.id) ? { ...m, sort_order: rank.get(m.id) } : m))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        modelsRef.current = list;
        setModels(list);
      }
    }
    window.addEventListener('oq-admin-draft', onDraft);
    return () => window.removeEventListener('oq-admin-draft', onDraft);
  }, [reload, loadModels, loadProviders]);

  const stage = useCallback((all) => {
    const patches = new Map([...all].filter(([id]) => modelsRef.current.some(m => m.id === id)));
    if (!patches.size) return;
    const makesDefault = [...patches.values()].some(p => p.is_default);
    const next = modelsRef.current.map(m => {
      if (patches.has(m.id)) return { ...m, ...patches.get(m.id) };
      return makesDefault && m.is_default ? { ...m, is_default: 0 } : m;
    });
    modelsRef.current = next;
    setModels(next);
    for (const [id, p] of patches) pending.current.set(id, { ...(pending.current.get(id) || {}), ...p });
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  const edit = useCallback((ids, change) => {
    const per = typeof change === 'function' ? change : () => change;
    const patches = new Map();
    const was = new Map();
    for (const id of ids) {
      const m = modelsRef.current.find(x => x.id === id);
      let p = m && per(m);
      if (p && touchesBlocks(p)) {
        const next = { ...m, ...p };
        const text = syncModelPrompt(m, next, features?.current || {});
        if (text !== (next.system_prompt ?? '')) p = { ...p, system_prompt: text };
      }
      if (p && Object.keys(p).length) {
        patches.set(id, p);
        was.set(id, Object.fromEntries(Object.entries(pick(m, Object.keys(p))).map(([k, v]) => [k, v ?? null])));
      }
    }
    if (!patches.size) return;
    if ([...patches.values()].some(p => p.is_default)) {
      for (const m of modelsRef.current) if (m.is_default && !patches.has(m.id)) was.set(m.id, { is_default: m.is_default });
    }
    const key = 'models:' + [...patches].map(([id, p]) => id + '=' + Object.keys(p).sort().join(',')).join(';');
    history?.record({ key, undo: () => stage(was), redo: () => stage(patches) });
    stage(patches);
  }, [stage, features, history]);

  const dropModels = useCallback(async (ids) => {
    for (const id of ids) pending.current.delete(id);
    try {
      await api.post('/api/admin/models/remove', { ids });
      setModels(ms => ms.filter(m => !ids.includes(m.id)));
    } catch { await loadModels(); }
    setSelection(sel => sel.filter(id => !ids.includes(id)));
  }, [loadModels]);

  const createModel = useCallback(async () => {
    await flush();
    const { id } = await api.post('/api/admin/models', { display_name: t('New model'), internal_name: 'local-model' });
    history?.record({ undo: () => dropModels([id]) });
    await loadModels();
    setSelection([id]);
    return id;
  }, [flush, loadModels, history, dropModels]);

  const duplicateModels = useCallback(async (ids) => {
    await flush();
    try {
      const r = await api.post('/api/admin/models/duplicate', { ids });
      if (r.ids?.length) history?.record({ undo: () => dropModels(r.ids) });
      await loadModels();
      setSelection(r.ids || []);
    } catch (e) { toast(e?.message || t('The models could not be duplicated.'), { kind: 'error', icon: 'info' }); }
  }, [flush, loadModels, history, dropModels]);

  const removeModels = useCallback((ids) => {
    const one = ids.length === 1;
    confirm({
      title: one ? t('Delete model') : t('Delete models'),
      message: one
        ? t('This removes the model from the catalog. Chats that used it keep their messages. This cannot be undone.')
        : t('This removes {n} models from the catalog. Chats that used them keep their messages. This cannot be undone.', { n: ids.length }),
      confirm: one ? t('Delete model') : t('Delete {n} models', { n: ids.length }),
      onConfirm: () => dropModels(ids)
    });
  }, [confirm, dropModels]);

  const writeOrder = useCallback(async (arr) => {
    modelsRef.current = arr;
    setModels(arr);
    try { await api.post('/api/admin/models/reorder', { ids: arr.map(m => m.id) }); }
    catch { await loadModels(); }
  }, [loadModels]);

  const orderBy = useCallback((ids) => {
    const rank = new Map(ids.map((id, i) => [id, i]));
    const at = (m) => (rank.has(m.id) ? rank.get(m.id) : ids.length);
    return writeOrder([...modelsRef.current].sort((a, b) => at(a) - at(b)));
  }, [writeOrder]);

  const reorderModels = useCallback((arr) => {
    const was = modelsRef.current.map(m => m.id);
    const now = arr.map(m => m.id);
    history?.record({ undo: () => orderBy(was), redo: () => orderBy(now) });
    return writeOrder(arr);
  }, [history, writeOrder, orderBy]);

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
    draft: changes.models, unsaved,
    edit, flush, createModel, duplicateModels, removeModels, reorderModels,
    addProvider, patchProvider, removeProvider, probeProvider, probe,
    reload, loadModels, loadProviders
  };
}