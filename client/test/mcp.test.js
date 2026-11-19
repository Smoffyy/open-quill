import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleArgs, argList, parseArgs } from '../src/lib/mcpconfig.js';

const SCHEMA = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'File to read' },
    limit: { type: 'integer', default: 20 },
    mode: { enum: ['fast', 'full'] },
    tags: { type: ['array', 'null'] },
    deep: { type: 'boolean' },
    meta: { type: 'object' },
    loose: {}
  }
};

test('a trial starts from the defaults, the first choice, or an empty value of the right type', () => {
  assert.deepEqual(exampleArgs(SCHEMA), { path: '', limit: 20, mode: 'fast', tags: [], deep: false, meta: {}, loose: '' });
  assert.deepEqual(exampleArgs(null), {});
  const a = exampleArgs(SCHEMA), b = exampleArgs(SCHEMA);
  a.tags.push('x');
  assert.deepEqual(b.tags, [], 'every template is a fresh copy');
});

test('arguments are listed with their type and whether they are required', () => {
  const list = argList(SCHEMA);
  assert.deepEqual(list[0], { name: 'path', type: 'string', description: 'File to read', required: true });
  assert.equal(list.find(a => a.name === 'tags').type, 'array | null');
  assert.equal(list.find(a => a.name === 'mode').type, 'enum');
  assert.equal(list.find(a => a.name === 'loose').type, 'any');
});

test('trial arguments must be a JSON object', () => {
  assert.deepEqual(parseArgs(''), { args: {} });
  assert.deepEqual(parseArgs('{"a":1}'), { args: { a: 1 } });
  assert.deepEqual(parseArgs('[1]'), { error: 'not-object' });
  assert.deepEqual(parseArgs('{oops'), { error: 'not-json' });
});