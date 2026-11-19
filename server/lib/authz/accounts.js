import { db, now } from '../../db.js';
import { closeUserSockets, setSocketRole, broadcastToUser } from '../ws/broadcast.js';
import { stopUserTurns } from '../ws/live.js';
import { can, ACTIVE, DISABLED } from './effective.js';

export function endActivity(userId) {
  db.sessions.removeWhere('user_id', userId);
  closeUserSockets(userId);
  stopUserTurns(userId);
}

export function accountChanged(userId) {
  setSocketRole(userId, can(db.users.byId(userId), 'admin.panel'));
  broadcastToUser(userId, { type: 'account' });
}

export function setStatus(user, status) {
  const disabled = status === DISABLED;
  const saved = db.users.update(user.id, disabled ? { status: DISABLED, disabled_at: now() } : { status: ACTIVE, disabled_at: null });
  if (disabled) endActivity(user.id);
  return saved;
}