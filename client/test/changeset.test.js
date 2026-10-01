import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChanges, valueOf, lineDiff, isMine, othersIn, areaOf } from '../src/lib/changeset.js';

const c = (o) => ({ authors: [], ...o });

test('changes group by model, theme and settings section, in a fixed area order', () => {
  const list = [
    c({ key: 'setting:disclaimer', scope: 'setting', target: 'disclaimer' }),
    c({ key: 'model:a:temperature', scope: 'model', target: 'a', field: 'temperature', label: 'Alpha' }),
    c({ key: 'setting:voice_mic_enabled', scope: 'setting', target: 'voice_mic_enabled' }),
    c({ key: 'model:a:top_p', scope: 'model', target: 'a', field: 'top_p', label: 'Alpha' }),
    c({ key: 'models:order', scope: 'model', target: null, field: 'order' }),
    c({ key: 'theme:t:doc', scope: 'theme', target: 't', field: 'doc', label: 'Ocean' })
  ];
  const areas = groupChanges(list);
  assert.deepEqual(areas.map(a => a.area), ['models', 'workspace', 'interface']);
  assert.deepEqual(areas[0].groups.map(g => [g.key, g.items.length]), [['model:a', 2], ['models:order', 1]]);
  assert.deepEqual(areas[1].groups.map(g => g.key), ['section:voice']);
  assert.deepEqual(areas[2].groups.map(g => g.key), ['section:interface', 'theme:t']);
  assert.equal(areaOf({ scope: 'setting', target: 'greetings' }), 'interface');
});

test('values read the way the panel shows them', () => {
  assert.deepEqual(valueOf({ scope: 'setting', target: 'voice_mic_enabled', before: '0', after: '1' }, 'after'), { kind: 'flag', on: true });
  assert.deepEqual(valueOf({ scope: 'model', field: 'sandbox_allowed', before: null, after: 0 }, 'before'), { kind: 'flag', on: true }, 'an inverted flag defaults on');
  assert.deepEqual(valueOf({ scope: 'setting', target: 'greetings', after: '["Hi","Hello"]' }, 'after'), { kind: 'list', items: ['Hi', 'Hello'] });
  assert.deepEqual(valueOf({ scope: 'setting', target: 'quick_prompts', after: '[]' }, 'after'), { kind: 'empty' });
  assert.deepEqual(valueOf({ scope: 'setting', target: 'api_key', secret: true, after: null }, 'after'), { kind: 'hidden' });
  assert.equal(valueOf({ scope: 'model', field: 'system_prompt', after: 'a\nb' }, 'after').kind, 'long');
  assert.deepEqual(valueOf({ scope: 'model', field: 'temperature', before: 0.7 }, 'before'), { kind: 'text', text: '0.7' });
});

test('a line diff keeps shared lines and marks the rest', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nx\nc'), [
    { op: 'same', text: 'a' }, { op: 'del', text: 'b' }, { op: 'add', text: 'x' }, { op: 'same', text: 'c' }
  ]);
  assert.deepEqual(lineDiff('', 'new'), [{ op: 'del', text: '' }, { op: 'add', text: 'new' }]);
});

test('authorship splits mine from everyone else', () => {
  const list = [c({ authors: [{ id: 'me', name: 'Me' }] }), c({ authors: [{ id: 'sam', name: 'Sam' }, { id: 'me', name: 'Me' }] })];
  assert.equal(isMine(list[0], 'me'), true);
  assert.equal(isMine(list[0], 'sam'), false);
  assert.deepEqual(othersIn(list, 'me'), ['Sam']);
});
