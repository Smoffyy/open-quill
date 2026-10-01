import { db } from '../../db.js';
import { clients, broadcastAdmins } from './broadcast.js';

const text = (v, cap) => (typeof v === 'string' ? v.slice(0, cap) : '');

export function presenceList() {
  const latest = new Map();
  for (const st of clients.values()) {
    if (!st.isAdmin || !st.presence) continue;
    const prev = latest.get(st.userId);
    if (!prev || prev.at < st.presence.at) latest.set(st.userId, st.presence);
  }
  const out = [];
  for (const [id, p] of latest) {
    const u = db.users.byId(id);
    if (!u) continue;
    out.push({ id, name: u.display_name || String(u.email || '').split('@')[0], section: p.section, target: p.target, field: p.field });
  }
  return out;
}

export function broadcastPresence() {
  broadcastAdmins({ type: 'presence', admins: presenceList() });
}

export function setPresence(state, raw) {
  if (!state?.isAdmin) return;
  const next = raw && typeof raw === 'object' && typeof raw.section === 'string' && raw.section
    ? { section: text(raw.section, 40), target: text(raw.target, 80), field: text(raw.field, 60), at: Date.now() }
    : null;
  const cur = state.presence;
  if (!cur && !next) return;
  if (cur && next && cur.section === next.section && cur.target === next.target && cur.field === next.field) return;
  state.presence = next;
  broadcastPresence();
}
