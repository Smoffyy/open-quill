import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sanitizeKwargs, kwargDefs, applyKwargs, resolveKwargValues, kwargPayload,
  oneShotKwargPayload, controlOf, defaultValueOf, isBoolPair, coerceKwargValue,
  isRange, clampToRange, normalizeKwarg, gateOpen, kwargVisible
} from '../lib/kwargs.js';
import { parseTextToolCalls, parseArgs, toCall, cutOffOf } from '../tools/index.js';
import { classifyToolError } from '../lib/toolstats.js';
import { sanitizeDocsConfig, readDocsConfig, sanitizePairs, sanitizeCards, sanitizeStrList, DOCS_DEFAULTS } from '../lib/modeldocs.js';
import { parseSkillFile, buildSkillFile, normalizeName, validate } from '../lib/skillfile.js';
import { cutOffError } from '../lib/prompts.js';
import { makeToolTextFilter, makeEmitter } from '../llm/emitter.js';
import { trimInTurn, compactThreshold, estimateTokens, textTokens, makeTokenCounter, truncateForRollingCtx, FALLBACK_CTX } from '../lib/convo.js';
import { scanTools } from '../toolproto.js';
import { isContextOverflowError } from '../lib/llamacpp.js';
import { sanitizeDoc, blankLayoutDoc, normalizeStoreForTest, docDiffCount } from '../lib/theme.js';
import { winTranslate } from '../sandbox.js';
import { screenCommand, normalizeRel, compileSearchPattern } from '../lib/sandboxguard.js';
import { resolveToolName, makeToolResolver, nearestTool, SANDBOX_TOOLS } from '../tools/aliases.js';
import { isPrivateAddress, hostAllowed } from '../lib/egress.js';
import { resolveRouted, ruleMatches, routerRules, modelLabel } from '../lib/router.js';
import { preferredChild } from '../lib/tree.js';
import { looksTextual, isZipOfficeDoc } from '../lib/extract.js';
import { releaseCandidates, parseManifest } from '../lib/release.js';
import { remapBrandPath } from '../lib/brand.js';
import { samplingParams, parseStop } from '../llm/sampling.js';
import { PROVIDER_TYPES, isProviderType, providerSpec } from '../providers.js';
import { slideWithCounter, trimMode } from '../lib/ctxwindow.js';
import { sameOrigin, sameOriginGuard, requestHost } from '../lib/origin.js';
import { SETTING_FIELDS, coerceSetting } from '../routes/settings.js';
import { isText } from '../sandbox/ignore.js';
import { announcedMoreWork } from '../lib/continuation.js';
import { openFence, seamFor, steerInstruction } from '../lib/steer.js';
import { createLoopGuard } from '../lib/loopguard.js';
import { stops, beginTurn, endTurn } from '../lib/ws/live.js';
import { historyText } from '../lib/history.js';
import { bash } from '../sandbox/shell.js';
import { wireToolCalls, normalizeMessages } from '../llm/wire.js';
import { unzipBuffer, zipBuffer } from '../sandbox/zip.js';
import * as sandboxFiles from '../sandbox/files.js';
import { mcpToolName, MCP_NAME_MAX } from '../mcp.js';
import { normalizeSchedule, nextRun, isDue } from '../lib/tasks.js';

const asReq = (headers = {}, method = 'POST', localAddress = '10.0.0.5') =>
  ({ method, headers, socket: { localAddress } });

test('origin: Sec-Fetch-Site is believed over anything Host says', () => {
  // The browser computes this against the real document origin, before any proxy exists,
  // and it is forwarded untouched. Comparing Origin to Host instead is what refused every
  // write behind Vite's dev proxy, which rewrites Host but not Origin.
  const proxied = { host: 'localhost:3001', origin: 'http://localhost:5173' };
  assert.equal(sameOrigin(asReq({ ...proxied, 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(sameOrigin(asReq({ ...proxied, 'sec-fetch-site': 'same-site' })), true);
  assert.equal(sameOrigin(asReq({ ...proxied, 'sec-fetch-site': 'none' })), true, 'typed URL or bookmark');
  assert.equal(sameOrigin(asReq({ ...proxied, 'sec-fetch-site': 'cross-site' })), false);
  // and it still wins when Origin and Host happen to agree
  assert.equal(sameOrigin(asReq({ host: 'quill.local', origin: 'http://quill.local', 'sec-fetch-site': 'cross-site' })), false);
});

test('origin: a request from another site is not the same origin', () => {
  const host = { host: 'quill.local:3001' };
  assert.equal(sameOrigin(asReq({ ...host, origin: 'http://quill.local:3001' })), true);
  assert.equal(sameOrigin(asReq({ ...host, origin: 'https://quill.local:3001' })), true, 'scheme alone does not make it cross-site');
  assert.equal(sameOrigin(asReq({ ...host, origin: 'http://evil.example' })), false);
  assert.equal(sameOrigin(asReq({ ...host, origin: 'http://quill.local:3002' })), false, 'a different port is a different origin');
  assert.equal(sameOrigin(asReq({ ...host, origin: 'http://quill.local.evil.example' })), false, 'suffix tricks do not pass');
});

test('origin: a missing Origin is allowed but a null one is not', () => {
  const host = { host: 'quill.local:3001' };
  // curl and the CI probe send no Origin at all and cannot be driven by a hostile page.
  assert.equal(sameOrigin(asReq(host)), true);
  assert.equal(sameOrigin(asReq({ ...host, origin: '' })), true);
  // A sandboxed iframe or data: document sends the literal string "null".
  assert.equal(sameOrigin(asReq({ ...host, origin: 'null' })), false);
  assert.equal(sameOrigin(asReq({ ...host, origin: 'file://' })), false);
  assert.equal(sameOrigin(asReq({ ...host, origin: 'not a url' })), false);
  assert.equal(sameOrigin(asReq({ origin: 'http://quill.local' })), false, 'no Host to compare against');
});

test('origin: loopback to loopback survives a dev proxy without Sec-Fetch-Site', () => {
  // Safari below 16.4 sends no Sec-Fetch-Site, and Vite still rewrites Host, so the dev
  // setup has to fall through to this. The carve-out reaches only servers already running
  // on this machine.
  const devProxied = { host: 'localhost:3001', origin: 'http://localhost:5173' };
  assert.equal(sameOrigin(asReq(devProxied, 'POST', '127.0.0.1')), true);
  assert.equal(sameOrigin(asReq({ ...devProxied, origin: 'http://127.0.0.1:5173' }, 'POST', '::1')), true);
  // but never to a public page, and never when we are not the one on loopback
  assert.equal(sameOrigin(asReq({ ...devProxied, origin: 'http://evil.example' }, 'POST', '127.0.0.1')), false);
  assert.equal(sameOrigin(asReq(devProxied, 'POST', '10.0.0.5')), false);
  assert.equal(sameOrigin(asReq({ ...devProxied, origin: 'http://localhost.evil.example' }, 'POST', '127.0.0.1')), false);
});

test('origin: the guard lets safe methods through and refuses forged writes', () => {
  const run = (req) => {
    let status = 0, body = null, passed = false;
    const res = { status(c) { status = c; return this; }, json(b) { body = b; } };
    sameOriginGuard(req, res, () => { passed = true; });
    return { status, body, passed };
  };
  const evil = { host: 'quill.local', origin: 'http://evil.example' };
  assert.equal(run(asReq(evil, 'GET')).passed, true, 'reads are not state-changing');
  assert.equal(run(asReq(evil, 'HEAD')).passed, true);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = run(asReq(evil, method));
    assert.equal(r.passed, false, `${method} must not reach the route`);
    assert.equal(r.status, 403);
  }
  assert.equal(run(asReq({ host: 'quill.local', origin: 'http://quill.local' }, 'POST')).passed, true);
});

test('origin: x-forwarded-host is what a proxy rewrites the host to', () => {
  assert.equal(requestHost(asReq({ host: 'internal:3001', 'x-forwarded-host': 'quill.example' })), 'quill.example');
  assert.equal(requestHost(asReq({ host: 'Quill.Local:3001' })), 'quill.local:3001');
  assert.equal(sameOrigin(asReq({ host: 'internal:3001', 'x-forwarded-host': 'quill.example', origin: 'https://quill.example' })), true);
});

test('every configurable environment variable is documented', () => {
  // .env.example is both the documentation and the template written into .env on a fresh
  // install. That template used to be a second copy inline in dataroot.js, and the two
  // drifted the first time an option was added, so a new install got a config file missing
  // the newest setting. There is one copy now; this keeps it complete.
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const example = fs.readFileSync(path.join(path.dirname(root), '.env.example'), 'utf8');

  // Read from the environment rather than configured by the operator.
  const AMBIENT = new Set(['PATH', 'Path', 'PATHEXT', 'ComSpec', 'NODE_ENV', 'DB_NAME']);
  const found = new Set();
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === 'data' || ent.name === 'test') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.name.endsWith('.js')) continue;
      for (const m of fs.readFileSync(full, 'utf8').matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) found.add(m[1]);
    }
  };
  walk(root);

  const undocumented = [...found].filter(v => !AMBIENT.has(v) && !new RegExp(`^#?\\s*${v}=`, 'm').test(example));
  assert.deepEqual(undocumented, [], `add these to .env.example: ${undocumented.join(', ')}`);
});

test('providers: an inherited property is not a provider type', () => {
  // PROVIDER_TYPES is indexed by a value straight off the wire.
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '']) {
    assert.equal(isProviderType(key), false, `${key} must not resolve`);
  }
  assert.equal(isProviderType('llamacpp'), true);
  assert.equal(isProviderType(null), false);
  // and a row carrying one still falls back to a real spec rather than throwing
  assert.equal(providerSpec({ type: 'constructor', base_url: 'http://x:1' }).spec, PROVIDER_TYPES.llamacpp);
});

test('tools: an inherited property is not a tool alias', () => {
  for (const key of ['constructor', '__proto__', 'toString', 'valueOf']) {
    assert.equal(resolveToolName(key, true), null, `${key} must not resolve to a tool`);
  }
  assert.equal(resolveToolName('write_file'), 'create_file', 'real aliases still resolve');
});

test('kwargs: legacy effort fields migrate', () => {
  const m = { effort_enabled: 1, effort_levels: ['false', 'true'], effort_default: 'false', effort_kwarg: 'enable_thinking' };
  const defs = kwargDefs(m);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].id, 'effort');
  assert.equal(defs[0].name, 'enable_thinking');
  assert.equal(applyKwargs(m, {}, false).resolved_kwargs.chat_template_kwargs.enable_thinking, false);
  assert.equal(applyKwargs(m, { effort: 'true' }, false).resolved_kwargs.chat_template_kwargs.enable_thinking, true);
});

test('kwargs: a min and a max make a range, and the range owns the value list', () => {
  const d = normalizeKwarg({ id: 'b', name: 'reasoning_budget', min: 0, max: 4096, step: 128, values: ['1', '2'], default: '512' });
  assert.equal(isRange(d), true);
  assert.equal(controlOf(d), 'range');
  assert.deepEqual(d.values, [], 'an enumerated list alongside a range would be a second source of truth');
  assert.equal(d.default, '512');
  assert.equal(d.step, 128);

  const plain = normalizeKwarg({ id: 'p', name: 'x', values: ['low', 'high'] });
  assert.equal(isRange(plain), false);
  assert.equal(plain.min, null);
  assert.equal(plain.max, null);
});

test('kwargs: a range with no usable bounds falls back to a value list', () => {
  for (const bad of [{ min: 5, max: 5 }, { min: 10, max: 2 }, { min: 0 }, { max: 10 }, { min: 'a', max: 'b' }]) {
    const d = normalizeKwarg({ id: 'k', name: 'x', values: ['low', 'high'], ...bad });
    assert.equal(isRange(d), false, JSON.stringify(bad));
    assert.deepEqual(d.values, ['low', 'high'], 'the list survives when the range is unusable');
  }
});

test('kwargs: a range value is clamped and snapped to the step', () => {
  const d = normalizeKwarg({ id: 'b', name: 'budget', min: 0, max: 1000, step: 100 });
  assert.equal(clampToRange(d, 250), 300);
  assert.equal(clampToRange(d, -50), 0, 'below the minimum clamps up');
  assert.equal(clampToRange(d, 99999), 1000, 'above the maximum clamps down');
  assert.equal(clampToRange(d, 'nonsense'), null);

  const off = normalizeKwarg({ id: 'o', name: 'x', min: 5, max: 100, step: 10 });
  assert.equal(clampToRange(off, 6), 5, 'steps are measured from the minimum, not from zero');
  assert.equal(clampToRange(off, 100), 100, 'the maximum stays reachable when it is off the step grid');

  // Snapping alone would round 2048 down to 2000, so the value under the slider
  // could never reach the maximum printed at the end of its own track.
  const odd = normalizeKwarg({ id: 'x', name: 'x', min: 0, max: 2048, step: 100 });
  assert.equal(clampToRange(odd, 2048), 2048);
  assert.equal(clampToRange(odd, 99999), 2048);
  assert.equal(clampToRange(odd, 2000), 2000);
  assert.equal(clampToRange(odd, 1250), 1300, 'everything between the ends still snaps');

  const frac = normalizeKwarg({ id: 'f', name: 'temp', min: 0, max: 2, step: 0.1 });
  assert.equal(clampToRange(frac, 0.30000000000000004), 0.3, 'float dust is rounded away');
});

test('kwargs: a hand-edited request cannot escape the range the admin set', () => {
  const m = { kwargs: [{ id: 'b', name: 'reasoning_budget', target: 'extra_body', type: 'number', min: 0, max: 2048, step: 256, default: '512' }] };
  const body = (req) => applyKwargs(m, req, false).resolved_kwargs.extra_body.reasoning_budget;
  assert.equal(body({}), 512, 'the default is used when nothing is asked for');
  assert.equal(body({ b: '1024' }), 1024);
  assert.equal(body({ b: '999999' }), 2048, 'over the maximum is clamped to the maximum, not rejected');
  assert.equal(body({ b: '-5' }), 0);
  assert.equal(body({ b: '600' }), 512, 'snapped to the nearest step');
  assert.equal(body({ b: 'drop table' }), 512, 'junk falls back to the default');
  assert.equal(typeof body({ b: '1024' }), 'number', 'it lands in extra_body as a number');
});

test('kwargs: a hidden range still sends its default, and an admin-only one ignores the user', () => {
  const hidden = { kwargs: [{ id: 'b', name: 'budget', min: 0, max: 100, step: 10, default: '40', visible: false }] };
  assert.equal(applyKwargs(hidden, { b: '90' }, false).resolved_kwargs.chat_template_kwargs.budget, 40);

  const silent = { kwargs: [{ id: 'b', name: 'budget', min: 0, max: 100, default: '40', visible: false, sendWhenHidden: false }] };
  assert.deepEqual(applyKwargs(silent, {}, false).resolved_kwargs, {}, 'hidden and not sent means nothing goes out');

  const adminOnly = { kwargs: [{ id: 'b', name: 'budget', min: 0, max: 100, step: 10, default: '40', adminOnly: true }] };
  assert.equal(applyKwargs(adminOnly, { b: '90' }, false).resolved_kwargs.chat_template_kwargs.budget, 40);
  assert.equal(applyKwargs(adminOnly, { b: '90' }, true).resolved_kwargs.chat_template_kwargs.budget, 90);
});

