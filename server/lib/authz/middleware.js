import { can, isOwner } from './effective.js';

export const DENIED = 'You do not have permission to do that.';

export function requirePermission(...permissions) {
  return (req, res, next) => (permissions.every(p => can(req.user, p)) ? next() : res.status(403).json({ error: DENIED }));
}

export function requireAnyPermission(...permissions) {
  return (req, res, next) => (permissions.some(p => can(req.user, p)) ? next() : res.status(403).json({ error: DENIED }));
}

export function requireOwner(req, res, next) {
  if (isOwner(req.user)) return next();
  res.status(403).json({ error: 'Only an owner can change this.' });
}