/* Document edits. Everything the builder does to a theme goes through one of
   these, which keeps mutation in one file and lets the store treat every change
   as an opaque "replace the document". */

function isEmpty(v) {
  return v == null || v === '' || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
}

// Writing a blank clears the key rather than storing an empty string, so a
// document only ever contains properties an admin actually set.
export function setPath(doc, path, value) {
  const last = path[path.length - 1];
  let node = doc;
  for (const key of path.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  if (isEmpty(value)) delete node[last];
  else node[last] = value;
  prune(doc, path.slice(0, -1));
  return doc;
}

// An element that no longer carries any configuration is removed outright, so
// "has this been touched" stays a simple key check everywhere else.
function prune(doc, path) {
  for (let i = path.length; i > 0; i--) {
    const seg = path.slice(0, i);
    let node = doc;
    let parent = null;
    let key = null;
    for (const k of seg) { parent = node; key = k; node = node?.[k]; }
    if (node && typeof node === 'object' && !Array.isArray(node) && Object.keys(node).length === 0 && parent) delete parent[key];
  }
}

export function getPath(doc, path) {
  let node = doc;
  for (const key of path) {
    if (node == null) return undefined;
    node = node[key];
  }
  return node;
}

export function stylePath(elId, { state, breakpoint } = {}) {
  if (state) return ['elements', elId, 'states', state];
  if (breakpoint) return ['elements', elId, 'responsive', breakpoint, 'style'];
  return ['elements', elId, 'style'];
}

export function resetElement(doc, elId) {
  if (doc.elements) delete doc.elements[elId];
  return doc;
}

export function setHidden(doc, elId, hidden, breakpoint) {
  const path = breakpoint ? ['elements', elId, 'responsive', breakpoint, 'hidden'] : ['elements', elId, 'hidden'];
  return setPath(doc, path, hidden ? true : '');
}

export function setOrder(doc, itemId, order) {
  return setPath(doc, ['elements', itemId, 'order'], Number.isFinite(order) ? order : '');
}

// A drag drops one item at an index; every sibling is then renumbered so the
// stored orders stay dense and readable in the tree.
export function reorder(doc, items, fromId, toIndex) {
  const current = items
    .map(it => ({ ...it, order: Number(getPath(doc, ['elements', it.id, 'order'])) }))
    .map((it, i) => ({ ...it, order: Number.isFinite(it.order) ? it.order : i }))
    .sort((a, b) => a.order - b.order);
  const from = current.findIndex(i => i.id === fromId);
  if (from === -1) return doc;
  const [moved] = current.splice(from, 1);
  current.splice(Math.max(0, Math.min(current.length, toIndex)), 0, moved);
  current.forEach((it, i) => setPath(doc, ['elements', it.id, 'order'], i));
  return doc;
}

export function orderedItems(doc, items) {
  return items
    .map((it, i) => {
      const raw = Number(getPath(doc, ['elements', it.id, 'order']));
      return { ...it, order: Number.isFinite(raw) ? raw : i, natural: i };
    })
    .sort((a, b) => a.order - b.order || a.natural - b.natural);
}

/* ---------- slots ---------- */

let seq = 0;
export function nodeId() {
  seq += 1;
  return 'n' + Date.now().toString(36) + seq.toString(36);
}

export function addNode(doc, slot, node, index) {
  const list = Array.isArray(doc.slots?.[slot]) ? doc.slots[slot].slice() : [];
  list.splice(index == null ? list.length : index, 0, node);
  if (!doc.slots) doc.slots = {};
  doc.slots[slot] = list;
  return doc;
}

export function removeNode(doc, slot, id) {
  const list = (doc.slots?.[slot] || []).filter(n => n.id !== id);
  if (!doc.slots) return doc;
  if (list.length) doc.slots[slot] = list;
  else delete doc.slots[slot];
  return doc;
}

export function moveNode(doc, slot, id, toIndex) {
  const list = (doc.slots?.[slot] || []).slice();
  const i = list.findIndex(n => n.id === id);
  if (i === -1) return doc;
  const [n] = list.splice(i, 1);
  list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, n);
  doc.slots[slot] = list;
  return doc;
}

export function duplicateNode(doc, slot, id) {
  const list = doc.slots?.[slot] || [];
  const i = list.findIndex(n => n.id === id);
  if (i === -1) return doc;
  const copy = structuredClone(list[i]);
  copy.id = nodeId();
  return addNode(doc, slot, copy, i + 1);
}

export function updateNode(doc, slot, id, patch) {
  const list = (doc.slots?.[slot] || []).map(n => (n.id === id ? { ...n, ...patch } : n));
  if (doc.slots) doc.slots[slot] = list;
  return doc;
}

export function findNode(doc, id) {
  for (const slot of Object.keys(doc.slots || {})) {
    const hit = (doc.slots[slot] || []).find(n => n.id === id);
    if (hit) return { slot, node: hit };
  }
  return null;
}

/* ---------- counts ---------- */

export function elementEditCount(cfg) {
  if (!cfg) return 0;
  let n = 0;
  if (cfg.hidden) n++;
  if (Number.isFinite(Number(cfg.order))) n++;
  n += Object.keys(cfg.style || {}).length;
  n += Object.keys(cfg.content || {}).length;
  for (const s of Object.values(cfg.states || {})) n += Object.keys(s || {}).length;
  for (const r of Object.values(cfg.responsive || {})) n += Object.keys(r?.style || {}).length + (r?.hidden ? 1 : 0);
  if (cfg.animation?.name) n++;
  return n;
}

export function docEditCount(doc) {
  let n = 0;
  for (const cfg of Object.values(doc?.elements || {})) n += elementEditCount(cfg);
  for (const g of Object.values(doc?.tokens || {})) n += Object.keys(g || {}).length;
  n += Object.keys(doc?.content || {}).length;
  for (const list of Object.values(doc?.slots || {})) n += (list || []).length;
  return n;
}
