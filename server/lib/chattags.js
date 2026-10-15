export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 32;

export function cleanTags(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const tag = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

export function parseTags(json) {
  if (!json) return [];
  try { return cleanTags(JSON.parse(json)); } catch { return []; }
}