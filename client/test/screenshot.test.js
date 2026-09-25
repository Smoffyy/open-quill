import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a cancelled screen capture is not treated as a failure', async () => {
  const { isCaptureCancel } = await import('../src/lib/screenshot.js');
  for (const name of ['NotAllowedError', 'AbortError', 'NotFoundError']) {
    assert.equal(isCaptureCancel({ name }), true, name);
  }
  for (const name of ['NotReadableError', 'TypeError', 'anything']) {
    assert.equal(isCaptureCancel({ name }), false, name);
  }
  assert.equal(isCaptureCancel(null), false);
  assert.equal(isCaptureCancel(undefined), false);
});

test('a screenshot file name is timestamped and png', async () => {
  const { screenshotName } = await import('../src/lib/screenshot.js');
  const name = screenshotName(new Date(2026, 8, 22, 9, 5, 3));
  assert.equal(name, 'screenshot-20260922-090503.png');
});
