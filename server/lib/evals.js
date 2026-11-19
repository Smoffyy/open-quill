import { db, uid, now, getSetting, setSetting } from '../db.js';
import { sortedMsgs } from './tree.js';
import { isTextLike, readUploadText } from './uploads.js';
import { replyText, toolEvidence } from './grader.js';
import { SUITE_LIMITS } from './playground.js';

export const LIMITS = { collections: 100, cases: 500, name: 80, description: 400, title: 120, content: 20000, turns: 40, reference: 12000, notes: 2000, versionsKept: 100, runsKept: 30, attachment: 8000 };
const ROLES = { __proto__: null, user: 'user', assistant: 'assistant' };
const SUITES_KEY = 'playground_suites';
const IMPORTED_KEY = 'eval_suites_imported';

const text = (v, cap) => (typeof v === 'string' ? v.slice(0, cap) : '');
const idOf = (v) => (typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : uid());

export function cleanMessages(list) {
  const out = [];
  for (const m of (Array.isArray(list) ? list : []).slice(-LIMITS.turns)) {
    const role = ROLES[m?.role];
    const content = text(m?.content, LIMITS.content);
    if (role && content.trim()) out.push({ role, content });
  }
  while (out.length && out[out.length - 1].role !== 'user') out.pop();
  return out;
}

export function cleanCase(raw, fallbackId) {
  const messages = cleanMessages(raw?.messages);
  if (!messages.length) return null;
  const last = messages[messages.length - 1].content;
  const source = raw?.source && typeof raw.source === 'object' ? {
    kind: ['manual', 'chat', 'rating', 'quality', 'playground'].includes(raw.source.kind) ? raw.source.kind : 'manual',
    chatId: text(raw.source.chatId, 64), messageId: text(raw.source.messageId, 64)
  } : { kind: 'manual', chatId: '', messageId: '' };
  return {
    id: idOf(raw?.id || fallbackId),
    title: text(raw?.title, LIMITS.title).trim() || last.replace(/\s+/g, ' ').trim().slice(0, 80),
    messages,
    reference: text(raw?.reference, LIMITS.reference),
    observed: text(raw?.observed, LIMITS.reference),
    notes: text(raw?.notes, LIMITS.notes),
    source
  };
}

function summary(c) {
  const { cases, ...rest } = c;
  return { ...rest, caseCount: (cases || []).length };
}

export function listCollections() {
  importSuites();
  return db.evalCollections.all().sort((a, b) => b.updated_at - a.updated_at).map(summary);
}

export function getCollection(id) {
  return db.evalCollections.byId(id) || null;
}

export function createCollection(body, user) {
  if (db.evalCollections.count() >= LIMITS.collections) return { error: 'There are too many test collections. Delete one first.' };
  const name = text(body?.name, LIMITS.name).trim();
  if (!name) return { error: 'A collection needs a name.' };
  const t = now();
  const c = db.evalCollections.insert({
    id: uid(), name, description: text(body?.description, LIMITS.description).trim(), version: 0, cases: [],
    created_at: t, updated_at: t, created_by: user?.email || ''
  });
  return { collection: c };
}

export function renameCollection(id, body) {
  const c = getCollection(id);
  if (!c) return { error: 'Collection not found.' };
  const patch = { updated_at: now() };
  if ('name' in (body || {})) patch.name = text(body.name, LIMITS.name).trim() || c.name;
  if ('description' in (body || {})) patch.description = text(body.description, LIMITS.description).trim();
  return { collection: db.evalCollections.update(id, patch) };
}

export function removeCollection(id) {
  if (!getCollection(id)) return { error: 'Collection not found.' };
  db.evalCollections.removeById(id);
  db.evalVersions.removeWhere('collection_id', id);
  db.evalRuns.removeWhere('collection_id', id);
  return { ok: true };
}

export function saveCases(id, mutate, user, note = '') {
  const c = getCollection(id);
  if (!c) return { error: 'Collection not found.' };
  const next = mutate(c.cases || []);
  if (next?.error) return next;
  const cases = next.slice(0, LIMITS.cases);
  if (JSON.stringify(cases) === JSON.stringify(c.cases || [])) return { collection: c, changed: false };
  const version = (c.version || 0) + 1;
  const t = now();
  db.evalVersions.insert({ id: uid(), collection_id: id, version, created_at: t, note: text(note, 200), by: user?.email || '', caseCount: cases.length, cases });
  if (version > LIMITS.versionsKept) db.evalVersions.pruneThrough(id, version - LIMITS.versionsKept);
  return { collection: db.evalCollections.update(id, { cases, version, updated_at: t }), changed: true };
}

export function addCase(id, raw, user) {
  const kase = cleanCase(raw);
  if (!kase) return { error: 'A test case needs at least one user message.' };
  return saveCases(id, (cases) => {
    if (cases.length >= LIMITS.cases) return { error: 'This collection is full.' };
    return [...cases.filter(x => x.id !== kase.id), kase];
  }, user, `Added "${kase.title}"`);
}

