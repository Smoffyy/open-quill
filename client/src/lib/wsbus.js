let sender = null;

export function setWsSender(fn) {
  sender = typeof fn === 'function' ? fn : null;
}

export function wsSend(obj) {
  return sender ? sender(obj) : false;
}

let presence = [];

export function publishPresence(list) {
  presence = Array.isArray(list) ? list : [];
  try { window.dispatchEvent(new CustomEvent('oq-presence', { detail: presence })); } catch {}
}

export function currentPresence() {
  return presence;
}