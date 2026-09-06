export const MIRROR = {
  users: { email: o => o.email ?? null, created_at: o => o.created_at ?? 0 },
  folders: { user_id: o => o.user_id ?? null, sort_order: o => o.sort_order ?? 0, created_at: o => o.created_at ?? 0 },
  chats: { user_id: o => o.user_id ?? null, folder_id: o => o.folder_id ?? null, updated_at: o => o.updated_at ?? 0 },
  messages: { chat_id: o => o.chat_id ?? null, parent_id: o => o.parent_id ?? null, created_at: o => o.created_at ?? 0 },
  models: { sort_order: o => o.sort_order ?? 0, enabled: o => o.enabled ?? 0 },
  usage: { user_id: o => o.user_id ?? null, model_id: o => o.model_id ?? null, created_at: o => o.created_at ?? 0 },
  spaces: { owner_id: o => o.owner_id ?? null, created_at: o => o.created_at ?? 0, updated_at: o => o.updated_at ?? 0 },
  space_messages: { space_id: o => o.space_id ?? null, created_at: o => o.created_at ?? 0 },
  sessions: { user_id: o => o.user_id ?? null, last_seen: o => o.last_seen ?? 0, created_at: o => o.created_at ?? 0 },
  audit: { ts: o => o.ts ?? 0, actor_id: o => o.actor_id ?? null },
  projects: { user_id: o => o.user_id ?? null, updated_at: o => o.updated_at ?? 0, created_at: o => o.created_at ?? 0 },
  feedback: { ts: o => o.ts ?? 0, user_id: o => o.user_id ?? null },
  toolstats: { ts: o => o.ts ?? 0 },
  tasks: { user_id: o => o.user_id ?? null, next_run: o => o.next_run ?? 0, updated_at: o => o.updated_at ?? 0, created_at: o => o.created_at ?? 0 },
  skills: { user_id: o => o.user_id ?? null, name: o => o.name ?? null, updated_at: o => o.updated_at ?? 0, created_at: o => o.created_at ?? 0 }
};

const bumps = new Map();
export function bumpTable(table) { bumps.set(table, (bumps.get(table) || 0) + 1); }

const isKey = id => typeof id === 'string' || typeof id === 'number';

export function makeCollection(sdb, table) {
  const cols = Object.keys(MIRROR[table]);
  const mirror = MIRROR[table];
  const bump = () => bumpTable(table);
  const colList = ['id', ...cols, 'data'];
  const insSql = `INSERT INTO ${table} (${colList.join(',')}) VALUES (${colList.map(() => '?').join(',')})`;
  const insStmt = sdb.prepare(insSql);
  const updSql = `UPDATE ${table} SET ${[...cols, 'data'].map(c => `${c}=?`).join(',')} WHERE id=?`;
  const updStmt = sdb.prepare(updSql);
  const getStmt = sdb.prepare(`SELECT data FROM ${table} WHERE id=?`);
  const allStmt = sdb.prepare(`SELECT data FROM ${table}`);
  const delStmt = sdb.prepare(`DELETE FROM ${table} WHERE id=?`);
  const cntStmt = sdb.prepare(`SELECT count(*) AS n FROM ${table}`);
  const parse = r => r ? JSON.parse(r.data) : undefined;
  const rowVals = o => [...cols.map(c => mirror[c](o)), JSON.stringify(o)];

  const whereStmts = new Map();
  const whereStmt = (col) => {
    if (!whereStmts.has(col)) whereStmts.set(col, sdb.prepare(`SELECT data FROM ${table} WHERE ${col} IS ?`));
    return whereStmts.get(col);
  };
  const countWhereStmts = new Map();
  const countWhereStmt = (col) => {
    if (!countWhereStmts.has(col)) countWhereStmts.set(col, sdb.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${col} IS ?`));
    return countWhereStmts.get(col);
  };
  const delWhereStmts = new Map();
  const delWhereStmt = (col) => {
    if (!delWhereStmts.has(col)) delWhereStmts.set(col, sdb.prepare(`DELETE FROM ${table} WHERE ${col} IS ?`));
    return delWhereStmts.get(col);
  };

  const api = {
    version: () => bumps.get(table) || 0,
    all: () => allStmt.all().map(r => JSON.parse(r.data)),
    filter: fn => allStmt.all().map(r => JSON.parse(r.data)).filter(fn),
    find: fn => allStmt.all().map(r => JSON.parse(r.data)).find(fn),
    // Ids arrive from request bodies and params. better-sqlite3 throws on a bound object
    // or array, which turned "look up this thing" into a 500 in every route that did not
    // coerce first; a non-primitive id simply matches nothing.
    byId: id => (isKey(id) ? parse(getStmt.get(id)) : undefined),
    where: (col, val) => (cols.includes(col) ? whereStmt(col).all(val ?? null).map(r => JSON.parse(r.data)) : api.filter(o => (o[col] ?? null) === (val ?? null))),
    countWhere: (col, val) => (cols.includes(col) ? countWhereStmt(col).get(val ?? null).n : api.filter(o => (o[col] ?? null) === (val ?? null)).length),
    removeWhere: (col, val) => { if (!cols.includes(col)) return api.remove(o => (o[col] ?? null) === (val ?? null)); delWhereStmt(col).run(val ?? null); bump(); },
    insert: obj => { insStmt.run(obj.id, ...rowVals(obj)); bump(); return obj; },
    update: (id, patch) => {
      if (!isKey(id)) return undefined;
      const cur = parse(getStmt.get(id));
      if (!cur) return undefined;
      Object.assign(cur, patch);
      updStmt.run(...rowVals(cur), id);
      bump();
      return cur;
    },
    removeById: id => { if (!isKey(id)) return; delStmt.run(id); bump(); },
    removeByIds: ids => {
      const list = (Array.isArray(ids) ? ids : [...ids]).filter(isKey);
      if (!list.length) return;
      const tx = sdb.transaction(rows => { for (const id of rows) delStmt.run(id); });
      tx(list);
      bump();
    },
    remove: fn => {
      const rows = allStmt.all().map(r => JSON.parse(r.data)).filter(fn);
      if (!rows.length) return;
      const tx = sdb.transaction(list => { for (const r of list) delStmt.run(r.id); });
      tx(rows);
      bump();
    },
    count: fn => fn ? api.filter(fn).length : cntStmt.get().n
  };
  return api;
}

export { isKey };
