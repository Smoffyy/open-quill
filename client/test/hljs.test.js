import { test } from 'node:test';
import assert from 'node:assert/strict';

test('highlighting is identical with the cache bypassed, so the streaming path cannot change output', async () => {
  const { ensureCommon, highlight } = await import('../src/lib/hljs.js');
  const hl = await ensureCommon();
  assert.ok(hl, 'highlight.js common bundle loaded');
  const code = 'function add(a, b) {\n  return a + b;\n}\n';
  const viaCache = highlight(code, 'javascript');
  const viaBypass = highlight(code, 'javascript', { cache: false });
  assert.equal(viaBypass, viaCache);
  assert.match(viaCache, /<span class="hljs-/, 'really highlighted, not escaped plain text');
  let prev = '';
  for (const n of [10, 20, 30]) {
    const partial = code.slice(0, n);
    const out = highlight(partial, 'javascript', { cache: false });
    assert.notEqual(out, prev);
    assert.equal(out, highlight(partial, 'javascript', { cache: false }));
    prev = out;
  }
});
