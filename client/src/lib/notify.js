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

const DURATION = { info: 3200, success: 3200, warn: 5200, error: 5200 };
const CONTENT = ['text', 'icon', 'kind', 'sticky'];

let seq = 0;
let notices = [];
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(notices); } catch { }
  }
}

function fields(text, opts, prev) {
  const kind = opts.kind || (prev ? prev.kind : 'info');
  const progress = opts.progress !== undefined ? opts.progress : prev ? prev.progress : null;
  return {
    text: text !== undefined ? String(text ?? '') : prev.text,
    icon: opts.icon !== undefined ? opts.icon : prev ? prev.icon : null,
    kind,
    progress,
    sticky: opts.sticky !== undefined ? !!opts.sticky : prev ? prev.sticky : progress != null,
    duration: opts.duration || (prev && !opts.kind ? prev.duration : DURATION[kind] || DURATION.info),
    onClick: opts.onClick !== undefined ? opts.onClick : prev ? prev.onClick : null
  };
}

function change(id, text, opts) {
  const prev = notices.find(n => n.id === id);
  if (!prev) return;
  const next = { ...prev, ...fields(text, opts, prev) };
  if (CONTENT.some(k => next[k] !== prev[k])) next.rev = prev.rev + 1;
  const finished = prev.sticky && !next.sticky;
  notices = finished ? [next, ...notices.filter(n => n.id !== id)] : notices.map(n => (n.id === id ? next : n));
  emit();
}

function handle(id) {
  return {
    id,
    update: ({ text, ...opts } = {}) => change(id, text, opts),
    done: (text, opts = {}) => change(id, text, { icon: 'check', kind: 'success', progress: null, sticky: false, ...opts }),
    fail: (text, opts = {}) => change(id, text, { icon: 'alert', kind: 'error', progress: null, sticky: false, ...opts }),
    dismiss: () => dismissNotice(id)
  };
}

export function notify(text, opts = {}) {
  const prev = opts.key ? notices.find(n => n.key === opts.key) : null;
  if (prev) {
    change(prev.id, text, opts);
    return handle(prev.id);
  }
  const id = ++seq;
  notices = [...notices, { id, key: opts.key || null, rev: 0, ...fields(text, opts, null) }];
  emit();
  return handle(id);
}

export function dismissNotice(idOrKey) {
  const next = notices.filter(n => n.id !== idOrKey && n.key !== idOrKey);
  if (next.length === notices.length) return;
  notices = next;
  emit();
}

export function subscribeNotices(fn) {
  listeners.add(fn);
  fn(notices);
  return () => { listeners.delete(fn); };
}

export function pickNotice(list) {
  const alert = list.find(n => !n.sticky);
  if (alert) return alert;
  const activities = list.filter(n => n.sticky);
  return activities.length ? activities[activities.length - 1] : null;
}