export const MAX_LANES = 3;
export const STORE_KEY = 'oq.playground.v2';
export const STORE_MAX = 400000;

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const laneKey = (lane) => (lane ? lane.modelId + ':' + (lane.source === 'live' ? 'live' : 'draft') : '');

export function makeLane(modelId, source = 'draft') {
  return { id: newId(), modelId, source: source === 'live' ? 'live' : 'draft', kwargValues: {}, extended: false, tools: true };
}

export function addLane(lanes, modelId, source) {
  const lane = makeLane(modelId, source);
  if (lanes.length >= MAX_LANES || lanes.some(l => laneKey(l) === laneKey(lane))) return lanes;
  return [...lanes, lane];
}

export function moveSubject(lanes, from, to) {
  if (!to) return lanes;
  const head = { ...(lanes[0] || makeLane(to)), modelId: to, source: 'draft', kwargValues: {} };
  const seen = new Set([laneKey(head)]);
  const out = [head];
  for (const l of lanes.slice(1)) {
    const next = l.modelId === from ? { ...l, modelId: to, kwargValues: {} } : l;
    if (seen.has(laneKey(next))) continue;
    seen.add(laneKey(next));
    out.push(next);
  }
  return out;
}

export function laneRow(lane, models, live) {
  if (!lane) return null;
  if (lane.source === 'live') return (live && live[lane.modelId]) || null;
  return (models || []).find(m => m.id === lane.modelId) || null;
}

export function kwargDefsOf(row, legacy) {
  if (!row) return [];
  if (Array.isArray(row.kwargs) && row.kwargs.length) return row.kwargs;
  return row.effort_enabled && legacy ? [legacy(row)] : [];
}

export function usesPromptToken(row) {
  return !!row?.has_reasoning && !row?.effort_enabled
    && !!(String(row.reasoning_token || '').trim() || String(row.non_reasoning_token || '').trim());
}

export function pickedText(turn) {
  if (!turn) return '';
  if (Array.isArray(turn.replies)) {
    if (!turn.replies.length) return '';
    const at = Math.min(Math.max(0, turn.pick || 0), turn.replies.length - 1);
    return turn.replies[at]?.content || '';
  }
  return turn.content || '';
}

export function historyFor(thread) {
  const out = [];
  for (const turn of thread || []) {
    const content = pickedText(turn);
    if (!content.trim()) continue;
    out.push({ role: turn.role, content });
  }
  return out;
}

export function tally(thread, results) {
  const wins = {};
  const count = (key) => { if (key) wins[key] = (wins[key] || 0) + 1; };
  for (const turn of thread || []) {
    if (!Array.isArray(turn.replies) || turn.replies.length < 2 || !turn.chosen) continue;
    count(turn.replies[turn.pick || 0]?.key);
  }
  for (const row of Object.values(results || {})) count(row?.pick);
  return wins;
}

export function sseSplit(buffer) {
  const lines = String(buffer || '').split('\n');
  const rest = lines.pop();
  const events = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    try { events.push(JSON.parse(s.slice(5).trim())); } catch {}
  }
  return { events, rest };
}

export function runStats({ startedAt = 0, firstAt = 0, endedAt = 0, usage = null } = {}) {
  const end = endedAt || firstAt || startedAt;
  const total = Math.max(0, end - startedAt);
  const ttft = firstAt ? Math.max(0, firstAt - startedAt) : null;
  const genMs = firstAt ? Math.max(0, end - firstAt) : 0;
  const out = Number.isFinite(usage?.completion) ? usage.completion : null;
  const prompt = Number.isFinite(usage?.prompt) ? usage.prompt : null;
  const tps = out != null && genMs > 0 ? out / (genMs / 1000) : null;
  return { total, ttft, genMs, out, prompt, tps };
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(2) + 's';
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return m + 'm ' + String(s).padStart(2, '0') + 's';
}

export function fmtCount(n) {
  if (!Number.isFinite(n)) return '–';
  return Math.round(n).toLocaleString('en-US');
}

export function fmtRate(n) {
  if (!Number.isFinite(n) || n <= 0) return '–';
  return (n >= 100 ? Math.round(n) : n.toFixed(1)) + ' tok/s';
}

