import { useRef, useEffect } from 'react';

const DEBOUNCE_MS = 200;

export function draftKey(id) { return 'oq-draft-' + (id || 'new'); }

export function readDraft(id) {
  try { return localStorage.getItem(draftKey(id)) || ''; } catch { return ''; }
}

export function writeDraft(id, text) {
  try {
    if (text && text.trim()) localStorage.setItem(draftKey(id), text);
    else localStorage.removeItem(draftKey(id));
  } catch {}
}

export function useDrafts(skipRef) {
  const timer = useRef(null);
  const pending = useRef(null);
  const flushRef = useRef(null);

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    writeDraft(p.id, p.text);
  };
  flushRef.current = flush;

  const save = (id, text) => {
    if (skipRef && skipRef.current) return;
    const p = pending.current;
    if (p && p.id !== id) flush();
    pending.current = { id, text };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  };

  // Only the draft being cleared is dropped. Clearing one chat used to cancel the
  // pending timer whatever it held, so sending in chat A right after typing in
  // chat B threw away B's unsaved text.
  const clear = (id) => {
    const p = pending.current;
    if (p && p.id === id) {
      clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
    }
    try { localStorage.removeItem(draftKey(id)); } catch {}
  };

  // pagehide and visibilitychange cover reloads and tab switches without costing
  // back/forward-cache eligibility the way beforeunload would.
  useEffect(() => {
    const onFlush = () => { if (flushRef.current) flushRef.current(); };
    const onVis = () => { if (document.visibilityState === 'hidden') onFlush(); };
    window.addEventListener('pagehide', onFlush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onFlush);
      document.removeEventListener('visibilitychange', onVis);
      onFlush();
    };
  }, []);

  return { saveDraft: save, loadDraft: readDraft, clearDraft: clear, flushDraft: flush };
}
