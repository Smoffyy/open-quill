import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanTools } from '../src/lib/toolproto.js';

test('scanTools does not turn prose into a tool call', () => {
  const r = scanTools('I would call bash here but I will not.');
  assert.equal(r.calls.length, 0);
  assert.equal(r.live, null);
});