export function statTiles(stats) {
  if (!stats) return [];
  return [
    { id: 'ttft', label: 'First token', value: stats.ttft == null ? '–' : fmtDuration(stats.ttft) },
    { id: 'out', label: 'Output', value: stats.out == null ? '–' : fmtCount(stats.out) },
    { id: 'tps', label: 'Speed', value: fmtRate(stats.tps) },
    { id: 'prompt', label: 'Prompt', value: stats.prompt == null ? '–' : fmtCount(stats.prompt) },
    { id: 'total', label: 'Total', value: fmtDuration(stats.total) }
  ];
}

export function replyStats(reply) {
  if (!reply || !reply.startedAt) return null;
  return runStats({ startedAt: reply.startedAt, firstAt: reply.firstAt, endedAt: reply.endedAt || reply.firstAt, usage: reply.usage });
}

export function settle(reply) {
  if (!reply || (reply.status !== 'run' && reply.status !== 'queue')) return reply;
  return { ...reply, status: 'stopped', endedAt: reply.endedAt || reply.firstAt || reply.startedAt };
}

export function transcriptJson(thread, meta = {}) {
  return JSON.stringify({
    ...meta,
    messages: (thread || []).map(turn => {
      const row = { role: turn.role, content: pickedText(turn) };
      if (Array.isArray(turn.replies) && turn.replies.length > 1) {
        row.replies = turn.replies.map(r => ({ model: r.name, source: r.source, content: r.content }));
      }
      return row;
    })
  }, null, 2);
}

export function restoreSession(raw, modelIds) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const known = new Set(modelIds || []);
  const lanes = (Array.isArray(s.lanes) ? s.lanes : [])
    .filter(l => l && known.has(l.modelId))
    .slice(0, MAX_LANES)
    .map(l => ({ ...makeLane(l.modelId, l.source), id: String(l.id || newId()), kwargValues: l.kwargValues && typeof l.kwargValues === 'object' ? l.kwargValues : {}, extended: !!l.extended, tools: l.tools !== false }));
  const thread = (Array.isArray(s.thread) ? s.thread : [])
    .filter(turn => turn && ['user', 'assistant', 'system'].includes(turn.role))
    .map(turn => (Array.isArray(turn.replies) ? { ...turn, replies: turn.replies.map(settle) } : turn));
  const results = {};
  for (const [sid, rows] of Object.entries(s.results && typeof s.results === 'object' ? s.results : {})) {
    results[sid] = {};
    for (const [cid, row] of Object.entries(rows || {})) {
      const cells = {};
      for (const [k, r] of Object.entries(row?.cells || {})) cells[k] = settle(r);
      results[sid][cid] = { pick: row?.pick || '', cells };
    }
  }
  return {
    subjectId: known.has(s.subjectId) ? s.subjectId : '',
    lanes,
    thread,
    results,
    mode: s.mode === 'suite' ? 'suite' : 'chat',
    suiteId: typeof s.suiteId === 'string' ? s.suiteId : '',
    input: typeof s.input === 'string' ? s.input : '',
    role: ['user', 'assistant', 'system'].includes(s.role) ? s.role : 'user',
    panel: s.panel !== false
  };
}

export function blankSuite(name, cases = []) {
  return { id: newId(), name, cases: cases.map(c => ({ id: newId(), prompt: c.prompt, expect: c.expect || '' })) };
}

export function patchCase(suites, suiteId, caseId, patch) {
  return suites.map(s => (s.id !== suiteId ? s : { ...s, cases: s.cases.map(c => (c.id === caseId ? { ...c, ...patch } : c)) }));
}

export function suiteWins(rows, lanes) {
  const out = {};
  for (const l of lanes || []) out[laneKey(l)] = 0;
  for (const row of Object.values(rows || {})) if (row?.pick && row.pick in out) out[row.pick]++;
  return out;
}

export function groupModels(models, folderOf) {
  const groups = [];
  const seen = new Map();
  for (const m of models || []) {
    const label = (folderOf ? folderOf(m) : '') || '';
    if (!seen.has(label)) { seen.set(label, { label, items: [] }); groups.push(seen.get(label)); }
    seen.get(label).items.push(m);
  }
  return groups;
}