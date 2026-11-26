import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatsByFolder, moveId, dropPosition, dragKind, CHAT_DRAG, FOLDER_DRAG } from '../src/lib/folders.js';

const folders = [{ id: 'f1' }, { id: 'f2' }];

test('chats are filed under their folder and the rest stay loose', () => {
  const chats = [
    { id: 'a', folderId: 'f1' },
    { id: 'b', folderId: null },
    { id: 'c', folderId: 'f2' },
    { id: 'd', folderId: 'f1' },
    { id: 'e', folderId: 'gone' },
    { id: 'f', folderId: 'f1', mode: 'code' }
  ];
  const { byId, loose } = chatsByFolder(chats, folders);
  assert.deepEqual(byId.get('f1').map(c => c.id), ['a', 'd']);
  assert.deepEqual(byId.get('f2').map(c => c.id), ['c']);
  assert.deepEqual(loose.map(c => c.id), ['b', 'e', 'f'], 'a missing folder or a code session falls back to the list');
});

test('a folder with no chats still has an entry', () => {
  assert.deepEqual([...chatsByFolder([], folders).byId.keys()], ['f1', 'f2']);
});

test('moving a folder lands it before or after its target', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveId(ids, 'a', 'c', false), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveId(ids, 'a', 'c', true), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveId(ids, 'd', 'a', false), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveId(ids, 'a', 'd', true), ['b', 'c', 'd', 'a']);
});

test('moving a folder onto itself or something unknown changes nothing', () => {
  const ids = ['a', 'b'];
  assert.equal(moveId(ids, 'a', 'a', true), ids);
  assert.equal(moveId(ids, 'x', 'a', true), ids);
  assert.equal(moveId(ids, 'a', 'x', true), ids);
});

test('the drop position follows the half of the row under the pointer', () => {
  const rect = { top: 100, height: 40 };
  assert.equal(dropPosition(rect, 110), 'before');
  assert.equal(dropPosition(rect, 130), 'after');
});

test('a drag is recognised by what it carries', () => {
  assert.equal(dragKind([CHAT_DRAG, 'text/plain']), 'chat');
  assert.equal(dragKind([FOLDER_DRAG]), 'folder');
  assert.equal(dragKind(['Files']), null);
  assert.equal(dragKind(undefined), null);
});