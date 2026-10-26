import { db, now } from '../db.js';
import * as sandbox from '../sandbox.js';
import { workspaceOfProject } from './projectfiles.js';
import { runChatSearchTool, formatChatSearchResult, chatSearchPayload } from './prompts.js';

export const PROJECT_TOOLS = new Set(['project_files', 'project_read', 'project_search', 'project_chats', 'project_notes']);
export const NOTES_MAX = 20000;

const LIST_CAP = 100;
const SEARCH_CAP = 40;
const DOC_EXT = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp', 'rtf', 'epub']);

function projectOf(chat) {
  const p = chat?.project_id ? db.projects.byId(chat.project_id) : null;
  return p && p.user_id === chat.user_id ? p : null;
}

function isDocument(f) {
  return DOC_EXT.has(f.ext);
}

async function searchKnowledge(key, query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'query is required.' };
  const text = await sandbox.search(key, q);
  if (!text.ok) return text;
  const matches = text.matches.slice();
  const needle = q.toLowerCase();
  for (const f of sandbox.list(key)) {
    if (matches.length >= SEARCH_CAP) break;
    if (!isDocument(f)) continue;
    const body = await sandbox.documentText(key, f.path);
    if (!body) continue;
    const lines = body.split('\n');
    for (let i = 0; i < lines.length && matches.length < SEARCH_CAP; i++) {
      if (lines[i].toLowerCase().includes(needle)) matches.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, 240) });
    }
  }
  return { ok: true, query: q, matches, count: matches.length, truncated: matches.length >= SEARCH_CAP };
}

function changeNotes(project, call) {
  const action = String(call.action || '').toLowerCase();
  const text = String(call.text ?? '').trim();
  if (action !== 'append' && action !== 'replace') return { ok: false, error: 'action must be "append" or "replace".' };
  if (!text && action === 'append') return { ok: false, error: 'text is required: the entry to add.' };
  const before = String(project.notes || '');
  const next = action === 'replace' ? text : (before.trim() ? before.trimEnd() + '\n\n' + text : text);
  if (next.length > NOTES_MAX) return { ok: false, error: `The notes would be longer than ${NOTES_MAX} characters. Condense them with replace first.` };
  db.projects.update(project.id, { notes: next, notes_updated_at: now(), updated_at: now() });
  return { ok: true, action, chars: next.length };
}

export async function runProjectTool(chat, call) {
  const project = projectOf(chat);
  if (!project) return { ok: false, error: 'This chat is not part of a project.' };
  const key = workspaceOfProject(project.id);
  switch (call.tool) {
    case 'project_files': {
      const files = sandbox.list(key);
      return { ok: true, count: files.length, files: files.slice(0, LIST_CAP).map(f => ({ path: f.path, size: f.size })) };
    }
    case 'project_read': {
      if (!call.path) return { ok: false, error: 'path is required: a document from project_files.' };
      return sandbox.execTool(key, { tool: 'view', path: call.path, start: call.start, end: call.end });
    }
    case 'project_search':
      return searchKnowledge(key, call.query);
    case 'project_chats': {
      const inner = call.chat_id ? { tool: 'chat_view', chat_id: call.chat_id, limit: call.limit } : { tool: 'chat_search', query: call.query };
      if (!call.chat_id && !String(call.query || '').trim()) return { ok: false, error: 'Pass query to search, or chat_id to read a chat.' };
      return { ...runChatSearchTool(chat.user_id, chat.id, inner, project.id), inner };
    }
    case 'project_notes':
      return changeNotes(project, call);
    default:
      return { ok: false, error: `Unknown project tool ${call.tool}.` };
  }
}

export function projectPayload(call, r) {
  if (call.tool === 'project_chats' && r.inner) return chatSearchPayload(r.inner, r);
  const o = { ok: !!r.ok };
  if (r.error) o.error = r.error;
  for (const k of ['count', 'lines', 'path', 'action', 'chars']) if (r[k] != null) o[k] = r[k];
  return o;
}

export function formatProjectResult(call, r) {
  if (call.tool === 'project_chats' && r.inner) return formatChatSearchResult(r.inner, r).replace(/^chat_(search|view)/, 'project_chats');
  if (!r.ok) return `${call.tool} → ERROR: ${r.error}`;
  switch (call.tool) {
    case 'project_files':
      return `project_files → ${r.count} document(s)` + (r.files.length ? '\n' + r.files.map(f => `- ${f.path} (${f.size} bytes)`).join('\n') : '');
    case 'project_read':
      return `project_read ${r.path} →\n${r.content}`;
    case 'project_search':
      return `project_search "${r.query}" → ${r.count} match(es)` + (r.matches.length ? '\n' + r.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') : '');
    case 'project_notes':
      return `project_notes → ${r.action === 'replace' ? 'notes rewritten' : 'entry added'} (${r.chars} characters)`;
    default:
      return `${call.tool} → ok`;
  }
}

export function projectFilesText(projectId) {
  if (!projectId) return '';
  let files;
  try { files = sandbox.list(workspaceOfProject(projectId)); } catch { files = []; }
  if (!files.length) return '(no documents yet; the user can add them on the project page)';
  const lines = files.slice(0, LIST_CAP).map(f => `- ${f.path} (${f.size} bytes)`);
  if (files.length > LIST_CAP) lines.push(`- ... and ${files.length - LIST_CAP} more; use project_files or project_search to reach them.`);
  return lines.join('\n');
}