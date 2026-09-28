const OQR_RE = /\[\[OQR:([A-Za-z0-9+/=]+)\]\]/g;

export function b64decode(b64) {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch { return ''; }
}

export function oqrRecords(content) {
  const out = [];
  for (const m of String(content || '').matchAll(OQR_RE)) {
    try {
      const r = JSON.parse(b64decode(m[1]));
      if (r && r.call && r.call.tool) out.push(r);
    } catch {}
  }
  return out;
}
