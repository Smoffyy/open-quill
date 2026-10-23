const UNREAD_KEY = 'oq-unread';
const MAX_UNREAD = 200;
const ICON = '/brand/icon-192.png';

export function readUnread() {
  try {
    const list = JSON.parse(localStorage.getItem(UNREAD_KEY) || '[]');
    return Array.isArray(list) ? list.filter(id => typeof id === 'string') : [];
  } catch { return []; }
}

export function writeUnread(ids) {
  try { localStorage.setItem(UNREAD_KEY, JSON.stringify(ids)); } catch { }
}

export function addUnread(ids, id) {
  return ids.includes(id) ? ids : [id, ...ids].slice(0, MAX_UNREAD);
}

export function removeUnread(ids, id) {
  return ids.includes(id) ? ids.filter(x => x !== id) : ids;
}

export function shouldNotify({ enabled, permission, hidden, active }) {
  return !!enabled && permission === 'granted' && (hidden || !active);
}

export function titleWithUnread(title, count) {
  return count > 0 ? '(' + count + ') ' + title : title;
}

export function notifySupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notifyPermission() {
  return notifySupported() ? Notification.permission : 'unsupported';
}

export function requestNotifyPermission() {
  return notifySupported() ? Notification.requestPermission() : Promise.resolve('unsupported');
}

export function showNotification(title, body, tag, onClick) {
  try {
    const n = new Notification(title, { body, tag, icon: ICON });
    n.onclick = () => { window.focus(); n.close(); onClick(); };
  } catch { }
}