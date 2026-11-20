import { db, tx } from '../db.js';
import * as sandbox from '../sandbox.js';
import { attachmentUrlsOf, purgeUnreferencedUploads } from './uploads.js';
import { removeAll as removeProjectFiles } from './projectfiles.js';
import { removeArtifacts } from './artifacts.js';
import { forgetChats } from './quality.js';
import { killSessionSockets } from './ws/broadcast.js';
import { stopTurn } from './ws/live.js';

export function purgeUserChats(userId) {
  const rows = db.chats.byUser(userId);
  if (!rows.length) return 0;
  const chatIds = new Set(rows.map(c => c.id));
  for (const c of rows) {
    stopTurn(c.id);
    if (!c.project_id) { try { sandbox.remove(c.id); } catch {} }
    removeArtifacts(c.id);
  }
  const urls = attachmentUrlsOf(chatIds);
  tx(() => {
    for (const id of chatIds) db.messages.removeWhere('chat_id', id);
    db.chats.removeWhere('user_id', userId);
  });
  forgetChats(chatIds);
  purgeUnreferencedUploads(urls);
  db.acl.prune();
  return chatIds.size;
}

export function purgeUser(userId) {
  purgeUserChats(userId);
  for (const p of db.projects.byUser(userId)) {
    try { removeProjectFiles(p.id); } catch {}
    try { sandbox.remove(sandbox.projectKey(p.id)); } catch {}
    for (const c of db.chats.byProject(p.id)) {
      if (c.project_id === p.id) db.chats.update(c.id, { project_id: null });
      else if (c.origin_project_id === p.id) db.chats.update(c.id, { origin_project_id: null });
    }
  }
  tx(() => {
    db.projects.removeWhere('user_id', userId);
    db.skills.removeWhere('user_id', userId);
    db.tasks.removeWhere('user_id', userId);
    db.folders.removeWhere('user_id', userId);
  });
  purgeUnreferencedUploads(new Set(db.uploads.where('user_id', userId).map(u => '/uploads/' + u.file)));
  db.groupMembers.dropMember('user', userId);
  const sessions = db.sessions.byUser(userId);
  db.sessions.removeWhere('user_id', userId);
  for (const s of sessions) killSessionSockets(s.id);
  db.users.removeById(userId);
  db.acl.prune();
}