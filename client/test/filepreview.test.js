import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewKind, uploadFileOf, isVisionImage } from '../src/lib/filepreview.js';

test('previewKind picks a native viewer by extension first, then by mime', () => {
  assert.equal(previewKind('photo.JPG'), 'image');
  assert.equal(previewKind('logo.svg', 'image/svg+xml'), 'image');
  assert.equal(previewKind('clip', 'video/mp4'), 'video');
  assert.equal(previewKind('song.flac'), 'audio');
  assert.equal(previewKind('paper.pdf'), 'pdf');
  assert.equal(previewKind('README.md'), 'markdown');
  assert.equal(previewKind('report.docx'), 'text');
  assert.equal(previewKind('Makefile'), 'text');
});

test('previewKind trusts the extension over a misleading mime', () => {
  assert.equal(previewKind('index.ts', 'video/mp2t'), 'text');
  assert.equal(previewKind('Main.hx', ''), 'text');
  assert.equal(previewKind('scan.heic', 'image/heic'), 'text');
  assert.equal(previewKind('scan.tiff', 'image/tiff'), 'text');
});

test('isVisionImage keeps SVG out of the image-only path', () => {
  assert.equal(isVisionImage('image/png'), true);
  assert.equal(isVisionImage('image/svg+xml'), false);
  assert.equal(isVisionImage('text/plain'), false);
  assert.equal(isVisionImage(''), false);
});

test('uploadFileOf only accepts an /uploads path', () => {
  assert.equal(uploadFileOf('/uploads/abc.pdf'), 'abc.pdf');
  assert.equal(uploadFileOf('/uploads/abc.pdf?x=1'), 'abc.pdf');
  assert.equal(uploadFileOf('https://example.com/uploads/abc.pdf'), '');
  assert.equal(uploadFileOf(null), '');
});
