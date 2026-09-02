import { useCallback, useMemo, useRef, useState } from 'react';

// The tool rows an in-flight turn is drawing: the file currently being written
// (the artifacts preview needs exactly that one) and every call in the step the
// model is spelling out right now.
//
// This used to be three useStates and a ref sitting in App, cleared by hand at
// nine different sites — a new chat, a new turn, an error, a finished turn, an
// incognito toggle, a project start. They had drifted: two of them cleared the
// calls but left the file preview pointing at the previous chat's write. One
// clear() is what stops that class of bug coming back.

// One frozen empty array, so clearing the rows never hands React a new identity
// and re-renders the whole thread for nothing.
export const EMPTY_CALLS = Object.freeze([]);

// Only two tools write a file, and only those get the live preview.
export function isFileWrite(live) {
  return !!(live && live.path && (live.tool === 'create_file' || live.tool === 'str_replace'));
}

export function fileFrom(live) {
  return { path: live.path, content: live.content || '', tool: live.tool, oldStr: live.oldStr ?? null };
}

// A step can stream several calls at once. Each carries its index, so a later one
// updates its own row instead of overwriting the row before it; a null clears the
// whole step (the model stopped emitting calls).
export function mergeCall(rows, index, call) {
  if (!call || !Number.isFinite(index)) return [];
  return [...(rows || []).filter(x => x.index !== index), { index, call }].sort((a, b) => a.index - b.index);
}

// A create_file that has been replaced by a different call has finished writing.
// Its text moves to the pending set so the artifacts list does not blink empty
// between the last delta and the server's `files` frame.
export function supersededFile(prev, live) {
  if (!prev || !prev.path || prev.tool !== 'create_file') return null;
  if (live && live.path === prev.path) return null;
  return { path: prev.path, text: prev.content || '' };
}

export function useLiveTools() {
  const [file, setFile] = useState(null);
  const [call, setCall] = useState(null);
  const [calls, setCalls] = useState(EMPTY_CALLS);
  // Read by the websocket handlers, which run outside render and need the file
  // as it is right now rather than as it was when they were created.
  const fileRef = useRef(null);

  const setLiveFile = useCallback((f) => { fileRef.current = f; setFile(f); }, []);

  // The file has landed on disk and the server's `files` frame now carries it, so
  // the preview is retired. The call rows are left alone: the step may still be
  // running, and its row is what the transcript is drawing.
  const clearFile = useCallback(() => setLiveFile(null), [setLiveFile]);

  const clear = useCallback(() => {
    fileRef.current = null;
    setFile(null);
    setCall(null);
    setCalls(EMPTY_CALLS);
  }, []);

  // Point the preview at whatever the step is doing now, and report back the file
  // that just stopped being written so the caller can commit it.
  const apply = useCallback((live) => {
    const done = supersededFile(fileRef.current, live);
    if (isFileWrite(live)) setLiveFile(fileFrom(live));
    else if (!live) setLiveFile(null);
    setCall(live && live.tool ? { ...live } : null);
    return done;
  }, [setLiveFile]);

  // Restoring a turn after a reload: no supersede bookkeeping, just show what the
  // server says is in flight.
  const restore = useCallback((live, rows) => {
    setLiveFile(isFileWrite(live) ? fileFrom(live) : null);
    setCall(live && live.tool ? { ...live } : null);
    setCalls(Array.isArray(rows) && rows.length ? rows : EMPTY_CALLS);
  }, [setLiveFile]);

  const appendToFile = useCallback((text) => {
    const cur = fileRef.current;
    if (!cur) return;
    setLiveFile({ ...cur, content: (cur.content || '') + text });
  }, [setLiveFile]);

  const setRows = useCallback((rows) => {
    setCalls(Array.isArray(rows) && rows.length ? rows : EMPTY_CALLS);
  }, []);

  return useMemo(() => ({
    file, call, calls, fileRef,
    clear, clearFile, apply, restore, appendToFile, setRows, setCall
  }), [file, call, calls, clear, clearFile, apply, restore, appendToFile, setRows]);
}
