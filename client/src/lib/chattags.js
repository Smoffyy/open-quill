export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 32;

const sameTag = (a, b) => a.toLowerCase() === b.toLowerCase();

export function hasTag(tags, tag) {
  return (tags || []).some(x => sameTag(x, tag));
}

export function toggleTag(tags, tag) {
  const list = tags || [];
  if (hasTag(list, tag)) return list.filter(x => !sameTag(x, tag));
  const clean = String(tag || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
  if (!clean || list.length >= MAX_TAGS) return list;
  return [...list, clean];
}

export function collectTags(chats) {
  const byKey = new Map();
  for (const c of chats) for (const tag of c.tags || []) {
    const key = tag.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, tag);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}