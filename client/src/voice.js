let active = false;
const subs = new Set();

export function setVoiceActive(v) { active = !!v; }
export function voiceEmit(e) { if (!active) return; subs.forEach(fn => { try { fn(e); } catch {} }); }
export function voiceSubscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

export async function transcribeBlob(blob, name = 'audio.webm') {
  const fd = new FormData();
  fd.append('audio', blob, name);
  const res = await fetch('/api/voice/transcribe', { method: 'POST', body: fd, credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Transcription failed.');
  const d = await res.json();
  return String(d.text || '').trim();
}

export async function fetchSpeech(text) {
  const res = await fetch('/api/voice/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    credentials: 'same-origin'
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Speech synthesis failed.');
  return res.blob();
}

export function cleanForSpeech(text) {
  let t = String(text || '');
  t = t.replace(/\[\[OQR:[\s\S]*?\]\]/g, ' ');
  t = t.replace(/```[\s\S]*?```/g, ' Code block omitted. ');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
  t = t.replace(/(\*|_)(.*?)\1/g, '$2');
  t = t.replace(/^\s*[-*+]\s+/gm, '');
  t = t.replace(/^\s*\|.*\|\s*$/gm, ' ');
  t = t.replace(/^\s*>\s?/gm, '');
  t = t.replace(/[ \t]+/g, ' ');
  return t;
}

export function extractSentences(buffer) {
  const sentences = [];
  let rest = String(buffer || '');
  for (;;) {
    const m = rest.match(/[.!?…]+["')\]]*(\s|\n)/);
    if (!m) {
      const nl = rest.indexOf('\n\n');
      if (nl === -1) break;
      const chunk = rest.slice(0, nl).trim();
      if (chunk) sentences.push(chunk);
      rest = rest.slice(nl + 2);
      continue;
    }
    const idx = m.index + m[0].length;
    const sent = rest.slice(0, idx).trim();
    if (sent) sentences.push(sent);
    rest = rest.slice(idx);
  }
  return { sentences, rest };
}
