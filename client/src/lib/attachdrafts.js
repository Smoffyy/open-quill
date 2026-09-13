const DB_NAME = 'oq-attachments';
const STORE = 'drafts';
const mem = new Map();

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

async function tx(mode, run) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.onabort = t.onerror = () => resolve(null);
      t.oncomplete = () => resolve(req ? req.result : null);
    } catch { resolve(null); }
  });
}

export function attachKey(id) { return String(id || 'new'); }

const strip = (f) => ({ id: f.id, file: f.file, name: f.name, type: f.type, size: f.size });

export function peekAttachments(key) { return mem.get(key) || null; }

export async function readAttachments(key) {
  const hit = mem.get(key);
  if (hit) return hit;
  const rows = await tx('readonly', (s) => s.get(key));
  const list = Array.isArray(rows) ? rows.filter(r => r && r.file) : [];
  mem.set(key, list);
  return list;
}

export function writeAttachments(key, files) {
  const list = files.map(strip);
  mem.set(key, list);
  if (list.length) tx('readwrite', (s) => s.put(list, key));
  else tx('readwrite', (s) => s.delete(key));
}

export function dropAttachments(key) {
  mem.delete(key);
  tx('readwrite', (s) => s.delete(key));
}
