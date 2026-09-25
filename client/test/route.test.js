import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, shouldResetPath, pathForChat, pathForProject, pathForLibrary, LIBRARY_PAGES } from '../src/lib/route.js';

test('parseRoute reads each screen off the path', () => {
  assert.deepEqual(parseRoute('/'), { view: 'home' });
  assert.deepEqual(parseRoute('/projects'), { view: 'projects', id: null });
  assert.deepEqual(parseRoute('/project/abc'), { view: 'project', id: 'abc' });
  assert.deepEqual(parseRoute('/chat/xyz'), { view: 'chat', id: 'xyz' });
});

test('parseRoute sends a member away from the admin-only screens', () => {
  assert.deepEqual(parseRoute('/admin', { isAdmin: true }), { view: 'admin' });
  assert.deepEqual(parseRoute('/admin'), { view: 'home', replace: '/' });
  assert.deepEqual(parseRoute('/playground'), { view: 'home', replace: '/' });
  assert.deepEqual(parseRoute('/playground', { isAdmin: true }), { view: 'playground' });
});

test('parseRoute decodes an id and survives a malformed one', () => {
  assert.equal(parseRoute('/chat/a%20b').id, 'a b');
  assert.equal(parseRoute('/chat/100%').id, '100%', 'a stray percent is kept, not thrown on');
});

test('parseRoute does not mistake a lookalike path for a screen', () => {
  assert.deepEqual(parseRoute('/administrator'), { view: 'notfound' });
  assert.deepEqual(parseRoute('/chatter'), { view: 'notfound' });
  assert.deepEqual(parseRoute(''), { view: 'home' });
  assert.deepEqual(parseRoute(null), { view: 'home' });
});

test('parseRoute answers notfound for a path no screen claims', () => {
  assert.deepEqual(parseRoute('/nope'), { view: 'notfound' });
  assert.deepEqual(parseRoute('/chat'), { view: 'notfound' }, 'a chat needs an id');
  assert.deepEqual(parseRoute('/project'), { view: 'notfound' });
  assert.deepEqual(parseRoute('/admin', { isAdmin: true }), { view: 'admin' }, 'a real screen still wins');
});

test('shouldResetPath only claims the paths its own screen owns', () => {
  assert.equal(shouldResetPath('admin', '/admin'), true);
  assert.equal(shouldResetPath('admin', '/chat/x'), false, 'user navigated away, leave the URL alone');
  assert.equal(shouldResetPath('projects', '/project/a'), true);
  assert.equal(shouldResetPath('projects', '/projects'), true);
  assert.equal(shouldResetPath('home', '/'), false);
});

test('path builders round-trip through parseRoute', () => {
  assert.equal(parseRoute(pathForChat('c1')).id, 'c1');
  assert.equal(parseRoute(pathForProject('p1')).id, 'p1');
  assert.deepEqual(parseRoute(pathForProject(null)), { view: 'projects', id: null });
  for (const page of LIBRARY_PAGES) assert.deepEqual(parseRoute(pathForLibrary(page)), { view: page });
});

test('the artifacts and scheduled pages have their own addresses', () => {
  assert.deepEqual(parseRoute('/artifacts'), { view: 'artifacts' });
  assert.deepEqual(parseRoute('/scheduled/'), { view: 'scheduled' });
  assert.deepEqual(parseRoute('/artifacts/x'), { view: 'notfound' }, 'no sub-pages exist');
  assert.equal(pathForLibrary('elsewhere'), '/');
  assert.equal(shouldResetPath('artifacts', '/artifacts'), true);
  assert.equal(shouldResetPath('scheduled', '/chat/x'), false);
});
