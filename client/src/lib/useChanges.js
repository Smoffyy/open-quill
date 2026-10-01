import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api.js';
import { DRAFT_SETTLE_MS } from './configsync.js';

const EMPTY = { version: 0, publishedAt: null, publishedBy: '', changes: [], models: { changed: [], live: {}, order: [] } };

export function useChanges() {
  const [state, setState] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState('');
  const latest = useRef(EMPTY);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const next = await api.get('/api/admin/changes');
      latest.current = next;
      setState(next);
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const soon = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(load, DRAFT_SETTLE_MS);
    };
    window.addEventListener('oq-admin-draft', soon);
    window.addEventListener('oq-config', soon);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('oq-admin-draft', soon);
      window.removeEventListener('oq-config', soon);
    };
  }, [load]);

  const run = useCallback(async (kind, url, body) => {
    setBusy(kind);
    try { return await api.post(url, body); }
    finally {
      setBusy('');
      load();
    }
  }, [load]);

  const publish = useCallback((keys, note) =>
    run('publish', '/api/admin/changes/publish', { keys, note, base: latest.current.version }), [run]);

  const discard = useCallback((keys) => run('discard', '/api/admin/changes/discard', { keys }), [run]);

  return { ...state, ready, busy, reload: load, publish, discard };
}
