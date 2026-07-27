import * as toolproto from '../toolproto.js';

export function decodeOqr(b64) {
  try { return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); } catch { return null; }
}

export function stripToolSyntax(text) {
  let s = String(text || '');
  const { calls, live } = toolproto.scanTools(s);
  for (let i = calls.length - 1; i >= 0; i--) s = s.slice(0, calls[i].start) + s.slice(calls[i].end);
  if (live && live.start != null) {
    const after = toolproto.scanTools(s).live;
    if (after && after.start != null) {
      const oi = s.indexOf('[[OQR:', after.start);
      s = s.slice(0, after.start) + (oi === -1 ? '' : s.slice(oi));
    }
  }
  return s.replace(/\[\[OQR:[A-Za-z0-9+/=]+\]\]/g, '').replace(/```tool[\s\S]*?```/g, '');
}

export function historyText(text) {
  let s = String(text || '');
  const { calls, live } = toolproto.scanTools(s);
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i].call;
    const ref = c && (c.path || c.cmd || c.query || c.name) || '';
    s = s.slice(0, calls[i].start) + `[${c?.tool || 'tool'}${ref ? ' ' + String(ref).split('\n')[0].slice(0, 80) : ''}]` + s.slice(calls[i].end);
  }
  if (live && live.start != null) {
    const after = toolproto.scanTools(s).live;
    if (after && after.start != null) {
      const oi = s.indexOf('[[OQR:', after.start);
      s = s.slice(0, after.start) + (oi === -1 ? '' : s.slice(oi));
    }
  }
  s = s.replace(/\[\[OQR:([A-Za-z0-9+/=]+)\]\]/g, (_, b) => {
    const d = decodeOqr(b);
    const c = d && d.call;
    if (!c || !c.tool) return '';
    const ref = c.path || c.cmd || c.query || c.name || '';
    const failed = d.result && d.result.ok === false;
    return `[used ${c.tool}${ref ? ': ' + String(ref).split('\n')[0].slice(0, 80) : ''}${failed ? ' → error' : ''}]`;
  });
  return s.replace(/```tool[\s\S]*?```/g, '');
}
