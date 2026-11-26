export const CHAT_DRAG = 'application/x-oq-chat';
export const FOLDER_DRAG = 'application/x-oq-folder';

export function chatsByFolder(chats, folders) {
  const known = new Set(folders.map(f => f.id));
  const byId = new Map(folders.map(f => [f.id, []]));
  const loose = [];
  for (const c of chats) {
    if (c.folderId && known.has(c.folderId) && c.mode !== 'code') byId.get(c.folderId).push(c);
    else loose.push(c);
  }
  return { byId, loose };
}

export function moveId(ids, dragId, targetId, after) {
  if (dragId === targetId || !ids.includes(dragId) || !ids.includes(targetId)) return ids;
  const rest = ids.filter(id => id !== dragId);
  const at = rest.indexOf(targetId) + (after ? 1 : 0);
  return [...rest.slice(0, at), dragId, ...rest.slice(at)];
}

export function dropPosition(rect, y) {
  return y > rect.top + rect.height / 2 ? 'after' : 'before';
}

export function dragKind(types) {
  const list = Array.from(types || []);
  if (list.includes(CHAT_DRAG)) return 'chat';
  if (list.includes(FOLDER_DRAG)) return 'folder';
  return null;
}