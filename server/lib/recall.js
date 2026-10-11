import { db } from '../db.js';
import { activePath } from './tree.js';
import { historyText } from './history.js';
import { imageKind, readImageDataUri } from './uploads.js';

const MAX_MATCHES = 5;
const MAX_IMAGES = 2;
const SNIPPET = 600;

function snippet(text, at) {
  if (text.length <= SNIPPET) return text;
  const start = Math.max(0, Math.min(at - Math.floor(SNIPPET / 3), text.length - SNIPPET));
  return (start > 0 ? '…' : '') + text.slice(start, start + SNIPPET) + (start + SNIPPET < text.length ? '…' : '');
}

function searchable(m) {
  const images = (Array.isArray(m.attachments) ? m.attachments : []).filter(a => imageKind(a) === 'vision');
  const notes = images.map(a => `[Image "${a.name || 'image'}"${a.image_detail ? ': ' + a.image_detail : ''}]`);
  const text = [historyText(m.content || '').trim(), ...notes].filter(Boolean).join('\n\n');
  return { text, images };
}

function imagePart(a) {
  const uri = readImageDataUri(a);
  const hit = uri && /^data:([^;,]+);base64,(.*)$/s.exec(uri);
  return hit ? { mime: hit[1], data: hit[2], name: a.name || 'image' } : null;
}

export function runRecall(chatId, call, { vision = false } = {}) {
  const query = String(call.query || '').trim();
  if (!query) return { ok: false, error: 'Empty query.' };
  const chat = db.chats.byId(chatId);
  const upto = chat && chat.summary && chat.summary_upto ? chat.summary_upto : 0;
  if (!upto) return { ok: true, query, count: 0, matches: [], images: [] };
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = [];
  for (const m of activePath(chatId)) {
    if (m.created_at > upto || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const { text, images } = searchable(m);
    const low = text.toLowerCase();
    let hits = 0;
    let first = -1;
    for (const w of words) {
      const i = low.indexOf(w);
      if (i === -1) continue;
      hits++;
      if (first === -1 || i < first) first = i;
    }
    if (hits) found.push({ hits, at: m.created_at, role: m.role, text: snippet(text, first), images });
  }
  found.sort((a, b) => b.hits - a.hits || a.at - b.at);
  const top = found.slice(0, MAX_MATCHES);
  const images = vision ? top.flatMap(f => f.images).slice(0, MAX_IMAGES).map(imagePart).filter(Boolean) : [];
  const matches = top.map(f => ({ role: f.role, date: new Date(f.at).toISOString().slice(0, 10), text: f.text }));
  return { ok: true, query, count: found.length, matches, images };
}

export function formatRecallResult(call, r) {
  if (!r.ok) return `recall → ERROR: ${r.error}`;
  if (!r.count) return `recall "${call.query}" → no earlier messages match.`;
  const shown = r.images.length ? `\n\nThe image${r.images.length > 1 ? 's' : ''} ${r.images.map(i => `"${i.name}"`).join(' and ')} from these messages follow${r.images.length > 1 ? '' : 's'} at full quality.` : '';
  return `recall "${call.query}" → ${r.count} match(es)\n` + r.matches.map(m => `[${m.role}, ${m.date}] ${m.text}`).join('\n\n') + shown;
}

export function recallPayload(r) {
  return r.ok ? { ok: true, count: r.count } : { ok: false, error: r.error };
}