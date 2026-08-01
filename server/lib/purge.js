import { db, tx } from '../db.js';
import * as sandbox from '../sandbox.js';
import { purgeUploads } from './uploads.js';

export function purgeUserChats(userId) {
  const rows = db.chats.byUser(userId);
  if (!rows.length) return 0;
  const chatIds = new Set(rows.map(c => c.id));
  for (const id of chatIds) { try { sandbox.remove(id); } catch {} }
  purgeUploads(chatIds);
  tx(() => {
    for (const id of chatIds) db.messages.removeWhere('chat_id', id);
    db.chats.removeWhere('user_id', userId);
  });
  return chatIds.size;
}
