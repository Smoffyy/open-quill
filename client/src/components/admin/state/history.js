const LIMIT = 200;
const MERGE_WINDOW = 1000;

export function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter(k => before?.[k] !== after?.[k]).sort();
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k];
  return out;
}

export function createHistory({ limit = LIMIT, window = MERGE_WINDOW, now = Date.now } = {}) {
  const done = [];
  const undone = [];
  return {
    record({ key = null, undo, redo = null }) {
      undone.length = 0;
      const at = now();
      const top = done[done.length - 1];
      if (key && top && top.key === key && at - top.at <= window) {
        top.at = at;
        top.redo = redo;
        return;
      }
      done.push({ key, undo, redo, at });
      if (done.length > limit) done.shift();
    },
    undo() {
      const entry = done.pop();
      if (!entry) return false;
      entry.undo();
      entry.key = null;
      if (entry.redo) undone.push(entry);
      else undone.length = 0;
      return true;
    },
    redo() {
      const entry = undone.pop();
      if (!entry) return false;
      entry.redo();
      done.push(entry);
      return true;
    },
    clear() { done.length = 0; undone.length = 0; },
    get size() { return done.length; },
    get redoSize() { return undone.length; }
  };
}

export function historyKey(e, mac) {
  if (e.altKey || (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey)) return null;
  const key = (e.key || '').toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !mac && !e.shiftKey) return 'redo';
  return null;
}