test('kwargs: a range default outside its own bounds is corrected on save', () => {
  const d = normalizeKwarg({ id: 'b', name: 'x', min: 10, max: 20, step: 1, default: '999' });
  assert.equal(d.default, '20');
  const none = normalizeKwarg({ id: 'b', name: 'x', min: 10, max: 20, step: 1, default: '' });
  assert.equal(defaultValueOf(none), '10', 'no default starts at the minimum');
});

test('kwargs: a gated kwarg keeps its own value but hides until the gate opens', () => {
  const kwargs = [
    { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
    { id: 'budget', name: 'thinking_budget_tokens', target: 'body', type: 'number',
      min: 1024, max: 8192, step: 1024, default: '1024', showIf: { id: 'think', value: 'true' } }
  ];
  const defs = sanitizeKwargs(kwargs);

  const off = resolveKwargValues(defs, {}, false);
  assert.equal(gateOpen(defs, off, defs[1]), false);
  assert.equal(kwargVisible(defs, off, defs[1]), false);
  assert.equal(off.budget, '1024', 'the value survives while hidden, it is only the control that goes');

  const on = resolveKwargValues(defs, { think: 'true', budget: '4096' }, false);
  assert.equal(gateOpen(defs, on, defs[1]), true);
  assert.equal(kwargVisible(defs, on, defs[1]), true);
  assert.equal(kwargPayload(defs, on).thinking_budget_tokens, 4096);
});

test('kwargs: a closed gate is a kind of hidden, so sendWhenHidden decides', () => {
  const mk = (send) => sanitizeKwargs([
    { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
    { id: 'budget', name: 'thinking_budget_tokens', target: 'body', type: 'number',
      min: 1024, max: 8192, step: 1024, default: '1024', sendWhenHidden: send,
      showIf: { id: 'think', value: 'true' } }
  ]);

  const kept = mk(true);
  assert.equal(kwargPayload(kept, resolveKwargValues(kept, {}, false)).thinking_budget_tokens, 1024);

  const dropped = mk(false);
  const shut = kwargPayload(dropped, resolveKwargValues(dropped, {}, false));
  assert.equal('thinking_budget_tokens' in shut, false, 'gate shut and set not to send means it is left out');
  const open = kwargPayload(dropped, resolveKwargValues(dropped, { think: 'true' }, false));
  assert.equal(open.thinking_budget_tokens, 1024, 'and it comes back when the gate opens');
});

test('kwargs: a gate pointing at itself or at nothing is dropped', () => {
  const defs = sanitizeKwargs([
    { id: 'a', name: 'a', values: ['1', '2'], showIf: { id: 'a', value: '1' } },
    { id: 'b', name: 'b', values: ['1', '2'], showIf: { id: 'ghost', value: '1' } },
    { id: 'c', name: 'c', values: ['1', '2'], showIf: { id: 'a', value: '2' } }
  ]);
  assert.equal(defs[0].showIf, null, 'self-reference');
  assert.equal(defs[1].showIf, null, 'unknown id');
  assert.deepEqual(defs[2].showIf, { id: 'a', value: '2' }, 'a real reference survives');
});

test('kwargs: an ungated kwarg is always visible', () => {
  const defs = sanitizeKwargs([{ id: 'a', name: 'a', values: ['1', '2'] }]);
  assert.equal(gateOpen(defs, {}, defs[0]), true);
  assert.equal(kwargVisible(defs, {}, defs[0]), true);
});

test('kwargs: paired child sends only on match', () => {
  const m = { kwargs: [
    { id: 'think', name: 'enable_thinking', values: ['false', 'true'], default: 'false' },
    { id: 'pres', name: 'preserve_thinking', values: ['false', 'true'], visible: false, parentId: 'think',
      rules: [{ when: 'true', value: 'true', send: true }, { when: 'false', value: 'false', send: false }] }
  ] };
  const off = applyKwargs(m, {}, false).resolved_kwargs.chat_template_kwargs;
  assert.equal(off.enable_thinking, false);
  assert.equal('preserve_thinking' in off, false);
  const on = applyKwargs(m, { think: 'true' }, false).resolved_kwargs.chat_template_kwargs;
  assert.equal(on.preserve_thinking, true);
});

test('kwargs: multi-level chains resolve', () => {
  const m = { kwargs: [
    { id: 'a', name: 'a', values: ['false', 'true'], default: 'false' },
    { id: 'b', name: 'b', values: ['false', 'true'], visible: false, parentId: 'a', rules: [{ when: 'true', value: 'true', send: true }] },
    { id: 'c', name: 'c', values: ['0', '1'], visible: false, parentId: 'b', rules: [{ when: 'true', value: '1', send: true }] }
  ] };
  const on = applyKwargs(m, { a: 'true' }, false).resolved_kwargs.chat_template_kwargs;
  assert.deepEqual(on, { a: true, b: true, c: 1 });
  const off = applyKwargs(m, {}, false).resolved_kwargs.chat_template_kwargs;
  assert.deepEqual(off, { a: false });
});

test('kwargs: adminOnly locks non-admins to the default', () => {
  const m = { kwargs: [{ id: 'e', name: 'reasoning_effort', values: ['low', 'medium', 'high'], default: 'medium', adminOnly: true }] };
  assert.equal(applyKwargs(m, { e: 'high' }, false).resolved_kwargs.chat_template_kwargs.reasoning_effort, 'medium');
  assert.equal(applyKwargs(m, { e: 'high' }, true).resolved_kwargs.chat_template_kwargs.reasoning_effort, 'high');
});

test('kwargs: reserved body keys are never injected', () => {
  const m = { kwargs: [{ id: 'x', name: 'messages', values: ['boom'], visible: false, target: 'body' }] };
  assert.deepEqual(applyKwargs(m, {}, true).resolved_kwargs, {});
});

test('kwargs: body target and typing', () => {
  const m = { kwargs: [{ id: 't', name: 'top_k', values: ['40'], visible: false, target: 'body', type: 'number' }] };
  assert.equal(applyKwargs(m, {}, true).resolved_kwargs.top_k, 40);
});

test('kwargs: one-shot uses the cheapest value', () => {
  const m = { kwargs: [{ id: 'e', name: 'reasoning_effort', values: ['low', 'medium', 'high'], default: 'high' }] };
  assert.equal(oneShotKwargPayload(m).chat_template_kwargs.reasoning_effort, 'low');
});

function hasCycle(defs) {
  const byId = new Map(defs.map(d => [d.id, d]));
  for (const start of defs) {
    const seen = new Set([start.id]);
    let cur = start;
    while (cur && cur.parentId) {
      if (seen.has(cur.parentId)) return true;
      seen.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
  }
  return false;
}

test('kwargs: cycles broken and duplicate ids made unique', () => {
  const two = sanitizeKwargs([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }]);
  assert.equal(hasCycle(two), false);
  const three = sanitizeKwargs([{ id: 'a', parentId: 'c' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }]);
  assert.equal(hasCycle(three), false);
  const selfRef = sanitizeKwargs([{ id: 'a', parentId: 'a' }]);
  assert.equal(selfRef[0].parentId, '');
  const missing = sanitizeKwargs([{ id: 'a', parentId: 'ghost' }]);
  assert.equal(missing[0].parentId, '');
  assert.deepEqual(sanitizeKwargs([{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }]).map(d => d.id), ['a', 'a-2']);
});

test('kwargs: resolution terminates on a broken cycle', () => {
  const defs = sanitizeKwargs([
    { id: 'a', name: 'a', values: ['false', 'true'], parentId: 'b', rules: [{ when: 'true', value: 'true', send: true }] },
    { id: 'b', name: 'b', values: ['false', 'true'], parentId: 'a', rules: [{ when: 'true', value: 'true', send: true }] }
  ]);
  const values = resolveKwargValues(defs, {}, true);
  assert.equal(Object.keys(values).length, 2);
  assert.doesNotThrow(() => kwargPayload(defs, values));
});

test('kwargs: control inference and coercion', () => {
  assert.equal(controlOf({ values: ['false', 'true'], control: 'auto' }), 'toggle');
  assert.equal(controlOf({ values: ['low', 'mid', 'high'], control: 'auto' }), 'slider');
  assert.equal(isBoolPair(['true', 'false']), true);
  assert.equal(defaultValueOf({ values: ['false', 'true'], default: '' }), 'false');
  assert.equal(coerceKwargValue('true', 'auto'), true);
  assert.equal(coerceKwargValue('12', 'auto'), 12);
  assert.equal(coerceKwargValue('12', 'string'), '12');
});

test('kwargs: no defs means nothing is sent', () => {
  assert.deepEqual(applyKwargs({}, { anything: 'x' }, true).resolved_kwargs, {});
});

const allow = (n) => ['make_dir', 'create_file', 'bash'].includes(n);

test('text tool calls: qwen xml wrapped', () => {
  const calls = parseTextToolCalls('\n<function=make_dir>\n<parameter=path>\nsrc/main\n</parameter>\n</function>\n', allow);
  assert.deepEqual(calls, [{ name: 'make_dir', argsText: '{"path":"src/main"}' }]);
});

test('text tool calls: hermes json', () => {
  const calls = parseTextToolCalls('{"name":"create_file","arguments":{"path":"a.txt","content":"hi\\nthere"}}', allow);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].argsText), { path: 'a.txt', content: 'hi\nthere' });
});

test('text tool calls: unknown tool is rejected', () => {
  assert.deepEqual(parseTextToolCalls('<function=not_a_tool><parameter=x>1</parameter></function>', allow), []);
});

test('text tool calls: prose is not a call', () => {
  assert.deepEqual(parseTextToolCalls('I would call a function here but cannot.', allow), []);
});

test('text tool calls: multiple in one block', () => {
  const calls = parseTextToolCalls('<function=make_dir><parameter=path>a</parameter></function><function=make_dir><parameter=path>b</parameter></function>', allow);
  assert.equal(calls.length, 2);
});

test('text tool calls: numeric and boolean coercion by key', () => {
  const calls = parseTextToolCalls('<function=bash><parameter=cmd>ls</parameter><parameter=timeout_s>30</parameter></function>', allow);
  assert.deepEqual(JSON.parse(calls[0].argsText), { cmd: 'ls', timeout_s: 30 });
});

test('tool args: partial json survives', () => {
  assert.equal(toCall('bash', '{"cmd":"echo hi"}').tool, 'bash');
  assert.equal(parseArgs('{"cmd":"echo hi"}').cmd, 'echo hi');
});

test('tool args: unterminated json keeps the closed keys', () => {
  assert.equal(parseArgs('{"path":"a.txt","content":"unterminated').path, 'a.txt');
  assert.equal(parseArgs('Sure: {"path":"a.txt"} done').path, 'a.txt');
  assert.equal(parseArgs('```json\n{"path":"a.txt"}\n```').path, 'a.txt');
});

test('tool args: nested arguments wrapper is unwrapped', () => {
  assert.equal(parseArgs('{"arguments":{"path":"b.txt"}}').path, 'b.txt');
  assert.deepEqual(parseArgs('not json at all'), {});
  assert.equal(toCall('bash', 'garbage {{{').tool, 'bash');
});

test('text tool calls: imitation history marker is recovered', () => {
  const calls = parseTextToolCalls('[used create_file]\n<parameter=path>a.txt</parameter>\n<parameter=content>hi</parameter>', allow);
  assert.deepEqual(calls, [{ name: 'create_file', argsText: '{"path":"a.txt","content":"hi"}' }]);
});

test('text tool calls: missing closing tags still parse', () => {
  const calls = parseTextToolCalls('<function=create_file><parameter=path>a.txt</parameter><parameter=content>body', allow);
  assert.deepEqual(JSON.parse(calls[0].argsText), { path: 'a.txt', content: 'body' });
});

test('text tool calls: bare parameters recover the name from the hint', () => {
  const calls = parseTextToolCalls('<parameter=path>a.txt</parameter>', allow, 'create_file');
  assert.deepEqual(calls, [{ name: 'create_file', argsText: '{"path":"a.txt"}' }]);
});

test('text tool calls: python style call is recovered', () => {
  const calls = parseTextToolCalls('functions.bash({"cmd":"ls -la"})', allow);
  assert.deepEqual(calls, [{ name: 'bash', argsText: '{"cmd":"ls -la"}' }]);
});

test('text tool calls: openai style tool_calls wrapper', () => {
  const calls = parseTextToolCalls('{"tool_calls":[{"function":{"name":"bash","arguments":"{\\"cmd\\":\\"ls\\"}"}}]}', allow);
  assert.deepEqual(calls, [{ name: 'bash', argsText: '{"cmd":"ls"}' }]);
});

test('tool text filter: malformed block becomes a call, prose is untouched', () => {
  const run = (input, size) => {
    let text = '';
    const calls = [];
    const f = makeToolTextFilter(t => { text += t; }, cs => { calls.push(...cs); }, allow);
    for (let i = 0; i < input.length; i += size) f.feed(input.slice(i, i + size));
    f.flush();
    return { text, calls };
  };
  const bad = 'Sure.\n[used create_file]\n<parameter=path>a.txt</parameter>\n<parameter=content>hi</parameter>\nDone!';
  for (const size of [1, 5, 4096]) {
    const r = run(bad, size);
    assert.equal(r.calls.length, 1);
    assert.deepEqual(JSON.parse(r.calls[0].argsText), { path: 'a.txt', content: 'hi' });
    assert.equal(r.text, 'Sure.\nDone!');
    const p = run('Compare a < b, list[0] and [used] in prose.', size);
    assert.deepEqual(p.calls, []);
    assert.equal(p.text, 'Compare a < b, list[0] and [used] in prose.');
  }
});

test('compaction: threshold falls back when context is unknown', () => {
  assert.equal(compactThreshold({ enable_summaries: 0 }, 0), Infinity);
  const t = compactThreshold({ enable_summaries: 1, summary_padding: 0.125 }, 0);
  assert.equal(t, Math.floor(FALLBACK_CTX * 0.875));
  assert.equal(compactThreshold({ enable_summaries: 1, summary_padding: 0.125 }, 4096), 3584);
});

test('compaction: in-turn trim keeps recent tool results', () => {
  const big = 'x'.repeat(2000);
  const inTurn = [
    { role: 'assistant', content: 'a' },
    { role: 'tool', content: big },
    { role: 'tool', content: big },
    { role: 'tool', content: big }
  ];
  const { list, trimmed } = trimInTurn(inTurn, 2);
  assert.equal(trimmed, 1);
  assert.ok(list[1].content.length < 600);
  assert.equal(list[2].content.length, 2000);
  assert.equal(list[3].content.length, 2000);
  assert.equal(list[0].content, 'a');
  assert.equal(trimInTurn(list, 2).trimmed, 0);
});

test('compaction: estimate counts roles and tool calls', () => {
  assert.ok(estimateTokens([{ role: 'user', content: 'hello world' }]) > 0);
  assert.ok(estimateTokens([{ role: 'assistant', content: '', tool_calls: [{ name: 'bash', argsText: '{"cmd":"ls"}' }] }]) > 8);
});

