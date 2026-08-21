import { db, now } from '../db.js';

const KIND_PATTERNS = [
  [/was cut off before it finished/i, 'cut_off'],
  [/there is no tool called/i, 'unknown_tool'],
  [/\bneeds "/i, 'missing_arg'],
  [/old_str was not found|is not unique|old_str is empty|are identical/i, 'no_match'],
  [/blocked|outside the workspace|relative to the workspace root|above the root/i, 'blocked'],
  [/is not recognized as an internal|command not found|not installed/i, 'missing_program'],
  [/file not found|no such file/i, 'not_found'],
  [/timed out/i, 'timeout'],
  [/output exceeded|too large|workspace is full|limit/i, 'too_big'],
  [/exited with code/i, 'nonzero_exit']
];

export function classifyToolError(error) {
  const s = String(error || '');
  if (!s.trim()) return 'other';
  for (const [re, kind] of KIND_PATTERNS) if (re.test(s)) return kind;
  return 'other';
}

const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

export function noteToolCall(model, tool, ok, error) {
  const name = String(tool || '').trim();
  if (!name) return;
  const modelId = (model && model.id) || '';
  const id = `${modelId}|${name}`;
  try {
    const cur = db.toolStats.byId(id);
    const ts = now();
    if (!cur) {
      const row = {
        id, ts, model_id: modelId, model_name: (model && model.display_name) || '',
        tool: name, ok: ok ? 1 : 0, fail: ok ? 0 : 1, kinds: {},
        last_error: '', last_error_ts: 0, first_ts: ts
      };
      if (!ok) {
        const kind = classifyToolError(error);
        row.kinds[kind] = 1;
        row.last_error = String(error || '').slice(0, 300);
        row.last_error_ts = ts;
      }
      db.toolStats.insert(row);
      return;
    }
    const patch = { ts };
    if (ok) patch.ok = (Number(cur.ok) || 0) + 1;
    else {
      const kind = classifyToolError(error);
      const kinds = { ...(cur.kinds || {}) };
      kinds[kind] = (Number(kinds[kind]) || 0) + 1;
      patch.fail = (Number(cur.fail) || 0) + 1;
      patch.kinds = kinds;
      patch.last_error = String(error || '').slice(0, 300);
      patch.last_error_ts = ts;
    }
    db.toolStats.update(id, patch);
  } catch {}
}

export function toolStatsReport() {
  let rows;
  try { rows = db.toolStats.all(); } catch { return { rows: [], totals: { calls: 0, fail: 0 } }; }
  const out = rows.map(r => {
    const ok = Number(r.ok) || 0;
    const fail = Number(r.fail) || 0;
    const calls = ok + fail;
    const kinds = Object.entries(r.kinds || {})
      .map(([kind, n]) => ({ kind, n: Number(n) || 0 }))
      .sort((a, b) => b.n - a.n);
    return {
      tool: r.tool,
      modelId: r.model_id || '',
      modelName: r.model_name || '',
      calls,
      ok,
      fail,
      rate: calls ? fail / calls : 0,
      kinds,
      lastError: r.last_error || '',
      lastErrorTs: Number(r.last_error_ts) || 0,
      ts: Number(r.ts) || 0
    };
  }).filter(r => r.calls > 0);
  out.sort((a, b) => b.fail - a.fail || b.calls - a.calls);
  const totals = out.reduce((a, r) => ({ calls: a.calls + r.calls, fail: a.fail + r.fail }), { calls: 0, fail: 0 });
  return { rows: out, totals };
}

export function pruneToolStats() {
  try { return db.toolStats.prune(Date.now() - KEEP_MS); } catch { return 0; }
}
