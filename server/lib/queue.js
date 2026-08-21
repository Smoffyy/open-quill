let activeCount = 0;
let waiters = [];
let activeModel = null;

function acquireModel(modelId, onWait) {
  if (activeModel === null || activeModel === modelId) {
    if (activeModel === null) activeModel = modelId;
    activeCount++;
    return Promise.resolve();
  }
  onWait();
  return new Promise(resolve => { waiters.push({ modelId, resolve }); });
}

function releaseModel() {
  activeCount--;
  if (activeCount > 0) return;
  if (!waiters.length) { activeModel = null; return; }
  const next = waiters[0].modelId;
  activeModel = next; activeCount = 0;
  const stay = [];
  for (const w of waiters) { if (w.modelId === next) { activeCount++; w.resolve(); } else stay.push(w); }
  waiters = stay;
}

export async function runQueued(enabled, modelId, onWait, fn) {
  if (!enabled) return fn();
  await acquireModel(modelId, onWait);
  try { return await fn(); }
  finally { releaseModel(); }
}