export function updateCase(id, caseId, raw, user) {
  return saveCases(id, (cases) => {
    const cur = cases.find(x => x.id === caseId);
    if (!cur) return { error: 'Test case not found.' };
    const kase = cleanCase({ ...cur, ...raw, id: caseId, source: cur.source });
    if (!kase) return { error: 'A test case needs at least one user message.' };
    return cases.map(x => (x.id === caseId ? kase : x));
  }, user, 'Edited a case');
}

export function removeCase(id, caseId, user) {
  return saveCases(id, (cases) => {
    if (!cases.some(x => x.id === caseId)) return { error: 'Test case not found.' };
    return cases.filter(x => x.id !== caseId);
  }, user, 'Removed a case');
}

export function versionsOf(id) {
  return db.evalVersions.list(id);
}

export function casesAt(id, version) {
  const c = getCollection(id);
  if (!c) return null;
  if (!version || version === c.version) return c.cases || [];
  return db.evalVersions.get(id, version)?.cases || null;
}

export function restoreVersion(id, version, user) {
  const cases = casesAt(id, Number(version));
  if (!cases) return { error: 'That version is no longer kept.' };
  return saveCases(id, () => cases, user, `Restored version ${Number(version)}`);
}

export function pathTo(chatId, messageId) {
  const byId = new Map(sortedMsgs(chatId).map(m => [m.id, m]));
  const out = [];
  for (let m = byId.get(messageId); m; m = m.parent_id ? byId.get(m.parent_id) : null) out.unshift(m);
  return out;
}

export function attachmentContext(messages) {
  const out = [];
  for (const m of messages) {
    for (const a of Array.isArray(m.attachments) ? m.attachments : []) {
      if (!isTextLike(a)) continue;
      const body = readUploadText(a.url);
      if (body) out.push(`[${a.name || 'attachment'}]\n${body.slice(0, LIMITS.attachment)}`);
    }
  }
  return out;
}

export function conversationAt(messageId) {
  const reply = db.messages.byId(messageId);
  if (!reply || reply.role !== 'assistant') return null;
  const chat = db.chats.byId(reply.chat_id);
  if (!chat) return null;
  const path = pathTo(chat.id, reply.id);
  const before = path.slice(0, -1);
  return {
    chat, reply, before,
    replyText: replyText(reply.content),
    context: [...attachmentContext(before), ...toolEvidence(reply.content)]
  };
}

export function caseFromReply(messageId, { reference = '', kind = 'chat' } = {}) {
  const at = conversationAt(messageId);
  if (!at) return null;
  const messages = at.before.map(m => ({ role: m.role, content: m.role === 'assistant' ? replyText(m.content) : String(m.content || '') }));
  return cleanCase({ messages, observed: at.replyText, reference, source: { kind, chatId: at.chat.id, messageId } });
}

export function suitesView() {
  return listCollections().filter(s => s.caseCount <= SUITE_LIMITS.cases).slice(0, SUITE_LIMITS.sets).map(s => {
    const c = getCollection(s.id);
    return {
      id: c.id, name: c.name,
      cases: (c.cases || []).map(k => ({ id: k.id, prompt: k.messages[k.messages.length - 1]?.content || '', expect: k.reference || '' }))
    };
  });
}

export function saveSuites(suites, user) {
  const keep = new Set(suites.map(s => s.id));
  const visible = new Set(suitesView().map(s => s.id));
  for (const s of db.evalCollections.all()) if (s.source === 'playground' && visible.has(s.id) && !keep.has(s.id)) removeCollection(s.id);
  for (const s of suites) {
    let c = getCollection(s.id);
    if (!c) {
      const t = now();
      c = db.evalCollections.insert({ id: s.id, name: s.name, description: '', version: 0, cases: [], source: 'playground', created_at: t, updated_at: t, created_by: user?.email || '' });
    } else if (c.name !== s.name) db.evalCollections.update(c.id, { name: s.name, updated_at: now() });
    saveCases(c.id, (cases) => s.cases.map(k => {
      const cur = cases.find(x => x.id === k.id);
      const messages = cur ? [...cur.messages.slice(0, -1), { role: 'user', content: k.prompt }] : [{ role: 'user', content: k.prompt }];
      return cleanCase({ ...(cur || { source: { kind: 'playground' } }), id: k.id, messages, reference: k.expect, title: cur?.title && cur.messages.at(-1)?.content === k.prompt ? cur.title : '' });
    }).filter(Boolean), user, 'Edited in the playground');
  }
  return suitesView();
}

export function importSuites() {
  if (getSetting(IMPORTED_KEY, false)) return;
  const suites = getSetting(SUITES_KEY, []);
  for (const s of Array.isArray(suites) ? suites : []) {
    if (!s?.id || getCollection(s.id)) continue;
    const t = now();
    db.evalCollections.insert({ id: s.id, name: String(s.name || 'Untitled set').slice(0, LIMITS.name), description: '', version: 0, cases: [], source: 'playground', created_at: t, updated_at: t, created_by: '' });
    saveCases(s.id, () => (Array.isArray(s.cases) ? s.cases : []).map(k => cleanCase({ id: k.id, messages: [{ role: 'user', content: k.prompt }], reference: k.expect, source: { kind: 'playground' } })).filter(Boolean), null, 'Imported from the playground');
  }
  setSetting(IMPORTED_KEY, true);
}