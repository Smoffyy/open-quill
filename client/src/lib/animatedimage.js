export const ANIMATION_SNIFF_BYTES = 65536;

function ascii(b, at, n) {
  let s = '';
  for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function animatedPng(b) {
  let at = 8;
  while (at + 8 <= b.length) {
    const len = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
    const type = ascii(b, at + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + len;
  }
  return false;
}

function animatedWebp(b) {
  let at = 12;
  while (at + 8 <= b.length) {
    const type = ascii(b, at, 4);
    const len = (b[at + 4] | (b[at + 5] << 8) | (b[at + 6] << 16) | (b[at + 7] << 24)) >>> 0;
    if (type === 'VP8X') return at + 8 < b.length && (b[at + 8] & 0x02) !== 0;
    if (type === 'ANIM' || type === 'ANMF') return true;
    at += 8 + len + (len & 1);
  }
  return false;
}

export function isAnimatedImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (b.length >= 6 && ascii(b, 0, 4) === 'GIF8') return true;
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return animatedPng(b);
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return animatedWebp(b);
  return false;
}