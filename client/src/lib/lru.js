// A bounded most-recently-used map. The chat cache is the reason it exists: it
// holds the last few opened conversations so switching back to one paints from
// memory instead of a blank thread, and it must not grow without limit in a
// session that touches hundreds of chats.
//
// Insertion order is the recency order, which is what makes eviction a single
// delete of the oldest key. Re-setting a key deletes and re-adds it so it counts
// as freshly used.
export function createLru(limit = 25) {
  const map = new Map();
  const touch = (key, value) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > limit) map.delete(map.keys().next().value);
  };
  return {
    get: (key) => map.get(key),
    has: (key) => map.has(key),
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    get size() { return map.size; },
    keys: () => [...map.keys()],
    set(key, value) {
      if (key == null || key === '') return;
      touch(key, value);
    },
    // Chats arrive in pieces: the row first, then the messages, then the files.
    // Merging rather than replacing is what lets each land as it comes without
    // the later one wiping the earlier.
    merge(key, patch) {
      if (key == null || key === '') return;
      touch(key, { ...(map.get(key) || {}), ...patch });
    }
  };
}