test('llamacpp: overflow errors are recognised', () => {
  assert.equal(isContextOverflowError(new Error('the request exceeds the available context size')), true);
  assert.equal(isContextOverflowError(new Error('context_length_exceeded')), true);
  assert.equal(isContextOverflowError(new Error('Upstream error 500: kv cache is full')), true);
  assert.equal(isContextOverflowError(new Error('connection refused')), false);
});

test('windows: unix idioms are translated', () => {
  // mkdir -p src/main/java also has its forward slashes fixed: cmd.exe's own mkdir
  // reads a bare "/" as a switch, so the unpatched output would fail outright.
  assert.equal(winTranslate('mkdir -p src/main/java').cmd, 'mkdir src\\main\\java');
  assert.equal(winTranslate('rm -rf build').cmd, 'rmdir /s /q build');
  assert.equal(winTranslate('cp -r a b').cmd, 'xcopy /e /i /y a b');
  assert.equal(winTranslate('mv a b').cmd, 'move /y a b');
  assert.equal(winTranslate('cat file.txt').cmd, 'type file.txt');
  assert.equal(winTranslate('which node').cmd, 'where node');
  assert.equal(winTranslate('python3 x.py').cmd, 'python x.py');
});

test('windows: chained segments each translate', () => {
  const r = winTranslate('mkdir -p out && cp -r src out');
  assert.equal(r.cmd, 'mkdir out && xcopy /e /i /y src out');
  assert.equal(r.notes.length, 2);
});

test('windows: arguments to ordinary programs are never rewritten', () => {
  assert.equal(winTranslate('gradle build --info').cmd, 'gradle build --info');
  assert.equal(winTranslate('echo please rm -rf nothing').cmd, 'echo please rm -rf nothing');
  assert.equal(winTranslate('node scripts/cp.js').cmd, 'node scripts/cp.js');
  assert.equal(winTranslate('python src/app.py').cmd, 'python src/app.py');
  assert.equal(winTranslate('').cmd, '');
  assert.equal(winTranslate(null).cmd, '');
});

test('windows: untouched commands report no notes', () => {
  assert.equal(winTranslate('npm install').notes.length, 0);
  assert.equal(winTranslate('mkdir out').notes.length, 0);
});

test('windows: forward slashes in cmd.exe builtin path arguments become backslashes', () => {
  // mkdir a/b is parsed by cmd.exe as "mkdir a" plus a bogus "/b" switch and fails
  // with "The syntax of the command is incorrect." — this is the actual reported bug.
  assert.equal(winTranslate('mkdir a/b/c').cmd, 'mkdir a\\b\\c');
  assert.equal(winTranslate('rmdir /s /q old/stuff').cmd, 'rmdir /s /q old\\stuff');
  assert.equal(winTranslate('del /q /f a/b.txt').cmd, 'del /q /f a\\b.txt');
  assert.equal(winTranslate('copy src/a.txt dst/b.txt').cmd, 'copy src\\a.txt dst\\b.txt');
  assert.equal(winTranslate('dir /s /b src/main').cmd, 'dir /s /b src\\main');
  assert.equal(winTranslate('type src/a.txt').cmd, 'type src\\a.txt');
  assert.equal(winTranslate('MKDIR a/b').cmd, 'MKDIR a\\b', 'the builtin name is matched case-insensitively');
});

test('windows: real switches on slash-sensitive builtins survive untouched', () => {
  const r = winTranslate('xcopy /e /i /y src/a dst/b');
  assert.equal(r.cmd, 'xcopy /e /i /y src\\a dst\\b', '/e /i /y are flags, not paths, and must not be turned into backslashes');
});

test('windows: quoted paths with spaces are slash-fixed inside the quotes', () => {
  assert.equal(winTranslate('mkdir "my folder/sub"').cmd, 'mkdir "my folder\\sub"');
});

test('windows: cd is deliberately excluded from the slash fix', () => {
  // cmd.exe's cd/chdir hands the path straight to SetCurrentDirectoryW and accepts
  // forward slashes fine, unlike mkdir/del/copy/etc. Rewriting it would be a no-op
  // at best; this test exists so nobody "completes" the SLASH_SENSITIVE set later
  // without re-checking that cd actually needs it.
  assert.equal(winTranslate('cd src/main').cmd, 'cd src/main');
});

test('windows: the slash fix reports a note, same as every other auto-correction', () => {
  const r = winTranslate('mkdir a/b');
  assert.equal(r.notes.length, 1);
});

test('rolling ctx: fits under budget returns the list untouched', () => {
  const msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }];
  const r = truncateForRollingCtx('c1', msgs, 8192);
  assert.equal(r.msgs, msgs);
  assert.equal(r.dropped, 0);
  assert.equal(r.trimmed, false);
});

test('rolling ctx: drops oldest non-system turns first and keeps every system message', () => {
  const msgs = [
    { role: 'system', content: 'S'.repeat(100) },
    { role: 'user', content: 'a'.repeat(6000) },
    { role: 'assistant', content: 'b'.repeat(6000) },
    { role: 'user', content: 'c'.repeat(600) }
  ];
  const r = truncateForRollingCtx('c2', msgs, 2048);
  assert.ok(r.dropped > 0);
  assert.equal(r.msgs.filter(m => m.role === 'system').length, 1);
  assert.equal(r.msgs[r.msgs.length - 1].content, 'c'.repeat(600));
  assert.ok(r.msgs.length < msgs.length);
});

test('rolling ctx: a single oversized turn is trimmed rather than dropped', () => {
  const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'x'.repeat(200000) }];
  const r = truncateForRollingCtx('c3', msgs, 2048);
  assert.equal(r.dropped, 0);
  assert.equal(r.trimmed, true);
  assert.equal(r.msgs.length, 2);
  assert.ok(r.msgs[1].content.length < 200000);
});

test('token counter: chunked adds match a whole-string estimate', () => {
  const text = 'hello world '.repeat(120) + '日本語のテキスト'.repeat(40) + '한국어';
  const counter = makeTokenCounter();
  for (let i = 0; i < text.length; i += 7) counter.add(text.slice(i, i + 7));
  assert.equal(counter.tokens, textTokens(text));
  const empty = makeTokenCounter();
  empty.add('');
  assert.equal(empty.tokens, 0);
});

test('token estimates are stable across repeat calls on long strings', () => {
  const long = 'word '.repeat(500);
  const first = textTokens(long);
  assert.equal(textTokens(long), first);
  assert.equal(estimateTokens([{ role: 'user', content: long }]), first + 4);
});

test('scanTools: prose is never mistaken for a call, real calls still parse', () => {
  assert.deepEqual(scanTools('just some prose with <angle> and [square] bits'), { calls: [], live: null });
  assert.deepEqual(scanTools(''), { calls: [], live: null });
  const parsed = scanTools('<tool bash>\ncmd: ls -la\n</tool>');
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].call.tool, 'bash');
  assert.equal(parsed.calls[0].call.cmd, 'ls -la');
  const live = scanTools('<tool create_file>\npath: a.txt\n<CONTENT>\npartial').live;
  assert.equal(live.tool, 'create_file');
  assert.equal(live.path, 'a.txt');
});

test('preferredChild: descending keeps the active branch instead of the newest sibling', () => {
  const kids = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(preferredChild(kids, new Set(['b'])).id, 'b');
  assert.equal(preferredChild(kids, new Set(['a'])).id, 'a');
  assert.equal(preferredChild(kids, new Set(['zz'])).id, 'c');
  assert.equal(preferredChild(kids, new Set()).id, 'c');
  assert.equal(preferredChild(kids, null).id, 'c');
  assert.equal(preferredChild([], new Set(['a'])), null);
  assert.equal(preferredChild(undefined, new Set(['a'])), null);
});

test('egress: private and loopback addresses are reachable', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '172.31.255.254', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test('egress: public addresses are not reachable', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '100.128.0.1', '93.184.216.34', '2606:4700::1111', 'not-an-ip', '']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('egress allowlist matches hosts and subdomains without suffix confusion', () => {
  const list = ['api.openai.com', '*.anthropic.com'];
  assert.equal(hostAllowed('api.openai.com', list), true);
  assert.equal(hostAllowed('API.OpenAI.com', list), true);
  assert.equal(hostAllowed('api.anthropic.com', list), true);
  assert.equal(hostAllowed('anthropic.com', list), true);
  assert.equal(hostAllowed('anthropic.com.evil.com', list), false);
  assert.equal(hostAllowed('notanthropic.com', list), false);
  assert.equal(hostAllowed('example.com', list), false);
  assert.equal(hostAllowed('', list), false);
});

const RT_MODELS = {
  hub: { id: 'hub', name: 'Hub', kind: 'router', router_default: 'small', router_rules: [
    { match: 'hasImage', value: '', modelId: 'vision', label: 'images' },
    { match: 'hasCode', value: '', modelId: 'coder', label: 'code' },
    { match: 'keyword', value: 'translate, traducir', modelId: 'trans', label: 'translation' },
    { match: 'longerThan', value: '500', modelId: 'big', label: 'long' },
  ] },
  small: { id: 'small', name: 'Small' }, vision: { id: 'vision', name: 'Vision' },
  coder: { id: 'coder', name: 'Coder' }, trans: { id: 'trans', name: 'Trans' }, big: { id: 'big', name: 'Big' },
  loopA: { id: 'loopA', name: 'A', kind: 'router', router_default: 'loopB', router_rules: [] },
  loopB: { id: 'loopB', name: 'B', kind: 'router', router_default: 'loopA', router_rules: [] },
  orphan: { id: 'orphan', name: 'Orphan', kind: 'router', router_default: '', router_rules: [] },
};
const rtGet = (id) => RT_MODELS[id] || null;
const rtGo = (hub, text, atts) => resolveRouted(RT_MODELS[hub], [{ role: 'user', content: text }], atts, rtGet);

test('router picks the first matching rule and falls back otherwise', () => {
  assert.equal(rtGo('hub', 'hi there').model.name, 'Small');
  assert.equal(rtGo('hub', 'fix this ```js\nconst a=1```').model.name, 'Coder');
  assert.equal(rtGo('hub', 'please translate this').model.name, 'Trans');
  assert.equal(rtGo('hub', 'x'.repeat(600)).model.name, 'Big');
  assert.equal(rtGo('hub', 'what is this', [{ mime: 'image/png' }]).model.name, 'Vision');
});

test('router refuses loops and missing fallbacks instead of guessing', () => {
  const loop = rtGo('loopA', 'hi');
  assert.equal(loop.model, null);
  assert.match(loop.routed.error, /loop/i);
  const orphan = rtGo('orphan', 'hi');
  assert.equal(orphan.model, null);
});

test('non-router models pass straight through', () => {
  const r = resolveRouted(RT_MODELS.small, [{ role: 'user', content: 'hi' }], [], rtGet);
  assert.equal(r.model.name, 'Small');
  assert.equal(r.routed, null);
});

test('router rules reject entries without a target and cap bad matchers', () => {
  const rules = routerRules({ router_rules: [{ match: 'nonsense', value: 'x', modelId: 'a' }, { match: 'keyword', value: 'y' }] });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].match, 'keyword');
});

test('a broken or dangerous regex rule does not throw or hang', () => {
  const sig = (text) => ({ text, lower: text.toLowerCase(), length: text.length });
  assert.equal(ruleMatches({ match: 'regex', value: '([' }, sig('abc')), false);

  // A routing rule is evaluated on every turn against whatever the user typed, so a rule
  // that backtracks catastrophically would hang the server on every message, not just one
  // tool call. It has to decline rather than run.
  const started = Date.now();
  assert.equal(ruleMatches({ match: 'regex', value: '(a+)+$' }, sig('a'.repeat(4000) + '!')), false);
  assert.ok(Date.now() - started < 1000, 'declined immediately rather than backtracking');

  // and ordinary rules still route
  assert.equal(ruleMatches({ match: 'regex', value: '^translate\\b' }, sig('translate this please')), true);
  assert.equal(ruleMatches({ match: 'regex', value: '(cat|dog)s?' }, sig('my dogs')), true);
});

test('routed payload carries real model names, not undefined', () => {
  const hub = { id: 'h', display_name: 'Hub', kind: 'router', router_default: 'target', router_rules: [] };
  const target = { id: 'target', display_name: 'Target' };
  const r = resolveRouted(hub, [{ role: 'user', content: 'hi' }], [], (id) => (id === 'target' ? target : null));
  assert.equal(r.model.id, 'target');
  assert.equal(r.routed.hubName, 'Hub');
  assert.equal(r.routed.modelName, 'Target');
  assert.equal(r.routed.hops[0].toName, 'Target');
  const dead = resolveRouted({ id: 'h2', display_name: 'Orphan', kind: 'router', router_default: '', router_rules: [] }, [{ role: 'user', content: 'x' }], [], () => null);
  assert.equal(dead.model, null);
  assert.equal(dead.routed.hubName, 'Orphan');
});

test('modelLabel falls back through the name fields a row may carry', () => {
  assert.equal(modelLabel({ display_name: 'A', name: 'B', internal_name: 'C', id: 'D' }), 'A');
  assert.equal(modelLabel({ name: 'B', internal_name: 'C', id: 'D' }), 'B');
  assert.equal(modelLabel({ internal_name: 'C', id: 'D' }), 'C');
  assert.equal(modelLabel({ id: 'D' }), 'D');
  assert.equal(modelLabel(null), '');
});

