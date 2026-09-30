import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAnimatedImage } from '../src/lib/animatedimage.js';

const bytes = (...parts) => {
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
};
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const pngChunk = (type, len = 0) => bytes(be32(len), type, new Array(len).fill(0), [0, 0, 0, 0]);
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (...chunks) => bytes(PNG_SIG, ...chunks);
const webp = (...chunks) => bytes('RIFF', le32(4), 'WEBP', ...chunks);

test('an animated PNG is recognised by its acTL chunk before the image data', () => {
  assert.equal(isAnimatedImage(png(pngChunk('IHDR', 13), pngChunk('acTL', 8), pngChunk('IDAT', 4))), true);
});

test('a plain PNG, or one whose acTL only follows the image data, is still', () => {
  assert.equal(isAnimatedImage(png(pngChunk('IHDR', 13), pngChunk('IDAT', 4), pngChunk('IEND'))), false);
  assert.equal(isAnimatedImage(png(pngChunk('IHDR', 13), pngChunk('IDAT', 4), pngChunk('acTL', 8))), false);
});

test('a WebP is animated when its VP8X header sets the animation flag', () => {
  assert.equal(isAnimatedImage(webp('VP8X', le32(10), [0x02], new Array(9).fill(0))), true);
  assert.equal(isAnimatedImage(webp('VP8X', le32(10), [0x10], new Array(9).fill(0))), false);
  assert.equal(isAnimatedImage(webp('VP8 ', le32(2), [0, 0])), false);
});

test('GIFs count as animated and anything else, or nothing, does not', () => {
  assert.equal(isAnimatedImage(bytes('GIF89a', [0, 0])), true);
  assert.equal(isAnimatedImage(bytes([0xff, 0xd8, 0xff, 0xe0])), false);
  assert.equal(isAnimatedImage(new Uint8Array(0)), false);
  assert.equal(isAnimatedImage(null), false);
});

test('a truncated chunk length never throws or loops', () => {
  assert.equal(isAnimatedImage(png(be32(0xffffffff), 'IHDR')), false);
  assert.equal(isAnimatedImage(webp('ANI')), false);
});
