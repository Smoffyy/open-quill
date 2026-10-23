const lines = new Map();

export function queueKey(model, spec, base) {
  if (!spec || !spec.sharedSlots || !model || model.parallel_requests) return null;
  return base + '|' + (model.internal_name || '');
}

function aborted() {
  const e = new Error('The request was cancelled while waiting for the model.');
  e.name = 'AbortError';
  return e;
}

function waitFor(turn, signal) {
  if (!signal) return turn;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const stop = () => reject(aborted());
    signal.addEventListener('abort', stop, { once: true });
    turn.then(() => { signal.removeEventListener('abort', stop); resolve(); });
  });
}

export async function inLine(key, signal, run) {
  if (!key) return run();
  const ahead = lines.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((resolve) => { release = resolve; });
  const tail = ahead.then(() => mine);
  lines.set(key, tail);
  try {
    await waitFor(ahead, signal);
    return await run();
  } finally {
    release();
    if (lines.get(key) === tail) lines.delete(key);
  }
}