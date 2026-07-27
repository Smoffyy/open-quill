const OQR = /\[\[OQR:[A-Za-z0-9+/=]+\]\]/g;
const TOOL_HINT = /```tool|\[\[OQR:|<\s*\|?\s*tool\b|\|tool\|/i;
const FENCE = /```[\s\S]*?(?:```|$)/g;

export function hasToolCall(text) {
  return !!text && TOOL_HINT.test(text);
}

export function previewOf(text, max) {
  if (!text) return '';
  const limit = max || 90;
  const clean = String(text)
    .replace(OQR, ' ')
    .replace(FENCE, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > limit ? clean.slice(0, limit - 1) + '…' : clean;
}

export function railItems(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  let turn = 0;
  for (const m of list) {
    if (!m || !m.id) continue;
    if (m.role === 'user') turn++;
    out.push({
      id: m.id,
      role: m.role === 'user' ? 'user' : 'assistant',
      turn,
      tool: m.role !== 'user' && hasToolCall(m.content),
      branch: (m.branchCount || 0) > 1,
      branchIndex: m.branchIndex || 0,
      branchCount: m.branchCount || 0,
      pinned: !!m.pinned,
      excluded: !!m.excluded,
      streaming: !!m._streaming,
      preview: previewOf(m.content)
    });
  }
  return out;
}

export function buildTree(nodes) {
  const byId = new Map();
  for (const n of nodes) byId.set(n.id, { ...n, children: [] });
  const roots = [];
  for (const n of byId.values()) {
    const parent = n.parentId ? byId.get(n.parentId) : null;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const sort = (arr) => { arr.sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0)); arr.forEach(c => sort(c.children)); };
  sort(roots);
  return roots;
}

export function collapseRuns(node) {
  const run = [node];
  let cur = node;
  while (cur.children.length === 1) { cur = cur.children[0]; run.push(cur); }
  return { run, forks: cur.children };
}
