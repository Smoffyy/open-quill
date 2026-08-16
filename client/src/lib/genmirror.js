import { useCallback, useMemo, useRef, useState } from 'react';

export const INCOGNITO_KEY = 'incognito';

function blankRecord(modelId, phase) {
  return {
    content: '',
    reasoning: '',
    phase,
    done: false,
    assistantId: null,
    model_id: modelId,
    live: null,
    steers: [],
    status: null
  };
}

export function useGenMirror(getCurrentModelId) {
  const gen = useRef(new Map());
  const [busyChats, setBusyChats] = useState([]);

  const syncBusy = useCallback(() => {
    const next = [];
    for (const [id, r] of gen.current.entries()) {
      if (id && id !== INCOGNITO_KEY && !r.done) next.push(id);
    }
    next.sort();
    setBusyChats(prev => (prev.length === next.length && prev.every((v, i) => v === next[i])) ? prev : next);
  }, []);

  const peek = useCallback((key) => gen.current.get(key), []);

  const queueRec = useCallback((key, modelId) => {
    const rec = blankRecord(modelId, 'queued');
    rec.steers = [];
    gen.current.set(key, rec);
    syncBusy();
  }, [syncBusy]);

  const dropRec = useCallback((key) => {
    gen.current.delete(key);
    syncBusy();
  }, [syncBusy]);

  const recFor = useCallback((key) => {
    let r = gen.current.get(key);
    if (!r) {
      r = blankRecord(getCurrentModelId ? getCurrentModelId() : null, 'generating');
      gen.current.set(key, r);
      syncBusy();
    }
    return r;
  }, [syncBusy, getCurrentModelId]);

  const resumeRec = useCallback((key, patch) => {
    gen.current.set(key, { ...blankRecord(patch.model_id ?? null, patch.phase || 'generating'), ...patch });
  }, []);

  return useMemo(() => ({
    gen, busyChats, syncBusy, peek, queueRec, dropRec, recFor, resumeRec
  }), [busyChats, syncBusy, peek, queueRec, dropRec, recFor, resumeRec]);
}
