import fs from 'fs';
import path from 'path';
import { dataPath } from './lib/dataroot.js';
import { list as wsList, importBuffer, readBuffer, remove as wsRemove } from './sandbox/files.js';
import { wsKey, projectKey } from './sandbox/paths.js';

const LEGACY_ROOT = dataPath('projectfiles');

function legacyDir(projectId) {
  const safe = String(projectId || '').replace(/[^a-zA-Z0-9-]/g, '');
  return safe ? path.join(LEGACY_ROOT, safe) : null;
}

export function migrate(projectId) {
  const dir = legacyDir(projectId);
  if (!dir || !fs.existsSync(dir)) return 0;
  const ws = projectKey(projectId);
  let have;
  try { have = new Set(wsList(ws).map(f => f.path)); } catch { return 0; }
  let moved = 0;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const src = path.join(dir, name);
    try { if (!fs.statSync(src).isFile()) continue; } catch { continue; }
    if (have.has(name)) continue;
    let buf;
    try { buf = fs.readFileSync(src); } catch { continue; }
    if (importBuffer(ws, name, buf).ok) moved++;
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  return moved;
}

function slugOf(chat) {
  const s = String(chat.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return s || 'chat-' + String(chat.id).slice(0, 8);
}

export function adoptChatWorkspace(chat) {
  if (!chat || !chat.project_id) return 0;
  const from = wsKey(chat.id);
  const to = projectKey(chat.project_id);
  if (from === to) return 0;
  let mine;
  try { mine = wsList(from); } catch { return 0; }
  if (!mine.length) { try { wsRemove(from); } catch {} return 0; }
  const taken = new Set(wsList(to).map(f => f.path));
  const slug = slugOf(chat);
  let moved = 0;
  for (const f of mine) {
    const dest = taken.has(f.path) ? `${slug}/${f.path}` : f.path;
    if (taken.has(dest)) continue;
    let buf;
    try { buf = readBuffer(from, f.path); } catch { continue; }
    if (!buf || !importBuffer(to, dest, buf).ok) continue;
    taken.add(dest);
    moved++;
  }
  if (moved === mine.length) { try { wsRemove(from); } catch {} }
  return moved;
}

export function workspaceFor(chat) {
  if (chat && chat.project_id) {
    migrate(chat.project_id);
    adoptChatWorkspace(chat);
  }
  return wsKey(chat);
}

export function workspaceOfProject(projectId) {
  migrate(projectId);
  return projectKey(projectId);
}

export function removeAll(projectId) {
  const dir = legacyDir(projectId);
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}
