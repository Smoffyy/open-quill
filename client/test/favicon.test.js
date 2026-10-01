import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faviconFor } from '../src/lib/favicon.js';
import { BRAND_FAVICON_DARK, BRAND_FAVICON_LIGHT } from '../src/lib/brand.js';

test('the favicon follows the light theme and every dark palette', () => {
  assert.equal(faviconFor('light', ''), BRAND_FAVICON_LIGHT);
  for (const theme of ['anthropic', 'openai', 'dark', null, undefined]) {
    assert.equal(faviconFor(theme, ''), BRAND_FAVICON_DARK, String(theme));
  }
});

test('an icon uploaded in the admin panel wins in both themes', () => {
  assert.equal(faviconFor('light', '/uploads/logo.png'), '/uploads/logo.png');
  assert.equal(faviconFor('anthropic', '/uploads/logo.png'), '/uploads/logo.png');
});