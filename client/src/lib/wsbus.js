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

const frameEvent = (type) => 'oq-frame-' + type;

export function publishFrame(type, frame) {
  try { window.dispatchEvent(new CustomEvent(frameEvent(type), { detail: frame })); } catch {}
}

export function onFrame(type, fn) {
  const handler = (e) => fn(e.detail);
  window.addEventListener(frameEvent(type), handler);
  return () => window.removeEventListener(frameEvent(type), handler);
}