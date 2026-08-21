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
  return s.replace(/\[\[OQR:[A-Za-z0-9+/=]+\]\]/g, '').replace(/\[\[OQT:\d+\]\]/g, '').replace(/```tool[\s\S]*?```/g, '');
}

// Past tool activity is replayed to the model as ONE trailing note, not as a
// marker per call sitting inline in the assistant's own prose.
//
// The per-call form read as text the assistant had written, so a turn with
// thirty calls came back as thirty lines of "(tool already run: create_file
// x.py)" inside its own message. Small models copy what they appear to have
// just written: asked to continue, they emit more of those lines instead of
// calling anything. One summary line has no pattern to extend, and says the
// same thing in a fraction of the context.
export function historyText(text) {
  let s = String(text || '');
  const counts = new Map();
  let failed = 0;
  const note = (tool, isFail) => {
    const name = String(tool || '').trim();
    if (!name) return;
    counts.set(name, (counts.get(name) || 0) + 1);
    if (isFail) failed++;
  };

  const { calls, live } = toolproto.scanTools(s);
  for (let i = calls.length - 1; i >= 0; i--) {
    note(calls[i].call && calls[i].call.tool, false);
    s = s.slice(0, calls[i].start) + s.slice(calls[i].end);
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
    note(c.tool, !!(d.result && d.result.ok === false));
    return '';
  });
  s = s.replace(/\[\[OQT:\d+\]\]/g, '');
  s = s.replace(/```tool[\s\S]*?```/g, '');

  if (!counts.size) return s;
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tool, n]) => (n > 1 ? `${tool} ×${n}` : tool));
  const tail = `[Tools already run in this turn: ${parts.join(', ')}${failed ? `; ${failed} failed` : ''}. Their results are already applied — the workspace listing above is the current truth. Do not describe these calls in text; make new tool calls for anything still to do.]`;
  const body = s.replace(/\n{3,}/g, '\n\n').trim();
  return body ? body + '\n\n' + tail : tail;
}
