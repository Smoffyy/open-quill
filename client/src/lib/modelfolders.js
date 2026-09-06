// Grouping logic for the admin model list. Kept out of the component so it can
// be tested directly — node --test cannot parse JSX.
//
// A folder is not a record of its own: membership lives on the model row, where
// in_more_models marks it and more_models_label names it. Reading both through
// one helper is what stops the two fields drifting out of step.

export function folderOf(m) {
  return m && m.in_more_models ? ((m.more_models_label || '').trim() || null) : null;
}

// Build the display order. A folder's members must be contiguous or the same
// folder would draw a second header further down the list, so each folder is
// emitted once — at the position of its first member — with the rest of its
// models pulled in behind it. Named folders that hold nothing yet are appended
// so one can be created before there is anything to put in it.
export function groupRows(rows, empties = []) {
  const out = [];
  const placed = new Set();
  for (const m of rows) {
    const name = folderOf(m);
    if (!name) { out.push({ kind: 'model', key: m.id, model: m }); continue; }
    if (placed.has(name)) continue;
    placed.add(name);
    out.push({ kind: 'folder', key: 'f:' + name, name, models: rows.filter(x => folderOf(x) === name) });
  }
  for (const name of empties) {
    if (!placed.has(name)) out.push({ kind: 'folder', key: 'f:' + name, name, models: [] });
  }
  return out;
}

// Where a set of models lands when it is dropped. Returns the full reordered
// list plus the patch that moves the rows in or out of a folder, so a caller
// never has to keep the label and the order in step by hand.
export function planMove(models, ids, { folder = null, targetId = null, after = false } = {}) {
  const moving = new Set(ids);
  const rest = models.filter(m => !moving.has(m.id));
  const ordered = models.filter(m => moving.has(m.id));

  let at = rest.length;
  if (targetId) {
    const i = rest.findIndex(m => m.id === targetId);
    if (i >= 0) at = after ? i + 1 : i;
  } else if (folder) {
    // Dropped on a folder header with no row named: land after its last member.
    const members = rest.map((m, i) => (folderOf(m) === folder ? i : -1)).filter(i => i >= 0);
    if (members.length) at = members[members.length - 1] + 1;
  }

  return {
    order: [...rest.slice(0, at), ...ordered, ...rest.slice(at)],
    patch: folder ? { in_more_models: 1, more_models_label: folder } : { in_more_models: 0 },
    // Rows already in the right folder only need reordering.
    needsPatch: ordered.some(m => folderOf(m) !== folder)
  };
}
