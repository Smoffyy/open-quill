import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DB_DIR = path.join(SERVER_ROOT, 'data', 'databases', 'oqusagetest');

process.env.OPEN_QUILL_DB = 'oqusagetest';
fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
const { db, uid } = await import('../db.js');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);

const add = (o) => db.usage.insert({
  id: uid(), user_id: null, model_id: null, model_name: '',
  prompt: 0, completion: 0, total: 0, cost: 0, created_at: T0, ...o
});

const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);

const SEED = [
  { user_id: 'u1', model_id: 'm1', model_name: 'Alpha', prompt: 100, completion: 50, cost: 0.5, created_at: T0 },
  { user_id: 'u1', model_id: 'm1', model_name: 'Alpha', prompt: 200, completion: 60, cost: 1.25, created_at: T0 + 1000 },
  { user_id: 'u1', model_id: 'm2', model_name: 'Beta', prompt: 10, completion: 5, cost: 0.01, created_at: T0 + DAY },
  { user_id: 'u2', model_id: 'm1', model_name: 'Alpha', prompt: 7, completion: 3, cost: 0, created_at: T0 + DAY },
  { user_id: null, model_id: null, model_name: '', prompt: 1, completion: 1, cost: 0.02, created_at: T0 + 2 * DAY }
];
for (const row of SEED) add(row);

test('the usage report totals every row in the window', () => {
  const r = db.usage.report(0);
  assert.equal(r.totals.count, SEED.length);
  assert.equal(r.totals.prompt, sum(SEED, 'prompt'));
  assert.equal(r.totals.completion, sum(SEED, 'completion'));
  assert.ok(Math.abs(r.totals.cost - sum(SEED, 'cost')) < 1e-9);
  assert.equal(r.totals.users, 3, 'a null user_id is still one distinct bucket');
});

test('the usage report groups by member', () => {
  const byUser = new Map(db.usage.report(0).byUser.map(r => [r.userId, r]));
  assert.equal(byUser.get('u1').count, 3);
  assert.equal(byUser.get('u1').prompt, 310);
  assert.equal(byUser.get('u1').completion, 115);
  assert.ok(Math.abs(byUser.get('u1').cost - 1.76) < 1e-9);
  assert.equal(byUser.get('u2').count, 1);
  assert.ok(byUser.has('unknown'), 'a row with no member is reported, not dropped');
});

test('the usage report groups by model and keeps a readable name', () => {
  const byModel = new Map(db.usage.report(0).byModel.map(r => [r.modelId, r]));
  assert.equal(byModel.get('m1').count, 3);
  assert.equal(byModel.get('m1').prompt, 307);
  assert.equal(byModel.get('m1').name, 'Alpha');
  assert.equal(byModel.get('m2').name, 'Beta');
  assert.ok(byModel.has('unknown'));
});

test('the usage report groups by calendar day, oldest first', () => {
  const days = db.usage.report(0).byDay;
  assert.deepEqual(days.map(d => d.day), ['2026-01-15', '2026-01-16', '2026-01-17']);
  assert.equal(days[0].prompt, 300, 'two rows on the same day are one bucket');
  assert.equal(days[1].prompt, 17);
});

test('the usage report honours its window', () => {
  const recent = db.usage.report(T0 + DAY);
  assert.equal(recent.totals.count, 3, 'only rows at or after the cutoff');
  assert.equal(recent.totals.prompt, 18);
  assert.equal(recent.byDay.length, 2);
});

test('the usage report is empty rather than broken with nothing in range', () => {
  const none = db.usage.report(T0 + 400 * DAY);
  assert.deepEqual(none.totals, { count: 0, prompt: 0, completion: 0, cost: 0, users: 0 });
  assert.deepEqual(none.byUser, []);
  assert.deepEqual(none.byModel, []);
  assert.deepEqual(none.byDay, []);
});
