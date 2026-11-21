import { t, tk } from '../../i18n.jsx';

const LABELS = { __proto__: null, owner: tk('Owner'), admin: tk('Admin'), user: tk('User'), pending: tk('Pending') };

export const isBuiltinRole = (role) => !!LABELS[role];

export function roleLabel(role, name = '') {
  return LABELS[role] ? t(LABELS[role]) : (name || role || '');
}