test('egress: only the reserved slices of 192.0/16 count as private', () => {
  for (const ip of ['192.0.0.1', '192.0.0.255', '192.0.2.1', '192.0.2.254']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['192.0.1.1', '192.0.3.1', '192.0.77.9', '192.0.255.255']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('stop sequences: split, trimmed, deduped and capped per provider', () => {
  assert.deepEqual(parseStop('</s>\n  <|im_end|>  \n\n</s>\nEND', 8), ['</s>', '<|im_end|>', 'END']);
  assert.deepEqual(parseStop('a\nb\nc\nd\ne\nf', 4), ['a', 'b', 'c', 'd']);
  assert.deepEqual(parseStop('', 8), []);
  assert.deepEqual(parseStop(null, 8), []);
  assert.deepEqual(parseStop(['x', ' y ', 'x'], 8), ['x', 'y']);
});

test('samplingParams: stop is sent as a list, capped by the provider', () => {
  const six = 'a\nb\nc\nd\ne\nf';
  assert.deepEqual(samplingParams({ stop: six }, PROVIDER_TYPES.llamacpp).stop, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(samplingParams({ stop: six }, PROVIDER_TYPES.openai).stop, ['a', 'b', 'c', 'd']);
  assert.equal('stop' in samplingParams({ stop: '' }, PROVIDER_TYPES.llamacpp), false);
  assert.equal('stop' in samplingParams({ stop: '   \n  ' }, PROVIDER_TYPES.llamacpp), false);
  assert.equal('stop' in samplingParams({ stop: 'x' }, PROVIDER_TYPES.moonshot), true);
});

test('samplingParams: llama.cpp samplers pass through, unsupported ones are dropped', () => {
  const m = { temperature: 0.7, dry_multiplier: 0.8, dry_allowed_length: 2, xtc_probability: 0.5, mirostat: 2, repetition_penalty: 1.1 };
  const llama = samplingParams(m, PROVIDER_TYPES.llamacpp);
  assert.equal(llama.dry_multiplier, 0.8);
  assert.equal(llama.dry_allowed_length, 2);
  assert.equal(llama.xtc_probability, 0.5);
  assert.equal(llama.mirostat, 2);
  assert.equal(llama.repeat_penalty, 1.1);
  assert.equal('repetition_penalty' in llama, false);
  const oai = samplingParams(m, PROVIDER_TYPES.openai);
  assert.equal(oai.temperature, 0.7);
  for (const k of ['dry_multiplier', 'dry_allowed_length', 'xtc_probability', 'mirostat', 'repetition_penalty', 'repeat_penalty']) {
    assert.equal(k in oai, false, k);
  }
});

test('trimMode only opts in on the exact value', () => {
  assert.equal(trimMode({ ctx_trim_mode: 'cache' }), 'cache');
  assert.equal(trimMode({ ctx_trim_mode: 'retain' }), 'retain');
  assert.equal(trimMode({}), 'retain');
  assert.equal(trimMode(null), 'retain');
});

const stubCount = (list) => list.reduce((n, m) => n + Math.ceil(String(m.content || '').length / 4) + 4, 0);
const convo = (turns) => {
  const out = [{ role: 'system', content: 'S'.repeat(200) }];
  for (let i = 0; i < turns; i++) {
    out.push({ role: 'user', content: `u${i} ` + 'x'.repeat(400) });
    out.push({ role: 'assistant', content: `a${i} ` + 'y'.repeat(400) });
  }
  return out;
};

test('slideWithCounter: cache mode drops past what is needed, retain mode does not', async () => {
  const msgs = convo(40);
  const budget = 4000;
  const retain = await slideWithCounter(stubCount, msgs, budget, { mode: 'retain' });
  const cache = await slideWithCounter(stubCount, msgs, budget, { mode: 'cache' });
  assert.ok(retain.tokens <= budget);
  assert.ok(cache.tokens <= budget);
  assert.ok(cache.tokens <= retain.tokens, `cache ${cache.tokens} should not exceed retain ${retain.tokens}`);
  assert.ok(cache.dropped > retain.dropped, `cache ${cache.dropped} should exceed retain ${retain.dropped}`);
});

const firstKept = (r) => {
  const m = r.msgs.find(x => x.role !== 'system');
  const hit = String(m && m.content || '').match(/\b([ua]\d+)\b/);
  return hit ? hit[1] : 'none';
};

test('slideWithCounter: cache mode holds the prefix still while retain mode moves it every turn', async () => {
  const budget = 4000;
  const retainHeads = new Set();
  const cacheHeads = new Set();
  for (let turns = 40; turns < 46; turns++) {
    const msgs = convo(turns);
    retainHeads.add(firstKept(await slideWithCounter(stubCount, msgs, budget, { mode: 'retain' })));
    cacheHeads.add(firstKept(await slideWithCounter(stubCount, msgs, budget, { mode: 'cache' })));
  }
  assert.equal(retainHeads.size, 6, 'retain mode should move the boundary on every single turn');
  assert.ok(cacheHeads.size <= 2, `cache mode moved the boundary ${cacheHeads.size} times over six turns`);
});

test('slideWithCounter: the cache boundary does move once the slack is used up', async () => {
  const budget = 4000;
  const heads = new Set();
  for (let turns = 40; turns < 70; turns++) {
    heads.add(firstKept(await slideWithCounter(stubCount, convo(turns), budget, { mode: 'cache' })));
  }
  assert.ok(heads.size > 1, 'cache mode must still slide, just less often');
});

test('slideWithCounter: an unreachable cache target still yields a prompt that fits', async () => {
  const msgs = convo(3);
  const budget = 420;
  const r = await slideWithCounter(stubCount, msgs, budget, { mode: 'cache' });
  assert.ok(r.tokens > 0);
  assert.ok(r.tokens <= budget, `${r.tokens} > ${budget}`);
});

test('slideWithCounter: a prompt already inside the budget is left alone in both modes', async () => {
  const msgs = convo(2);
  const total = stubCount(msgs);
  for (const mode of ['retain', 'cache']) {
    const r = await slideWithCounter(stubCount, msgs, total + 500, { mode });
    assert.equal(r.dropped, 0, mode);
    assert.equal(r.trimmed, false, mode);
    assert.equal(r.msgs, msgs, mode);
  }
});

test('sandbox guard: ordinary build and run commands are not blocked', () => {
  const ok = [
    'npm install express', 'node app.js', 'python sum.py nums.txt',
    'pip install -r requirements.txt', 'cd src && node index.js',
    'git init && git add -A', 'npm run build --silent',
    'sed -i s/a/b/g file.txt', 'curl https://example.com/x -o out.html',
    'mkdir -p src/utils', 'cargo build --release', 'echo hi > out.txt',
    'node test.js 2>/dev/null', './gradlew build', 'tar -czf out.tgz src',
    'npx tsc --outDir dist', 'python -c "print(1/2)"'
  ];
  for (const cmd of ok) assert.equal(screenCommand(cmd).ok, true, cmd);
});

test('sandbox guard: paths outside the workspace are refused', () => {
  const bad = [
    'cat /etc/passwd', 'cd /', 'rm -rf /', 'cp ~/.ssh/id_rsa .',
    'node ../../evil.js', 'cd ../../..', 'echo x > /usr/local/bin/y',
    'type C:\\Windows\\System32\\drivers\\etc\\hosts', 'dir \\\\server\\share'
  ];
  for (const cmd of bad) assert.equal(screenCommand(cmd).ok, false, cmd);
});

test('sandbox guard: host administration commands are refused', () => {
  const bad = ['sudo apt-get install nginx', 'systemctl restart nginx', 'reg add HKLM\\x', 'docker run -it x', 'ssh user@host', 'apt install foo', 'shutdown /s'];
  for (const cmd of bad) assert.equal(screenCommand(cmd).ok, false, cmd);
});

test('toCall: an argument named "tool" cannot rename the tool being called', () => {
  const call = toCall('create_file', JSON.stringify({ tool: 'bash', path: 'a.txt', content: 'x' }));
  assert.equal(call.tool, 'create_file');
  assert.equal(call.path, 'a.txt');
  assert.equal(call.content, 'x');
});

test('toCall: a cut-off marker survives the tool name being reapplied', () => {
  const call = toCall('create_file', '{"path": "a.txt", "content": "half of the fi');
  assert.equal(call.tool, 'create_file');
  assert.equal(cutOffOf(call)?.key, 'content');
});

test('unzip: a compression bomb cannot be inflated without bound', () => {
  const huge = Buffer.alloc(80 * 1024 * 1024, 0);
  const zip = zipBuffer([{ name: 'bomb.bin', data: huge }]);
  assert.ok(zip.length < 1024 * 1024, 'the bomb should compress to almost nothing');
  const entries = unzipBuffer(zip);
  const total = entries.reduce((n, e) => n + e.data.length, 0);
  assert.ok(total <= 64 * 1024 * 1024, `inflated ${total} bytes, expected the per-entry cap to hold`);
});

test('unzip: ordinary archives still round-trip through the cap', () => {
  const zip = zipBuffer([
    { name: 'a.txt', data: Buffer.from('hello') },
    { name: 'dir/b.txt', data: Buffer.from('x'.repeat(5000)) }
  ]);
  const entries = unzipBuffer(zip);
  assert.deepEqual(entries.map(e => e.name), ['a.txt', 'dir/b.txt']);
  assert.equal(entries[0].data.toString(), 'hello');
  assert.equal(entries[1].data.length, 5000);
});

test('egress: loopback and ULA are private however the address is written', () => {
  for (const ip of ['::1', '0:0:0:0:0:0:0:1', '::', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:192.168.1.1', '0:0:0:0:0:ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['2001:4860:4860::8888', '2001:db8::1', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8', 'not-an-ip', 'fg::1']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('admin settings: every field is coerced and clamped at the boundary', () => {
  assert.equal(coerceSetting(SETTING_FIELDS.apiBaseUrl, { evil: 1 }), '[object Object]'.slice(0, 500));
  assert.equal(coerceSetting(SETTING_FIELDS.apiBaseUrl, '  http://x  '), 'http://x');
  assert.equal(coerceSetting(SETTING_FIELDS.apiKey, 'k'.repeat(9999)).length, 500);
  assert.equal(coerceSetting(SETTING_FIELDS.modelQueue, 'yes'), '1');
  assert.equal(coerceSetting(SETTING_FIELDS.modelQueue, 0), '0');
  assert.equal(coerceSetting(SETTING_FIELDS.webSearchCount, 9999), '20');
  assert.equal(coerceSetting(SETTING_FIELDS.webSearchCount, 'abc'), '5');
  assert.equal(coerceSetting(SETTING_FIELDS.uploadLimitUserMb, -5), '0');
  assert.equal(coerceSetting(SETTING_FIELDS.voiceTtsSpeed, 99), '4');
  assert.equal(coerceSetting(SETTING_FIELDS.voiceSttEngine, 'nonsense'), 'browser');
  assert.equal(coerceSetting(SETTING_FIELDS.voiceSttEngine, 'server'), 'server');
  assert.equal(coerceSetting(SETTING_FIELDS.voiceTtsModel, ''), 'tts-1');
  assert.deepEqual(
    JSON.parse(coerceSetting(SETTING_FIELDS.webSearchDomains, 'https://A.com/x\nb.com, a.com')),
    ['a.com', 'b.com']
  );
});

test('admin settings: an unknown or inherited field name writes nothing', () => {
  assert.equal(SETTING_FIELDS.constructor, undefined);
  assert.equal(SETTING_FIELDS.__proto__, undefined);
  assert.equal(SETTING_FIELDS.toString, undefined);
});

test('sandbox guard: a host command is screened wherever a command can start', () => {
  const bad = [
    'echo hi & sudo rm -rf x',
    'echo $(systemctl restart nginx)',
    'echo `apt-get install nginx`',
    'true & docker run -it x'
  ];
  for (const cmd of bad) assert.equal(screenCommand(cmd).ok, false, cmd);
});

test('sandbox guard: & and parentheses in ordinary arguments are not commands', () => {
  const ok = [
    'curl "http://localhost:8080/x?a=1&net=2" -o out.html',
    'git commit -m "fix(net): retry on timeout"',
    'node -e "console.log(1 & 2)"',
    'npm run build && npm test'
  ];
  for (const cmd of ok) assert.equal(screenCommand(cmd).ok, true, cmd);
});

test('sandbox guard: cd escapes are judged against the current depth', () => {
  assert.equal(screenCommand('cd ..', 'src/utils').ok, true);
  assert.equal(screenCommand('cd ../..', 'src/utils').ok, true);
  assert.equal(screenCommand('cd ../../..', 'src/utils').ok, false);
  assert.equal(screenCommand('cd ..', '').ok, false);
});

test('sandbox guard: refusals explain the boundary rather than just failing', () => {
  const r = screenCommand('cat /etc/passwd');
  assert.match(r.error, /relative/i);
  assert.match(r.error, /workspace/i);
});

test('normalizeRel: forgiving where intent is clear, strict where it is not', () => {
  assert.equal(normalizeRel('src/app.py').rel, 'src/app.py');
  assert.equal(normalizeRel('/notes.md').rel, 'notes.md');
  assert.equal(normalizeRel('./x/../y.txt').rel, 'y.txt');
  assert.equal(normalizeRel('a\\b\\c.txt').rel, 'a/b/c.txt');
  assert.equal(normalizeRel('"quoted.txt"').rel, 'quoted.txt');
  for (const bad of ['C:/x', 'C:\\Windows\\x', '~/a', '../x', '//server/share', '/etc/passwd', '']) {
    assert.equal(normalizeRel(bad).ok, false, bad);
  }
});

test('normalizeRel: an empty path is only allowed when the caller opts in', () => {
  assert.equal(normalizeRel('', { allowEmpty: true }).rel, '');
  assert.equal(normalizeRel('.', { allowEmpty: true }).rel, '');
  assert.equal(normalizeRel('').ok, false);
});

test('tool aliases: common wrong names resolve to the real tool', () => {
  assert.equal(resolveToolName('write_file'), 'create_file');
  assert.equal(resolveToolName('str_replace_editor'), 'str_replace');
  assert.equal(resolveToolName('read_file'), 'view');
  assert.equal(resolveToolName('run_terminal_cmd'), 'bash');
  assert.equal(resolveToolName('functions.write_to_file'), 'create_file');
  assert.equal(resolveToolName('create_file'), 'create_file');
});

test('tool aliases: bare English words only resolve in loose mode', () => {
  for (const w of ['read', 'list', 'copy', 'type', 'delete', 'open']) {
    assert.equal(resolveToolName(w), null, w);
    assert.ok(resolveToolName(w, true), w);
  }
});

test('tool aliases: unknown names never resolve', () => {
  for (const n of ['browse_web', 'send_email', '', null]) assert.equal(resolveToolName(n, true), null);
});

test('tool resolver: only maps onto tools that are actually enabled', () => {
  const resolve = makeToolResolver(['create_file', 'view']);
  assert.equal(resolve('write_file'), 'create_file');
  assert.equal(resolve('view'), 'view');
  assert.equal(resolve('bash'), null);
  assert.equal(resolve('run_terminal_cmd'), null);
});

test('tool resolver: an exact name always wins over an alias', () => {
  const resolve = makeToolResolver(['write_file', 'create_file']);
  assert.equal(resolve('write_file'), 'write_file');
});

test('tool resolver: no enabled tools means no resolver at all', () => {
  assert.equal(makeToolResolver([]), null);
});

test('nearestTool suggests a fix for a typo but not for nonsense', () => {
  assert.equal(nearestTool('creat_file'), 'create_file');
  assert.equal(nearestTool('lst_files'), 'list_files');
  assert.equal(nearestTool('send_email_to_bob'), null);
});

test('text tool calls resolve aliases through the enabled set', () => {
  const resolve = makeToolResolver(['create_file']);
  const calls = parseTextToolCalls('<function=write_file><parameter=path>a.txt</parameter><parameter=content>hi</parameter></function>', resolve);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'create_file');
  assert.deepEqual(JSON.parse(calls[0].argsText), { path: 'a.txt', content: 'hi' });
});

test('text tool calls still reject names that are not enabled at all', () => {
  const resolve = makeToolResolver(['view']);
  assert.equal(parseTextToolCalls('<function=send_email><parameter=to>x</parameter></function>', resolve).length, 0);
});

test('every sandbox tool name is unique and resolves to itself', () => {
  assert.equal(new Set(SANDBOX_TOOLS).size, SANDBOX_TOOLS.length);
  for (const t of SANDBOX_TOOLS) assert.equal(resolveToolName(t), t);
});

// --- truncated tool calls -------------------------------------------------

test('a tool call cut off mid-argument is reported, not silently emptied', () => {
  const call = toCall('create_file', '{"path": "oe_enderium.json", "content": "{\\n  \\"parent\\": \\"item/gen');
  assert.equal(call.path, 'oe_enderium.json', 'the arguments that did arrive are still usable');
  const cut = cutOffOf(call);
  assert.ok(cut, 'the unclosed argument is reported instead of being dropped');
  assert.equal(cut.key, 'content');
  assert.ok(cut.chars > 0, 'it says how much of the argument arrived');
});

test('a complete tool call carries no cut-off marker', () => {
  for (const args of [
    '{"path": "a.txt", "content": "hello"}',
    '{"path": "a.txt", "content": "hello"',
    '{"path": "a.txt", "content": ""}'
  ]) {
    assert.equal(cutOffOf(toCall('create_file', args)), null, args);
  }
});

test('a cut-off write is told to split the file, not to resend', () => {
  const msg = cutOffError('create_file', { key: 'content', chars: 4213 }, true);
  assert.match(msg, /cut off/i);
  assert.match(msg, /"content"/);
  assert.match(msg, /4213/);
  assert.match(msg, /maximum output length/i);
  assert.match(msg, /insert_lines/, 'it names the tool that appends');
  assert.match(msg, /NOT run/, 'it says nothing was written');

  const other = cutOffError('search', { key: 'query', chars: 90 }, false);
  assert.equal(/insert_lines/.test(other), false, 'the split-write advice is only for file writes');
});

test('tool errors are classified into stable kinds', () => {
  const cases = [
    ['this call was cut off before it finished sending', 'cut_off'],
    ['There is no tool called "creat_file".', 'unknown_tool'],
    ['create_file needs "content". It is the COMPLETE text', 'missing_arg'],
    ['old_str was not found in App.java.', 'no_match'],
    ['Blocked: absolute paths are outside the workspace', 'blocked'],
    ["'gcc' is not recognized as an internal or external command", 'missing_program'],
    ['File not found: app.py. Create it with create_file first.', 'not_found'],
    ['Timed out after 60s', 'timeout'],
    ['Exited with code 1', 'nonzero_exit'],
    ['something nobody predicted', 'other'],
    ['', 'other']
  ];
  for (const [err, kind] of cases) assert.equal(classifyToolError(err), kind, err);
});

// --- sandbox tool surface -------------------------------------------------
// These touch a real (temporary) workspace on purpose: a missing cross-module
// import only shows up when a handler actually runs, which module-load checks
// and node --check both miss.
const SBOX = 'oq-test-sandbox';

async function sbox(call) {
  const { execTool } = await import('../sandbox.js');
  return execTool(SBOX, call);
}
async function sboxReset() {
  const { remove } = await import('../sandbox.js');
  remove(SBOX);
}

test('sandbox: write, read back, edit and list round-trip', async () => {
  await sboxReset();
  assert.equal((await sbox({ tool: 'create_file', path: 'app.py', content: 'print(1)\n' })).ok, true);
  const read = await sbox({ tool: 'view', path: 'app.py' });
  assert.equal(read.ok, true);
  assert.match(read.content, /print\(1\)/);
  assert.equal((await sbox({ tool: 'str_replace', path: 'app.py', old_str: 'print(1)', new_str: 'print(2)' })).ok, true);
  const listed = await sbox({ tool: 'list_files' });
  assert.equal(listed.ok, true);
  assert.ok(listed.files.some(f => f.path === 'app.py'), 'app.py is listed');
  await sboxReset();
});

test('sandbox: search and find reach the workspace', async () => {
  await sboxReset();
  await sbox({ tool: 'create_file', path: 'src/a.py', content: 'import os\n' });
  const found = await sbox({ tool: 'find', pattern: '**/*.py' });
  assert.equal(found.ok, true);
  assert.equal(found.count, 1);
  const hits = await sbox({ tool: 'search', query: 'import' });
  assert.equal(hits.ok, true);
  assert.equal(hits.count, 1);
  await sboxReset();
});

test('sandbox: aliases and alternate argument names resolve', async () => {
  await sboxReset();
  assert.equal((await sbox({ tool: 'write_file', path: 'b.txt', content: 'hi' })).ok, true);
  assert.equal((await sbox({ tool: 'read_file', file_path: 'b.txt' })).ok, true, 'file_path is accepted for path');
  assert.equal((await sbox({ tool: 'edit', path: 'b.txt', old_str: 'hi', new_str: 'yo' })).ok, true, 'loose alias resolves');
  await sboxReset();
});

test('sandbox: every path argument is normalized once', async () => {
  await sboxReset();
  const made = await sbox({ tool: 'create_file', path: '/notes.md', content: 'ok' });
  assert.equal(made.path, 'notes.md', 'leading slash is stripped before it reaches metadata');
  const moved = await sbox({ tool: 'move_file', path: '/notes.md', new_path: 'docs/notes.md' });
  assert.equal(moved.path, 'docs/notes.md');
  await sboxReset();
});

test('sandbox: escaping paths are refused with a teaching error', async () => {
  await sboxReset();
  for (const bad of ['/etc/passwd', 'C:/Windows/x', '../out.txt']) {
    const r = await sbox({ tool: 'create_file', path: bad, content: 'x' });
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /workspace|relative/i, bad);
  }
  await sboxReset();
});

test('sandbox: a missing required argument names the argument', async () => {
  await sboxReset();
  const noContent = await sbox({ tool: 'create_file', path: 'x.txt' });
  assert.equal(noContent.ok, false);
  assert.match(noContent.error, /"content"/);
  const noNew = await sbox({ tool: 'str_replace', path: 'x.txt', old_str: 'a' });
  assert.equal(noNew.ok, false);
  assert.match(noNew.error, /"new_str"/);
  await sboxReset();
});

test('sandbox: an empty string is a real file body, not a missing argument', async () => {
  await sboxReset();
  const made = await sbox({ tool: 'create_file', path: 'empty.txt', content: '' });
  assert.equal(made.ok, true, 'content:"" creates an empty file');
  assert.equal(made.bytes, 0);
  await sbox({ tool: 'create_file', path: 'd.txt', content: 'keep\ndrop\n' });
  const cut = await sbox({ tool: 'str_replace', path: 'd.txt', old_str: 'drop\n', new_str: '' });
  assert.equal(cut.ok, true, 'new_str:"" deletes old_str');
  const after = await sbox({ tool: 'view', path: 'd.txt' });
  assert.equal(/drop/.test(after.content), false);
  await sboxReset();
});

test('sandbox: create_file accepts the other names models use for content', async () => {
  await sboxReset();
  for (const k of ['contents', 'body', 'code', 'file_text', 'source']) {
    const r = await sbox({ tool: 'create_file', path: `${k}.txt`, [k]: 'x' });
    assert.equal(r.ok, true, k);
  }
  await sboxReset();
});

test('sandbox: create_file salvages a body sent under an invented argument name', async () => {
  await sboxReset();
  const long = 'line one of the file\n'.repeat(6);
  const r = await sbox({ tool: 'create_file', path: 'salvaged.txt', the_file_body: long });
  assert.equal(r.ok, true);
  assert.match(r.note, /the_file_body/);
  const back = await sbox({ tool: 'view', path: 'salvaged.txt' });
  assert.match(back.content, /line one of the file/);

  const short = await sbox({ tool: 'create_file', path: 'nope.txt', mood: 'happy' });
  assert.equal(short.ok, false, 'a short unrelated string is not mistaken for a file body');
  await sboxReset();
});

test('sandbox: str_replace tolerates indentation but not ambiguity', async () => {
  await sboxReset();
  await sbox({ tool: 'create_file', path: 'App.java', content: 'class A {\n    void run() {\n        int x = 1;\n    }\n}\n' });
  const fixed = await sbox({ tool: 'str_replace', path: 'App.java', old_str: 'void run() {\nint x = 1;\n}', new_str: 'void run() {\nint x = 2;\n}' });
  assert.equal(fixed.ok, true, 'a snippet retyped without its indentation still matches');
  assert.match(fixed.note, /indentation/i);
  const body = (await sbox({ tool: 'view', path: 'App.java' })).content;
  assert.match(body, / {4}void run\(\) \{/, "the file's own indentation is preserved");
  assert.match(body, /int x = 2;/);

  await sbox({ tool: 'create_file', path: 'two.txt', content: '  a\n\ta\n' });
  const amb = await sbox({ tool: 'str_replace', path: 'two.txt', old_str: 'a', new_str: 'b' });
  assert.equal(amb.ok, false, 'two indentation-insensitive matches stay an error');
  await sboxReset();
});

test('sandbox: a failed str_replace shows the closest text in the file', async () => {
  await sboxReset();
  await sbox({ tool: 'create_file', path: 'cfg.json', content: '{\n  "name": "enderium",\n  "version": "1.0.0"\n}\n' });
  const r = await sbox({ tool: 'str_replace', path: 'cfg.json', old_str: '"version": "9.9.9"', new_str: '"version": "2"' });
  assert.equal(r.ok, false);
  assert.match(r.error, /closest text/i);
  assert.match(r.error, /1\.0\.0/, 'the real line is quoted back with its line number');
  await sboxReset();
});

test('sandbox: an unknown tool suggests the nearest real one', async () => {
  const r = await sbox({ tool: 'creat_file', path: 'a', content: 'b' });
  assert.equal(r.ok, false);
  assert.match(r.error, /create_file/);
});

test('sandbox: bash refuses host commands and paths outside the workspace', async () => {
  for (const cmd of ['sudo apt-get install nginx', 'cat /etc/passwd']) {
    const r = await sbox({ tool: 'bash', cmd });
    assert.equal(r.ok, false, cmd);
    assert.match(r.error, /Blocked/, cmd);
  }
});

test('search patterns that could hang the server are refused', () => {
  // Node has no regex timeout and this server is single-threaded: one of these, from a
  // model that meant no harm, stalls every request for every user.
  const catastrophic = ['(a+)+', '(a*)*', '(a+)*', '(\\w*)*$', '(x{2,})+', '((a+))+', '([a-z]+)+@'];
  for (const p of catastrophic) {
    const r = compileSearchPattern(p);
    assert.equal(r.ok, false, `${p} must be refused`);
    assert.match(r.error, /nests one repetition inside another/, p);
  }

  // The false-positive set is the thing to protect. These are ordinary searches and the
  // check is deliberately narrow enough to let them all through.
  const fine = [
    'TODO', 'function\\s+\\w+', '^\\s*import .*from', '(foo|bar)+', '(https?://\\S+)',
    'a+', '\\d{2,}', '(?:abc)+', '[(]a+[)]+', '\\(a+\\)+', 'class\\s+(\\w+)\\s*\\{', 'a{1,3}b*'
  ];
  for (const p of fine) assert.equal(compileSearchPattern(p).ok, true, `${p} must still work`);

  assert.equal(compileSearchPattern('(unclosed').ok, false, 'a broken pattern is still an error');
  assert.match(compileSearchPattern('a'.repeat(600)).error, /too long/);
  assert.equal(compileSearchPattern('').ok, false);
});

test('sandbox: a search that cannot finish is killed, and normal ones still work', async () => {
  await sboxReset();
  await sbox({ tool: 'create_file', path: 'ok.txt', content: 'hello world\nfind me here\nconst total = 42;\n' });
  await sbox({ tool: 'create_file', path: 'big.txt', content: Array.from({ length: 400 }, () => 'a'.repeat(3000) + '!').join('\n') });

  // The shapes compileSearchPattern refuses are the classic ones. This is the backstop:
  // /(?:a|aa)+b/ against 3000 characters backtracks past the age of the universe, and
  // static analysis of the pattern alone would never have caught it. Nothing inside
  // JavaScript can interrupt it, which is why the regex runs in a killable worker.
  const started = Date.now();
  const bomb = await sbox({ tool: 'search', query: '(?:a|aa)+b', regex: true });
  const elapsed = Date.now() - started;
  assert.equal(bomb.ok, false);
  assert.match(bomb.error, /did not finish/);
  assert.ok(elapsed < 30000, `stopped after ${elapsed}ms instead of running forever`);

  // and the thread that was just killed did not take normal searching with it
  const normal = await sbox({ tool: 'search', query: 'find\\s+me', regex: true });
  assert.equal(normal.ok, true, normal.error);
  assert.equal(normal.count, 1);
  assert.equal(normal.matches[0].path, 'ok.txt');
  assert.equal(normal.matches[0].line, 2);

  const captured = await sbox({ tool: 'search', query: 'const (\\w+) =', regex: true });
  assert.equal(captured.matches[0].text, 'const total = 42;');

  const filtered = await sbox({ tool: 'search', query: 'find', regex: true, filter: 'ok.txt' });
  assert.equal(filtered.count, 1, 'the filter still narrows which files are read');

  const plain = await sbox({ tool: 'search', query: 'world' });
  assert.equal(plain.count, 1, 'plain substring search never needed a worker');

  const broken = await sbox({ tool: 'search', query: '(unclosed', regex: true });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /Invalid regex/);

  assert.equal((await sbox({ tool: 'list_files' })).ok, true, 'the server is still usable');
  await sboxReset();
});

test('sandbox: shell output survives a chunk boundary inside a character', async () => {
  await sboxReset();
  // Long enough that the pipe splits it, and every character is multi-byte, so a naive
  // per-Buffer toString() is guaranteed to cut one in half and emit U+FFFD.
  const body = '日本語テスト'.repeat(4000);
  await sbox({ tool: 'create_file', path: 'wide.txt', content: body });
  const r = await sbox({ tool: 'bash', cmd: process.platform === 'win32' ? 'type wide.txt' : 'cat wide.txt' });
  assert.equal(r.ok, true, r.error);
  assert.equal((r.output.match(/�/g) || []).length, 0, 'no character was decoded in half');
  assert.ok(r.output.startsWith('日本語テスト'), 'output begins with the real text');
  await sboxReset();
});

test('sandbox: a failed command does not move the shell', async () => {
  await sboxReset();
  await sbox({ tool: 'create_file', path: 'proj/a.txt', content: 'x' });
  const ok = await sbox({ tool: 'bash', cmd: 'cd proj' });
  assert.equal(ok.ok, true);
  assert.equal(ok.cwd, 'proj', 'a successful cd still persists');
  assert.equal((await sbox({ tool: 'bash', cmd: 'cd ..' })).cwd, '');

  // A cd that succeeds inside a command that then fails must leave the shell where it was.
  // Persisting it is what turned one bad command into an endless loop: every retry of
  // `cd proj && ...` resolved one level deeper than the last.
  const failed = await sbox({ tool: 'bash', cmd: 'cd proj && nosuchprogram-xyz-qq' });
  assert.equal(failed.ok, false);
  assert.equal(failed.cwd, '', 'the shell must not have moved');

  assert.equal((await sbox({ tool: 'bash', cmd: 'cd proj' })).ok, true, 'so a retry repeats rather than compounds');
  await sboxReset();
});

test('sandbox: repeating a cd the shell already made is explained, not just refused', async () => {
  await sboxReset();
  await sbox({ tool: 'create_file', path: 'proj/src/a.txt', content: 'x' });
  assert.equal((await sbox({ tool: 'bash', cmd: 'cd proj' })).cwd, 'proj');

  const again = await sbox({ tool: 'bash', cmd: 'cd proj && ' + (process.platform === 'win32' ? 'dir' : 'ls') });
  assert.equal(again.ok, false);
  assert.match(again.error, /already in "proj"/);
  assert.match(again.error, /proj\/proj/, 'names the path it actually looked for');
  assert.match(again.error, /workdir/, 'points at the stateless alternative');

  // A genuine nested cd is untouched, and so is a target that exists nowhere.
  const nested = await sbox({ tool: 'bash', cmd: 'cd src' });
  assert.equal(nested.ok, true);
  assert.equal(nested.cwd, 'proj/src');
  const missing = await sbox({ tool: 'bash', cmd: 'cd nope-xyz' });
  assert.equal(missing.ok, false);
  assert.ok(!/already in/.test(missing.error || ''), 'not the stale-cd message');
  await sboxReset();
});

test('sandbox: workdir is absolute from the root however the shell has wandered', async () => {
  await sboxReset();
  await sbox({ tool: 'create_file', path: 'proj/src/deep/a.txt', content: 'x' });
  await sbox({ tool: 'bash', cmd: 'cd proj' });
  await sbox({ tool: 'bash', cmd: 'cd src' });
  const r = await sbox({ tool: 'bash', cmd: process.platform === 'win32' ? 'dir' : 'ls', workdir: 'proj/src/deep' });
  assert.equal(r.ok, true);
  assert.equal(r.cwd, 'proj/src/deep');
  await sboxReset();
});

test('sandbox: a directory that already exists is the asked-for state, not a failure', async () => {
  await sboxReset();
  assert.equal((await sbox({ tool: 'bash', cmd: 'mkdir build' })).ok, true);

  const second = await sbox({ tool: 'bash', cmd: 'mkdir build' });
  assert.equal(second.ok, true, 'repeating it must not read as a failure worth retrying');
  assert.match(second.note || '', /already existed/);

  const trailing = await sbox({ tool: 'bash', cmd: 'cd . && mkdir build' });
  assert.equal(trailing.ok, true, 'a trailing mkdir is still the last thing that ran');

  // But a real failure sitting behind the collision must not be laundered away.
  assert.equal((await sbox({ tool: 'bash', cmd: 'mkdir build && nosuchprogram-xyz-qq' })).ok, false);
  await sboxReset();
});

test('sandbox: hostEnvInfo reports a usable shape without leaking host paths', async () => {
  const { hostEnvInfo } = await import('../sandbox.js');
  const env = hostEnvInfo();
  assert.ok(env.osName && env.shellName);
  assert.ok(Array.isArray(env.interpreters));
  assert.ok(Array.isArray(env.missingUtils));
  for (const i of env.interpreters) {
    assert.equal(/[/]/.test(i.version), false, `${i.name} version must not contain a path: ${i.version}`);
  }
});

// --- reasoning / content split ---------------------------------------------

function emitTo(model, feed) {
  const out = { content: '', reasoning: '' };
  const e = makeEmitter(model, (ev) => {
    if (ev.type === 'content') out.content += ev.text;
    if (ev.type === 'reasoning') out.reasoning += ev.text;
  }, () => {}, null);
  feed(e);
  e.flush();
  return out;
}

test('emitter: a forced close tag on the content channel is swallowed, not printed', () => {
  // llama.cpp streams the thought through reasoning_content, then a thinking
  // budget forces it shut by emitting the raw closing tag as content. Nothing
  // was tracking an open tag, so it used to be printed as the first line.
  const r = emitTo({}, (e) => {
    e.emitReasoning('Thinking Process: 1. Analyze');
    e.emitContent("</think>\n\nI'd be happy to help!");
  });
  assert.equal(r.reasoning, 'Thinking Process: 1. Analyze');
  assert.equal(r.content, "\n\nI'd be happy to help!");
});

test('emitter: a forced close tag split across chunks is still swallowed', () => {
  const r = emitTo({}, (e) => {
    e.emitReasoning('some thought');
    e.emitContent('</thi');
    e.emitContent('nk>Answer here.');
  });
  assert.equal(r.content, 'Answer here.');
});

test('emitter: an answer that talks about a closing tag keeps it', () => {
  // The swallow is scoped to the very start of the answer, so a real mention of
  // the tag further in is never eaten.
  const r = emitTo({}, (e) => {
    e.emitReasoning('thinking');
    e.emitContent('You close a thought with ');
    e.emitContent('</think> in most models.');
  });
  assert.equal(r.content, 'You close a thought with </think> in most models.');
});

test('emitter: with no reasoning at all the tag is left exactly where it is', () => {
  const r = emitTo({}, (e) => { e.emitContent('</think> stays put.'); });
  assert.equal(r.content, '</think> stays put.');
  assert.equal(r.reasoning, '');
});

test('emitter: inline think tags in the content stream still split normally', () => {
  const r = emitTo({}, (e) => { e.emitContent('<think>hidden</think>Visible answer.'); });
  assert.equal(r.reasoning, 'hidden');
  assert.equal(r.content, 'Visible answer.');

  const chunked = emitTo({}, (e) => {
    e.emitContent('<thi'); e.emitContent('nk>hid'); e.emitContent('den</thi'); e.emitContent('nk>out');
  });
  assert.equal(chunked.reasoning, 'hidden');
  assert.equal(chunked.content, 'out');
});

test('emitter: a second thinking block after an answer still opens normally', () => {
  const r = emitTo({}, (e) => {
    e.emitReasoning('first');
    e.emitContent('Answer one. <think>second</think> Answer two.');
  });
  assert.equal(r.reasoning, 'firstsecond');
  assert.equal(r.content, 'Answer one.  Answer two.');
});

test('emitter: custom think tokens are honoured on both paths', () => {
  const model = { think_open: '<reasoning>', think_close: '</reasoning>' };
  const inline = emitTo(model, (e) => { e.emitContent('<reasoning>r</reasoning>c'); });
  assert.equal(inline.reasoning, 'r');
  assert.equal(inline.content, 'c');

  const forced = emitTo(model, (e) => { e.emitReasoning('r'); e.emitContent('</reasoning>c'); });
  assert.equal(forced.content, 'c', 'the configured close tag is the one swallowed');

  const other = emitTo(model, (e) => { e.emitReasoning('r'); e.emitContent('</think>c'); });
  assert.equal(other.content, '</think>c', 'a tag this model never uses is not touched');
});

test('emitter: providers that only ever send structured reasoning are unaffected', () => {
  const r = emitTo({}, (e) => {
    e.emitReasoning('Let me think.');
    e.emitContent('Here is the answer.');
  });
  assert.equal(r.reasoning, 'Let me think.');
  assert.equal(r.content, 'Here is the answer.');
});

// --- attachments: what the model can actually see -------------------------
// These four branches had no coverage at all, which is how a hard-coded
// extension list came to decide whether a file reached the model.

test('looksTextual decides by bytes, not by extension', () => {
  assert.equal(looksTextual(Buffer.from('[tool.poetry]\nname = "x"\n')), true, 'toml');
  assert.equal(looksTextual(Buffer.from('fun main() { println("hi") }')), true, 'kotlin');
  assert.equal(looksTextual(Buffer.from('héllo wörld — ok')), true, 'utf-8 accents');
  assert.equal(looksTextual(Buffer.from('%PDF-1.7\n')), false, 'pdf magic');
  assert.equal(looksTextual(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])), false, 'zip/docx magic');
  assert.equal(looksTextual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), false, 'png');
  assert.equal(looksTextual(Buffer.from([65, 66, 0, 67])), false, 'a NUL means binary');
  assert.equal(looksTextual(Buffer.alloc(0)), false, 'empty');
});

test('isZipOfficeDoc recognises the zip-container office formats', () => {
  assert.equal(isZipOfficeDoc('report.docx'), true);
  assert.equal(isZipOfficeDoc('deck.pptx'), true);
  assert.equal(isZipOfficeDoc('notes.txt'), false);
});

// --- release metadata -----------------------------------------------------
// The version panel used to find its content by running a regex over a static asset
// directory, so which file won depended on readdir order. Resolution is explicit now,
// and these are the two pure halves of it.

test('releaseCandidates walks from the exact version down to the major line', () => {
  assert.deepEqual(releaseCandidates('27.1.0-developer.20'), ['27.1.0', '27.1', '27']);
  assert.deepEqual(releaseCandidates('27.1.0'), ['27.1.0', '27.1', '27']);
  assert.deepEqual(releaseCandidates('27'), ['27']);
  assert.deepEqual(releaseCandidates('0.0.0'), ['0.0.0', '0.0', '0']);
});

test('releaseCandidates refuses anything that is not a dotted number', () => {
  for (const bad of ['', null, undefined, 'latest', '../etc', '27.x', 'v27.1.0']) {
    assert.deepEqual(releaseCandidates(bad), [], String(bad));
  }
});

test('parseManifest keeps the known fields and warns about the rest', () => {
  const warns = [];
  const m = parseManifest('{"codename":"Cascade","released":"2026-08-16","icon":"icon.png"}', (w) => warns.push(w));
  assert.deepEqual(m, { codename: 'Cascade', released: '2026-08-16', icon: 'icon.png' });
  assert.deepEqual(warns, []);
});

test('parseManifest names a misspelled field instead of rendering a blank panel', () => {
  const warns = [];
  parseManifest('{"codeName":"Cascade"}', (w) => warns.push(w));
  assert.equal(warns.length, 1);
  assert.match(warns[0], /codeName/);
});

test('parseManifest drops a malformed date rather than showing it raw', () => {
  const warns = [];
  const m = parseManifest('{"released":"16/08/2026"}', (w) => warns.push(w));
  assert.equal(m.released, '');
  assert.match(warns[0], /YYYY-MM-DD/);
});

test('parseManifest refuses an icon that tries to leave the release folder', () => {
  for (const icon of ['../../../etc/passwd', '/etc/hosts', 'sub/dir/icon.png', 'icon.exe', 'icon']) {
    const warns = [];
    const m = parseManifest(JSON.stringify({ icon }), (w) => warns.push(w));
    assert.equal(m.icon, '', icon);
    assert.equal(warns.length, 1, icon);
  }
});

test('parseManifest survives a file that is not JSON at all', () => {
  const warns = [];
  assert.equal(parseManifest('# not json', (w) => warns.push(w)), null);
  assert.equal(parseManifest('[1,2]', () => {}), null, 'an array is not a manifest');
  assert.equal(warns.length, 1);
});

test('remapBrandPath moves the seeded logo paths and nothing else', () => {
  assert.equal(remapBrandPath('/starburst.svg'), '/brand/starburst.svg');
  assert.equal(remapBrandPath('/starburst-generating.svg'), '/brand/starburst-generating.svg');
  assert.equal(remapBrandPath('/starburst-thinking.svg'), '/brand/starburst-thinking.svg');
});

test('remapBrandPath leaves an operator upload alone', () => {
  for (const v of ['/uploads/mine.png', '/brand/starburst.svg', 'starburst.svg', '/starburst.svg?v=2', '', null, undefined, 42, {}]) {
    assert.equal(remapBrandPath(v), v, String(v));
  }
  assert.equal(remapBrandPath('constructor'), 'constructor', 'the table is null-prototyped');
});

// --- continuing a turn the model ended too early -------------------------
// A step with no tool call ends the turn. When the model announced the next
// step and then stopped without taking it, that is a stall, not an answer.
// The detector must be narrow: stopping is always safe, continuing is not.

test('announcedMoreWork spots a turn that stopped mid-plan', () => {
  assert.equal(announcedMoreWork("I'll create the remaining files now."), true);
  assert.equal(announcedMoreWork("Now I'll create all the files with real content."), true);
  assert.equal(announcedMoreWork('Let me view the test file and show the tree.'), true);
  assert.equal(announcedMoreWork("Created Cargo.toml.\n\nNext I'll add the source files."), true);
  assert.equal(announcedMoreWork("I'm going to run the tests."), true);
});

test('announcedMoreWork leaves a finished or hand-back turn alone', () => {
  assert.equal(announcedMoreWork('All the files are created. Let me know if you want anything else.'), false);
  assert.equal(announcedMoreWork('Would you like me to add tests?'), false);
  assert.equal(announcedMoreWork("That's everything you asked for."), false);
  assert.equal(announcedMoreWork('Done.'), false);
  assert.equal(announcedMoreWork('The script sums the integers in a file.'), false);
  assert.equal(announcedMoreWork(''), false);
  assert.equal(announcedMoreWork(null), false);
});

test('announcedMoreWork ignores an intent that was already carried out', () => {
  // Stated up front, then done — the tail is what decides, not the opening line.
  const s = "I'll create the config file.\n\nAll three files are created and the tests pass.";
  assert.equal(announcedMoreWork(s), false);
});

test('announcedMoreWork treats a trailing question as a hand-back whatever precedes it', () => {
  assert.equal(announcedMoreWork("I'll add the parser next. Should I also wire up the CLI?"), false);
});


// A stop should not leave a build or a test run grinding away until its timeout.
// The signal handed to bash kills the child the same way the timeout does, and
// whatever it printed before dying still comes back so the transcript is honest.
test('stopping kills a running command instead of waiting out its timeout', async () => {
  const chatId = 'shell-stop-' + Date.now();
  const ac = new AbortController();
  const started = Date.now();
  // A command that would otherwise run far longer than the stop.
  const slow = process.platform === 'win32'
    ? 'ping -n 30 127.0.0.1 > nul'
    : 'sleep 30';
  const run = bash(chatId, slow, 60000, undefined, ac.signal);
  setTimeout(() => ac.abort(), 300);
  const r = await run;
  const elapsed = Date.now() - started;
  assert.equal(r.ok, false);
  assert.match(String(r.error || ''), /stopped by the user/i, JSON.stringify(r));
  assert.ok(elapsed < 15000, 'returned promptly rather than at the timeout: ' + elapsed + 'ms');
});

test('an already-aborted signal stops a command before it can run away', async () => {
  const chatId = 'shell-stop-pre-' + Date.now();
  const ac = new AbortController();
  ac.abort();
  const slow = process.platform === 'win32' ? 'ping -n 30 127.0.0.1 > nul' : 'sleep 30';
  const r = await bash(chatId, slow, 60000, undefined, ac.signal);
  assert.equal(r.ok, false);
  assert.match(String(r.error || ''), /stopped by the user/i, JSON.stringify(r));
});


// --- replaying past tool activity ----------------------------------------
// Tool calls used to be replayed as one "(tool already run: ...)" marker per
// call, inline in the assistant's own message. A turn with thirty calls came
// back as thirty lines the model appeared to have written itself, and asked to
// continue it wrote more of them instead of calling anything. The replay is now
// a single trailing note with no pattern to extend.

const oqr = (call, result) =>
  '[[OQR:' + Buffer.from(JSON.stringify({ call, result }), 'utf8').toString('base64') + ']]';

test('historyText collapses many tool calls into one note, not a list', () => {
  let content = 'Working through the files.\n';
  for (let i = 1; i <= 12; i++) {
    content += oqr({ tool: 'create_file', path: 'lib/a' + i + '.py' }, { ok: true });
    content += oqr({ tool: 'bash', cmd: 'python lib/a' + i + '.py' }, { ok: true });
  }
  const out = historyText(content);
  assert.equal(out.includes('tool already run'), false, 'the imitable per-call marker is gone');
  assert.equal((out.match(/create_file/g) || []).length, 1, 'named once, not once per call');
  assert.ok(out.includes('create_file ×12'), 'counted: ' + out);
  assert.ok(out.includes('bash ×12'));
  assert.ok(out.includes('Working through the files.'), 'the real prose survives');
  // The whole point: nothing repeating for the model to continue.
  assert.ok(out.split('\n').length < 6, 'stays compact: ' + JSON.stringify(out));
});

test('historyText reports failures and keeps a single-call turn readable', () => {
  const content = 'Trying it.' + oqr({ tool: 'bash', cmd: 'pytest' }, { ok: false, error: 'boom' });
  const out = historyText(content);
  assert.ok(out.includes('bash'), out);
  assert.equal(out.includes('×'), false, 'one call is not given a multiplier');
  assert.ok(out.includes('1 failed'), out);
});

test('historyText leaves a turn with no tool activity completely alone', () => {
  const plain = 'Just a normal reply with no tools.';
  assert.equal(historyText(plain), plain);
  assert.equal(historyText(''), '');
});


// --- stopping a turn ------------------------------------------------------
// Every step registers a fresh AbortController, so aborting the current one
// cannot end the turn: a stop that lands while a tool is running hits a spent
// controller and the loop starts another step. The stop flag is what the loop
// actually checks, so it has to outlive the controller and be cleared with the
// turn — a leaked flag would kill the NEXT reply in that chat before it began.

test('a stop flag survives independently of the per-step abort controller', () => {
  const chatId = 'chat-stop-1';
  stops.delete(chatId);
  assert.equal(stops.has(chatId), false);
  stops.add(chatId);
  // Whatever happens to the controllers, the request to stop still stands.
  assert.equal(stops.has(chatId), true, 'the flag is not tied to a controller');
  stops.delete(chatId);
});

test('ending a turn clears its stop flag so the next reply is not killed', () => {
  const chatId = 'chat-stop-2';
  beginTurn('user-1', chatId, 'model-1');
  stops.add(chatId);
  endTurn(chatId);
  assert.equal(stops.has(chatId), false, 'a leaked flag would stop the next turn instantly');
});


// A stop can arrive with nothing left to cancel — the turn finished in the gap
// between the click and the socket message. Nothing clears the flag in that
// case, so the turn that follows would be killed before its first step. Turns
// therefore clear the flag as they start, which is what this pins down.
test('a stop with no turn running does not kill the next turn', () => {
  const chatId = 'chat-stop-3';
  // Turn one finishes normally, then a late stop lands.
  beginTurn('user-1', chatId, 'model-1');
  endTurn(chatId);
  stops.add(chatId);
  assert.equal(stops.has(chatId), true, 'the late stop is recorded with nothing to cancel');

  // Turn two starts: runCompletion clears the slate before its first step.
  stops.delete(chatId);
  assert.equal(stops.has(chatId), false, 'the next turn starts un-stopped');
});


// --- tool calls on the wire ----------------------------------------------
// llama.cpp's /apply-template rejects a tool call without `type` and
// `function` ("Missing tool call type"), and the token counter posts the same
// conversation there. A 500 makes it fall back to an estimated prompt size on
// exactly the turns that carry tool calls, so both paths share one conversion.

test('wireToolCalls emits the OpenAI shape, not the internal one', () => {
  const [c] = wireToolCalls('openai', [{ id: 'abc', name: 'create_file', argsText: '{"path":"a.txt"}' }]);
  assert.equal(c.type, 'function', 'llama.cpp rejects a call with no type');
  assert.equal(c.function.name, 'create_file');
  assert.equal(c.function.arguments, '{"path":"a.txt"}', 'openai wants arguments as a string');
  assert.equal(c.id, 'abc');
  assert.equal('argsText' in c, false, 'the internal field must not reach the wire');
  assert.equal('name' in c, false);
});

test('wireToolCalls gives ollama parsed arguments and fills a missing id', () => {
  const [c] = wireToolCalls('ollama', [{ name: 'view', argsText: '{"path":"a.txt"}' }]);
  assert.deepEqual(c.function.arguments, { path: 'a.txt' }, 'ollama wants an object');
  assert.equal(typeof c.id, 'string');
  assert.ok(c.id.length > 0, 'an id is invented rather than sent empty');
});

test('normalizeMessages routes assistant tool calls through the same conversion', () => {
  const out = normalizeMessages('openai', [
    { role: 'assistant', content: '', tool_calls: [{ id: 'x', name: 'bash', argsText: '{"cmd":"ls"}' }] },
    { role: 'tool', tool_call_id: 'x', name: 'bash', content: 'ok' }
  ]);
  assert.equal(out[0].tool_calls[0].type, 'function');
  assert.equal(out[0].content, null, 'an empty assistant turn sends null, not ""');
  assert.equal(out[1].tool_call_id, 'x');
});


// --- viewing unknown file types ------------------------------------------
// The extension allowlist decides what gets versioned and diffed. Viewing asks a
// looser question, so a file the list has never heard of still opens rather than
// being a download-only dead end.

test('a file the extension list rejects is still recognised as text by its bytes', () => {
  for (const name of ['config.abc', 'Procfile', 'notes', 'data.custom']) {
    assert.equal(isText(name), false, name + ' is not on the extension list');
  }
  assert.equal(looksTextual(Buffer.from('key = value\nother = 2\n')), true);
  assert.equal(looksTextual(Buffer.from('web: node app.js\n')), true);
});




test('normalizeSchedule clamps every field and falls back on nonsense', () => {
  assert.deepEqual(normalizeSchedule(null), { kind: 'daily', hour: 9, minute: 0 });
  assert.deepEqual(normalizeSchedule({ kind: 'nope' }), { kind: 'daily', hour: 9, minute: 0 });
  assert.deepEqual(normalizeSchedule({ kind: 'daily', hour: 99, minute: -4 }), { kind: 'daily', hour: 23, minute: 0 });
  assert.equal(normalizeSchedule({ kind: 'interval', everyMinutes: 1 }).everyMinutes, 5, 'a 1-minute interval is floored to 5');
  assert.equal(normalizeSchedule({ kind: 'weekly', weekday: 12 }).weekday, 6);
  assert.equal(normalizeSchedule({ kind: 'daily', hour: 'x' }).hour, 9);
  assert.equal(normalizeSchedule([]).kind, 'daily', 'an array is not a schedule object');
});

test('nextRun always lands in the future and on an allowed day', () => {
  const base = new Date(2026, 7, 21, 12, 0, 0).getTime(); // a Friday, midday
  const daily = nextRun({ kind: 'daily', hour: 9, minute: 30 }, base);
  assert.ok(daily > base);
  assert.equal(new Date(daily).getHours(), 9);
  assert.equal(new Date(daily).getMinutes(), 30);

  const weekdays = nextRun({ kind: 'weekdays', hour: 8, minute: 0 }, base);
  const day = new Date(weekdays).getDay();
  assert.ok(day >= 1 && day <= 5, 'weekdays never resolves to a weekend');

  const weekly = nextRun({ kind: 'weekly', weekday: 3, hour: 16, minute: 0 }, base);
  assert.equal(new Date(weekly).getDay(), 3);
  assert.ok(weekly > base);

  assert.equal(nextRun({ kind: 'interval', everyMinutes: 60 }, base), base + 3600000);
  assert.equal(nextRun({ kind: 'once', at: base - 1000 }, base), 0, 'a past one-shot is not rescheduled');
  assert.equal(nextRun({ kind: 'once', at: base + 1000 }, base), base + 1000);
});

test('isDue ignores disabled and unscheduled tasks', () => {
  const at = 1000;
  assert.equal(isDue({ enabled: 1, next_run: 999 }, at), true);
  assert.equal(isDue({ enabled: 1, next_run: 1001 }, at), false);
  assert.equal(isDue({ enabled: 0, next_run: 1 }, at), false);
  assert.equal(isDue({ enabled: 1, next_run: 0 }, at), false, 'next_run 0 means never');
  assert.equal(isDue(null, at), false);
});

test('a SKILL.md round-trips through parse and build', () => {
  const body = ['# Brand voice', '', 'Use this when writing.'].join('\n');
  const file = buildSkillFile({ name: 'Brand Voice!', description: 'Keeps drafts in my voice', body });
  assert.match(file, /^---\nname: brand-voice\ndescription: Keeps drafts in my voice\n---\n/);

  const back = parseSkillFile(file);
  assert.equal(back.name, 'brand-voice');
  assert.equal(back.description, 'Keeps drafts in my voice');
  assert.equal(back.body, body);
  assert.equal(back.hasFrontmatter, true);
});

test('parseSkillFile survives what an uploaded file actually looks like', () => {
  const bare = parseSkillFile(['# Just a heading', '', 'no frontmatter here'].join('\n'));
  assert.equal(bare.hasFrontmatter, false);
  assert.equal(bare.name, '', 'a name is never invented from the body');
  assert.equal(bare.body, ['# Just a heading', '', 'no frontmatter here'].join('\n'));

  const quoted = parseSkillFile(['---', 'name: "my-skill"', "description: 'quoted, with a comma'", '---', 'body'].join('\n'));
  assert.equal(quoted.name, 'my-skill', 'quotes are stripped');
  assert.equal(quoted.description, 'quoted, with a comma');

  const folded = parseSkillFile(['---', 'name: wrapped', 'description: first line', '  continued on the next', '---', 'body'].join('\n'));
  assert.equal(folded.description, 'first line continued on the next', 'an indented continuation folds into the value');

  const crlf = parseSkillFile(['---', 'name: crlf-skill', 'description: d', '---', 'body'].join('\r\n'));
  assert.equal(crlf.name, 'crlf-skill', 'CRLF frontmatter parses');

  const bom = parseSkillFile('﻿' + ['---', 'name: bom-skill', 'description: d', '---', 'body'].join('\n'));
  assert.equal(bom.name, 'bom-skill', 'a leading BOM does not hide the frontmatter');

  const proto = parseSkillFile(['---', 'name: ok-name', 'constructor: nope', '---', 'body'].join('\n'));
  assert.equal(proto.name, 'ok-name', 'a frontmatter key named constructor cannot reach Object.prototype');
});

test('skill names are normalised and validated at the boundary', () => {
  assert.equal(normalizeName('  My Skill!!  '), 'my-skill');
  assert.equal(normalizeName('---a---'), 'a');
  assert.equal(normalizeName('Skill 2.0'), 'skill-2-0');

  assert.ok(validate({ name: 'x', body: 'b' }).error, 'a one-character name is refused');
  assert.ok(validate({ name: 'ok-name', body: '   ' }).error, 'empty instructions are refused');
  assert.ok(validate({ name: 'taken', body: 'b' }, ['taken']).error, 'a duplicate name is refused');

  const ok = validate({ name: 'Good Name', description: ['line one', 'line two'].join('\n'), body: 'b' });
  assert.equal(ok.name, 'good-name');
  assert.equal(ok.description, 'line one line two', 'a description never carries a newline into the frontmatter');
  assert.equal(ok.enabled, true);
});

test('openFence tracks which code fence is still open', () => {
  assert.equal(openFence(''), null);
  assert.equal(openFence('just prose'), null);
  assert.deepEqual(openFence('```js\nconst a = 1;'), { mark: '`', len: 3 });
  assert.equal(openFence('```js\nconst a = 1;\n```'), null, 'a matching close ends it');
  assert.deepEqual(openFence('~~~\nyaml: here'), { mark: '~', len: 3 }, 'tildes open a fence too');
  assert.deepEqual(openFence('```\na\n~~~'), { mark: '`', len: 3 }, 'the other character does not close it');
  assert.equal(openFence('````\na\n`````'), null, 'a longer closing run is still a close');
  assert.deepEqual(openFence('`````\na\n```'), { mark: '`', len: 5 }, 'but a shorter one is not');
  assert.deepEqual(openFence('```js\na\n``` trailing'), { mark: '`', len: 3 }, 'a close may not carry text');
  assert.equal(openFence('   ```\na\n   ```'), null, 'up to three spaces of indent is still a fence');
  assert.equal(openFence('Use ``` to open a block.'), null, 'a backtick run inside a sentence is not a fence');
  assert.deepEqual(openFence('```\na\n```\n```py\nb'), { mark: '`', len: 3 }, 'the last one wins');
});

test('seamFor closes the reply off so the next block starts clean', () => {
  assert.equal(seamFor(''), '', 'nothing written, nothing to close');
  assert.equal(seamFor('   \n  '), '', 'whitespace only is nothing written');
  assert.equal(seamFor('half a senten'), '\n\n', 'finish the line, then leave a blank one');
  assert.equal(seamFor('done.\n'), '\n', 'already at a line end, so only the blank line');
  assert.equal(seamFor('done.\n\n'), '', 'already separated');
  assert.equal(seamFor('```js\nconst a = 1;'), '\n```\n\n', 'an open fence is closed before the blank line');
  assert.equal(seamFor('~~~\nkey: val'), '\n~~~\n\n', 'with the character it was opened with');
  assert.equal(seamFor('````\nx'), '\n````\n\n', 'and at the length it was opened with');
  assert.match(seamFor('```js\nconst a = 1;'), /\n$/, 'a seam always ends on a new line');
});

test('a steer tells the model whether anything is already on screen', () => {
  const before = steerInstruction(['be terser'], false, false);
  assert.match(before, /Before you wrote anything/);
  assert.match(before, /- be terser/);
  assert.doesNotMatch(before, /cannot be taken back/, 'nothing to warn about yet');

  const during = steerInstruction(['be terser', 'use python'], true, false);
  assert.match(during, /interrupted you mid-reply/);
  assert.match(during, /- be terser\n- use python/, 'every note is listed');
  assert.match(during, /closed off cleanly/);

  const inBlock = steerInstruction(['stop'], true, true);
  assert.match(inBlock, /do not write a closing fence/, 'the seam already closed it');
});

test('the loop guard stops a turn repeating one failing call', () => {
  const g = createLoopGuard();
  const call = [{ name: 'bash', argsText: '{"cmd":"nope"}' }];
  assert.equal(g.note({ calls: call, ok: 0, failed: 1, failKinds: ['bash:not_found'] }), false, 'once is not a loop');
  assert.equal(g.note({ calls: call, ok: 0, failed: 1, failKinds: ['bash:not_found'] }), true, 'the identical call twice is');
});

test('the loop guard catches the same failure behind wobbling arguments', () => {
  const g = createLoopGuard();
  const kinds = ['bash:not_found'];
  assert.equal(g.note({ calls: [{ name: 'bash', argsText: 'a' }], ok: 0, failed: 1, failKinds: kinds }), false);
  assert.equal(g.note({ calls: [{ name: 'bash', argsText: 'b' }], ok: 0, failed: 1, failKinds: kinds }), false);
  assert.equal(g.note({ calls: [{ name: 'bash', argsText: 'c' }], ok: 0, failed: 1, failKinds: kinds }), true);
});

test('the loop guard resets the moment anything works', () => {
  const g = createLoopGuard();
  const kinds = ['bash:not_found'];
  g.note({ calls: [{ name: 'bash', argsText: 'a' }], ok: 0, failed: 1, failKinds: kinds });
  g.note({ calls: [{ name: 'bash', argsText: 'b' }], ok: 0, failed: 1, failKinds: kinds });
  assert.equal(g.note({ calls: [{ name: 'bash', argsText: 'c' }], ok: 1, failed: 0, failKinds: [] }), false,
    'a successful step is progress');
  assert.equal(g.note({ calls: [{ name: 'bash', argsText: 'd' }], ok: 0, failed: 1, failKinds: kinds }), false,
    'and the count started over');
});

test('the loop guard leaves a step that failed differently each time alone', () => {
  const g = createLoopGuard();
  assert.equal(g.note({ calls: [{ name: 'bash', argsText: 'a' }], ok: 0, failed: 1, failKinds: ['bash:not_found'] }), false);
  assert.equal(g.note({ calls: [{ name: 'bash', argsText: 'b' }], ok: 0, failed: 1, failKinds: ['bash:timeout'] }), false);
  assert.equal(g.note({ calls: [{ name: 'bash', argsText: 'c' }], ok: 0, failed: 1, failKinds: ['bash:blocked'] }), false,
    'a model working through different problems is making progress');
});

test('the loop guard ignores a step that made no calls at all', () => {
  const g = createLoopGuard();
  assert.equal(g.note({ calls: [], ok: 0, failed: 0, failKinds: [] }), false);
  assert.equal(g.note({ calls: [], ok: 0, failed: 0, failKinds: [] }), false, 'no calls is not a failing loop');
});

test('the client and server copies of the tool protocol stay byte-identical', () => {
  // Both sides parse the same wire format: the server records tool calls with scanTools
  // and the client renders them with its own copy. If the two drift, a call the model
  // makes is stored one way and drawn another, so the copies are compared here.
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const repo = path.dirname(root);
  const server = fs.readFileSync(path.join(root, 'toolproto.js'), 'utf8');
  const client = fs.readFileSync(path.join(repo, 'client', 'src', 'toolproto.js'), 'utf8');
  assert.equal(client, server, 'client/src/toolproto.js and server/toolproto.js must be kept identical');
});

/* ---------- theme documents ---------- */

test('a theme document only keeps properties the builder can produce', () => {
  const doc = sanitizeDoc({
    basePreset: 'openai',
    tokens: { color: { accent: '#4f9cf9' }, bogus: { x: 'y' } },
    content: { 'nav.new': 'Start', '  ': 'dropped' },
    elements: {
      greeting: { style: { fontSize: '40px', position: 'fixed', notACssProp: '1' }, hidden: true, order: 3 },
      empty: { style: {} }
    },
    slots: { 'sidebar.top': [{ id: 'n1', type: 'note', props: { text: 'hi' } }] },
    css: '.x { color: red }'
  });
  assert.equal(doc.basePreset, 'openai');
  // An unrecognised group is carried, not dropped: the client registry decides
  // what renders, so an older server must still be able to hold a newer theme.
  assert.deepEqual(doc.tokens, { color: { accent: '#4f9cf9' }, bogus: { x: 'y' } });
  assert.deepEqual(doc.content, { 'nav.new': 'Start' });
  assert.deepEqual(doc.elements.greeting.style, { fontSize: '40px', position: 'fixed' });
  assert.equal(doc.elements.greeting.hidden, true);
  assert.equal(doc.elements.greeting.order, 3);
  assert.equal('empty' in doc.elements, false, 'an element with nothing set is not stored');
  assert.equal(doc.slots['sidebar.top'][0].type, 'note');
});

test('a theme document cannot smuggle anything out of a css declaration', () => {
  const doc = sanitizeDoc({
    elements: {
      greeting: {
        style: {
          color: 'red} body{display:none',
          background: 'url(https://evil.example/x.png)',
          fontFamily: 'a; behavior: url(x)',
          borderColor: 'expression(alert(1))',
          backgroundImage: 'javascript:alert(1)'
        }
      }
    }
  });
  assert.equal(doc.elements.greeting, undefined, 'every unsafe value is dropped, leaving nothing to store');
});

test('a theme document survives a hostile shape without throwing', () => {
  for (const raw of [null, 'nope', 42, [], { elements: 'x', tokens: [], slots: 7, content: null }]) {
    const doc = sanitizeDoc(raw);
    assert.deepEqual(doc.elements, {});
    assert.deepEqual(doc.tokens, {});
    assert.deepEqual(doc.slots, {});
    assert.equal(doc.basePreset, 'anthropic', 'an unrecognised preset falls back rather than propagating');
  }
});

test('theme element states and breakpoints are limited to the ones the inspector offers', () => {
  const doc = sanitizeDoc({
    elements: {
      navItem: {
        states: { hover: { color: '#fff' }, onMars: { color: '#f00' } },
        responsive: { mobile: { hidden: true }, watch: { hidden: true } },
        animation: { name: 'fade', duration: 99999, delay: -5, easing: 'ease-out' }
      }
    }
  });
  const el = doc.elements.navItem;
  assert.deepEqual(Object.keys(el.states), ['hover']);
  assert.deepEqual(Object.keys(el.responsive), ['mobile']);
  assert.equal(el.animation.duration, 5000, 'a duration is capped rather than rejected');
  assert.equal(el.animation.delay, 0);
});

test('the unpublished counter counts what actually differs, not what a theme sets', () => {
  const published = { elements: { sidebar: { style: { width: '260px', color: 'red' } } }, tokens: { color: { accent: '#111' } } };
  // Same document, so an admin who has published everything is told exactly that
  // rather than being shown the size of their design.
  assert.equal(docDiffCount(published, JSON.parse(JSON.stringify(published))), 0);

  const staged = { elements: { sidebar: { style: { width: '300px', color: 'red' }, hidden: true } }, tokens: { color: { accent: '#111' } } };
  assert.equal(docDiffCount(published, staged), 2);

  // A theme that has never been published counts as entirely new.
  assert.equal(docDiffCount({}, published), 3);
});

test('the Blank layout ships as a preset that keeps a member’s own theme working', () => {
  const doc = blankLayoutDoc();
  assert.equal(doc.basePreset, 'anthropic', 'Blank is the plain preset with its decoration turned down');
  assert.ok(Object.keys(doc.elements).length > 5);
  // A literal colour would freeze the interface into one palette and make the
  // light/dark preference inert, which is the one thing a base layout must not do.
  const values = [
    ...Object.values(doc.tokens).flatMap(g => Object.values(g)),
    ...Object.values(doc.elements).flatMap(el => Object.values(el.style || {}))
  ];
  for (const v of values) {
    assert.ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(v), 'Blank must not hardcode a colour, found: ' + v);
  }
});

test('an existing workspace picks up a builtin layout it predates', () => {
  const older = { v: 1, activeId: 'anthropic', themes: [
    { id: 'anthropic', name: 'Anthropic', basePreset: 'anthropic', builtin: true, doc: {} },
    { id: 'openai', name: 'OpenAI', basePreset: 'openai', builtin: true, doc: {} }
  ] };
  const store = normalizeStoreForTest(older);
  const ids = store.themes.map(t => t.id);
  assert.ok(ids.includes('blank'), 'the seed list is what decides which layouts ship');
  assert.equal(store.activeId, 'anthropic', 'topping up never changes which theme is live');
  assert.equal(store.themes.find(t => t.id === 'anthropic').note, 'The native layout',
    'a builtin blurb comes from the seed list, not from whatever an older store saved');
});

test('extractZip: the entry cap counts dependency files too', async () => {
  // The regression: files under node_modules/dist/.git are hidden from listings,
  // so the counter that enforced the 5000-entry cap never grew for them. A zip of
  // a project folder with its dependencies wrote every entry, bounded only by the
  // byte cap - which for thousands of tiny files is no bound at all.
  const chatId = 'ziptest-' + Date.now();
  const entries = [];
  for (let i = 0; i < 6000; i++) entries.push({ name: `node_modules/pkg${i}/index.js`, data: Buffer.from('x') });
  entries.push({ name: 'app.js', data: Buffer.from('real file') });

  const zipPath = 'bundle.zip';
  sandboxFiles.importBuffer(chatId, zipPath, zipBuffer(entries));
  const r = sandboxFiles.extractZip(chatId, zipPath);
  try {
    assert.equal(r.ok, true);
    assert.ok(r.deps <= 5000, `wrote ${r.deps} dependency files, expected the 5000 cap to hold`);
    assert.ok(r.skipped !== 0 || r.note, 'the caller is told entries were skipped');
    const listed = sandboxFiles.list(chatId, { all: true });
    assert.ok(listed.length <= 5002, `${listed.length} files on disk, expected the cap to bound it`);
  } finally {
    sandboxFiles.remove(chatId);
  }
});

test('extractZip: an ordinary archive still extracts whole', async () => {
  const chatId = 'ziptest2-' + Date.now();
  sandboxFiles.importBuffer(chatId, 'small.zip', zipBuffer([
    { name: 'a.txt', data: Buffer.from('hello') },
    { name: 'src/b.js', data: Buffer.from('const x = 1;') },
    { name: 'node_modules/dep/i.js', data: Buffer.from('dep') }
  ]));
  const r = sandboxFiles.extractZip(chatId, 'small.zip');
  try {
    assert.equal(r.ok, true);
    assert.equal(r.count, 2, 'two listed files');
    assert.equal(r.deps, 1, 'the dependency file was written but hidden');
    assert.equal(sandboxFiles.readText(chatId, 'a.txt'), 'hello');
    assert.equal(sandboxFiles.readText(chatId, 'node_modules/dep/i.js'), 'dep');
  } finally {
    sandboxFiles.remove(chatId);
  }
});

test('copyFile stamps every file in a copied directory', async () => {
  const chatId = 'copytest-' + Date.now();
  sandboxFiles.createFile(chatId, 'src/a.txt', 'A');
  sandboxFiles.createFile(chatId, 'src/deep/b.txt', 'B');
  sandboxFiles.createFile(chatId, 'unrelated.txt', 'C');
  const r = sandboxFiles.copyFile(chatId, 'src', 'copy');
  try {
    assert.equal(r.ok, true);
    assert.equal(r.count, 2, 'both files under the copy were versioned, and nothing outside it');
    assert.equal(sandboxFiles.readText(chatId, 'copy/a.txt'), 'A');
    assert.equal(sandboxFiles.readText(chatId, 'copy/deep/b.txt'), 'B');
  } finally {
    sandboxFiles.remove(chatId);
  }
});

test('mcpToolName: an ordinary name is just the prefix and the tool', () => {
  assert.equal(mcpToolName('files', 'read'), 'mcp_files_read');
  assert.ok(mcpToolName('files', 'read').length <= MCP_NAME_MAX);
});

test('mcpToolName: two long names on one server stay distinct', () => {
  // The regression: plain truncation collapsed these into one string, so the
  // model saw two identical function names and the second tool was unreachable.
  const slug = 'acme_data_platform_v2';
  const a = mcpToolName(slug, 'fetch_customer_subscription_billing_history_detailed');
  const b = mcpToolName(slug, 'fetch_customer_subscription_billing_history_summary');
  assert.notEqual(a, b);
  assert.ok(a.length <= MCP_NAME_MAX, `${a.length} chars`);
  assert.ok(b.length <= MCP_NAME_MAX, `${b.length} chars`);
});

test('mcpToolName is stable, so the same tool keeps the same name', () => {
  const once = mcpToolName('s', 'x'.repeat(90));
  const twice = mcpToolName('s', 'x'.repeat(90));
  assert.equal(once, twice);
});

test('mcpToolName never exceeds the cap, whatever it is given', () => {
  for (const slug of ['a', 'a'.repeat(24)]) {
    for (const tool of ['b', 'b'.repeat(80), 'weird_name_' + 'z'.repeat(200)]) {
      assert.ok(mcpToolName(slug, tool).length <= MCP_NAME_MAX, `${slug}/${tool.length}`);
    }
  }
});

test('sanitizeDocsConfig fills every field from the defaults', () => {
  const c = sanitizeDocsConfig(null);
  assert.equal(c.title, DOCS_DEFAULTS.title);
  assert.equal(c.navLabel, 'Models');
  assert.equal(c.featureLabel, 'Feature');
  assert.equal(c.tilesTitle, 'Get started');
  assert.equal(c.outro, '');
  assert.deepEqual(c.sections, []);
  assert.deepEqual(c.links, []);
  assert.deepEqual(c.tiles, []);
});

test('sanitizeDocsConfig keeps the overview tiles an admin wrote, and drops untitled ones', () => {
  const c = sanitizeDocsConfig({ tiles: [{ title: 'Quickstart', desc: 'First call', url: '/docs' }, { desc: 'no title' }] });
  assert.deepEqual(c.tiles, [{ title: 'Quickstart', desc: 'First call', url: '/docs' }]);
});

test('sanitizeDocsConfig derives a page id from the title and keeps ids unique', () => {
  const c = sanitizeDocsConfig({
    sections: [{ label: 'Guides', pages: [{ title: 'Choosing a Model' }, { title: 'Choosing a model' }, {}] }]
  });
  assert.deepEqual(c.sections[0].pages.map(p => p.id), ['choosing-a-model', 'choosing-a-model-1', 'page-3']);
  assert.equal(c.sections[0].id, 'guides');
  assert.equal(c.sections[0].pages[2].title, 'Untitled');
});

test('sanitizeDocsConfig caps the shape a client can send', () => {
  const c = sanitizeDocsConfig({
    title: 'x'.repeat(400),
    sections: Array.from({ length: 40 }, (_, i) => ({ label: 'S' + i, pages: [] })),
    links: Array.from({ length: 40 }, () => ({ label: 'l', url: 'u' }))
  });
  assert.equal(c.title.length, 120);
  assert.equal(c.sections.length, 12);
  assert.equal(c.links.length, 8);
});

test('sanitizeDocsConfig drops a link with no label, and marks external ones', () => {
  const c = sanitizeDocsConfig({ links: [{ label: '', url: 'https://x' }, { label: 'Docs', url: '/docs', ext: 1 }] });
  assert.deepEqual(c.links, [{ label: 'Docs', url: '/docs', ext: true }]);
});

test('readDocsConfig parses a stored JSON string and survives a corrupt one', () => {
  assert.equal(readDocsConfig(() => JSON.stringify({ navLabel: 'Engines' })).navLabel, 'Engines');
  assert.equal(readDocsConfig(() => '{not json').navLabel, 'Models');
  assert.equal(readDocsConfig(() => null).navLabel, 'Models');
});

test('per-model docs lists drop empty rows and cap their length', () => {
  assert.deepEqual(sanitizePairs([{ label: '', value: '' }, { label: 'Chat', value: 'x' }]), [{ label: 'Chat', value: 'x' }]);
  assert.equal(sanitizePairs(Array.from({ length: 40 }, () => ({ label: 'a' }))).length, 12);
  assert.deepEqual(sanitizeCards([{ desc: 'no title' }, { title: 'T', desc: 'D', url: 'U' }]), [{ title: 'T', desc: 'D', url: 'U' }]);
  assert.deepEqual(sanitizeStrList(['  a ', '', 'b']), ['a', 'b']);
  assert.deepEqual(sanitizeStrList('not an array'), []);
});
