import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilter, matches, simpleEquality } from '../lib/scim/filter.js';
import { applyPatch, parsePath, PATCH_SCHEMA } from '../lib/scim/patch.js';

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const SCHEMAS = [USER, ENTERPRISE];
const GROUP_SCHEMAS = ['urn:ietf:params:scim:schemas:core:2.0:Group'];

const ana = {
  schemas: SCHEMAS, id: 'u1', externalId: 'Ext-1', userName: 'Ana.Lima@Corp.test', displayName: 'Ana Lima', active: true,
  name: { givenName: 'Ana', familyName: 'Lima' },
  emails: [{ value: 'ana@corp.test', type: 'work', primary: true }, { value: 'ana@home.test', type: 'home' }],
  [ENTERPRISE]: { department: 'Research', manager: { value: 'u9' } },
  meta: { created: '2026-01-02T03:04:05.000Z', lastModified: '2026-03-04T05:06:07.000Z' }
};
const hit = (filter) => matches(parseFilter(filter), ana, SCHEMAS);
const patch = (resource, ops, schemas = SCHEMAS) => applyPatch(resource, { schemas: [PATCH_SCHEMA], Operations: ops }, schemas);

test('filters cover the operators, grouping and paths identity providers send', () => {
  assert.ok(hit('userName eq "ana.lima@corp.test"'), 'userName compares without case');
  assert.ok(!hit('externalId eq "ext-1"'), 'externalId compares exactly');
  assert.ok(hit('externalId eq "Ext-1"'));
  assert.ok(hit('id eq "u1"'));
  assert.ok(hit('name.givenName sw "an"'));
  assert.ok(hit('displayName co "lim"'));
  assert.ok(hit('displayName ew "lima"'));
  assert.ok(hit('displayName ne "Bo"'));
  assert.ok(hit('active eq true'));
  assert.ok(!hit('active eq false'));
  assert.ok(hit('title pr') === false);
  assert.ok(hit('emails pr'));
  assert.ok(hit('emails.value eq "ana@home.test"'), 'a multi-valued attribute matches if any value does');
  assert.ok(hit('emails eq "ana@corp.test"'), 'a complex multi-valued attribute compares its value');
  assert.ok(hit('emails[type eq "work" and value co "corp"]'));
  assert.ok(!hit('emails[type eq "home" and value co "corp"]'), 'both conditions apply to the same element');
  assert.ok(hit(`${USER}:userName eq "ana.lima@corp.test"`), 'the core schema prefix is accepted');
  assert.ok(hit(`${ENTERPRISE}:department eq "research"`), 'enterprise extension attributes are reachable');
  assert.ok(hit(`${ENTERPRISE}:manager.value eq "u9"`));
  assert.ok(hit('meta.lastModified gt "2026-03-01T00:00:00Z"'), 'times compare as times');
  assert.ok(!hit('meta.created ge "2026-01-02T03:04:06Z"'));
  assert.ok(hit('userName eq "nobody" or (displayName sw "Ana" and not (active eq false))'));
  assert.ok(!hit('userName eq "nobody" or displayName sw "Bo" and active eq true'), 'and binds tighter than or');
  assert.ok(hit('USERNAME EQ "ana.lima@corp.test"'), 'operators and attribute names ignore case');
  assert.ok(hit('displayName eq "Ana \\"Lima\\""') === false, 'escaped quotes are read as part of the value');
});

test('filters that are malformed or abusive are refused, never guessed at', () => {
  for (const bad of ['', 'userName', 'userName eq', 'userName xx "a"', '(userName eq "a"', 'userName eq "a" junk', 'emails[type eq "work"', 'userName eq "unterminated', 'not userName eq "a"', 'userName eq bare']) {
    assert.throws(() => parseFilter(bad), e => e.status === 400 && e.scimType === 'invalidFilter', bad);
  }
  assert.throws(() => parseFilter('a eq "b" or '.repeat(150) + 'a eq "b"'), e => e.scimType === 'invalidFilter');
  assert.throws(() => parseFilter('x'.repeat(2001)), e => e.scimType === 'invalidFilter');
  assert.throws(() => hit('active gt true'), e => e.scimType === 'invalidFilter');
  assert.deepEqual(simpleEquality(parseFilter('userName eq "A@b.c"')), { path: 'username', value: 'A@b.c' });
  assert.equal(simpleEquality(parseFilter('userName sw "A"')), null);
  assert.equal(simpleEquality(parseFilter('userName eq "a" and active eq true')), null);
});

test('patch paths parse attributes, sub-attributes, filters and extensions', () => {
  assert.deepEqual(parsePath('name.givenName', SCHEMAS), { extension: null, attr: 'name', filter: null, sub: 'givenName' });
  const work = parsePath('emails[type eq "work"].value', SCHEMAS);
  assert.equal(work.attr, 'emails');
  assert.equal(work.sub, 'value');
  assert.equal(work.filter.op, 'eq');
  assert.deepEqual(parsePath(`${ENTERPRISE}:manager`, SCHEMAS), { extension: ENTERPRISE, attr: 'manager', filter: null, sub: null });
  assert.equal(parsePath('members[value eq "a]b"]', GROUP_SCHEMAS).filter.value, 'a]b', 'a bracket inside a quoted value does not end the filter');
  for (const bad of ['', 'emails[type eq "work"', 'emails[type eq "work"]x', 'a.b.c']) assert.throws(() => parsePath(bad, SCHEMAS), e => e.scimType === 'invalidPath', bad);
});

test('Entra ID user patches apply as Entra sends them', () => {
  const off = patch(ana, [{ op: 'Replace', path: 'active', value: 'False' }]);
  assert.equal(off.active, 'False', 'the raw value is kept for the mapper, which reads it as false');
  const moved = patch(ana, [
    { op: 'Replace', path: 'emails[type eq "work"].value', value: 'ana.new@corp.test' },
    { op: 'Replace', path: 'name.familyName', value: 'Souza' },
    { op: 'Add', path: `${ENTERPRISE}:department`, value: 'Platform' },
    { op: 'Replace', path: `${ENTERPRISE}:manager`, value: { value: 'u7' } }
  ]);
  assert.equal(moved.emails[0].value, 'ana.new@corp.test');
  assert.equal(moved.emails[1].value, 'ana@home.test', 'only the matching element changes');
  assert.equal(moved.name.familyName, 'Souza');
  assert.equal(moved.name.givenName, 'Ana');
  assert.equal(moved[ENTERPRISE].department, 'Platform');
  assert.equal(moved[ENTERPRISE].manager.value, 'u7');
  assert.equal(ana.name.familyName, 'Lima', 'the original resource is never changed');
  const fresh = patch({ ...ana, emails: [] }, [{ op: 'Add', path: 'emails[type eq "work"].value', value: 'first@corp.test' }]);
  assert.deepEqual(fresh.emails, [{ type: 'work', value: 'first@corp.test' }], 'a missing element named by an equality filter is created');
});

test('Okta user patches without a path merge their values', () => {
  const off = patch(ana, [{ op: 'replace', value: { active: false } }]);
  assert.equal(off.active, false);
  const many = patch(ana, [{ op: 'replace', value: { displayName: 'A. Lima', 'name.givenName': 'Anna', id: 'hijack', meta: {}, [ENTERPRISE]: { division: 'R&D' } } }]);
  assert.equal(many.displayName, 'A. Lima');
  assert.equal(many.name.givenName, 'Anna');
  assert.equal(many.id, 'u1', 'read-only attributes in a value object are ignored');
  assert.equal(many[ENTERPRISE].division, 'R&D');
  assert.equal(many[ENTERPRISE].department, 'Research');
});

test('group membership patches from Okta and Entra add, remove and replace', () => {
  const group = { schemas: GROUP_SCHEMAS, id: 'g1', displayName: 'Engineering', members: [{ value: 'u1' }, { value: 'u2' }] };
  assert.deepEqual(patch(group, [{ op: 'Add', path: 'members', value: [{ value: 'u3' }, { value: 'u1' }] }], GROUP_SCHEMAS).members.map(m => m.value), ['u1', 'u2', 'u3'], 'adding is idempotent');
  assert.deepEqual(patch(group, [{ op: 'Remove', path: 'members', value: [{ value: 'u1' }] }], GROUP_SCHEMAS).members.map(m => m.value), ['u2'], 'Entra removes by value list');
  assert.deepEqual(patch(group, [{ op: 'remove', path: 'members[value eq "u2"]' }], GROUP_SCHEMAS).members.map(m => m.value), ['u1'], 'Okta removes by filter');
  assert.deepEqual(patch(group, [{ op: 'remove', path: 'members' }], GROUP_SCHEMAS).members, undefined, 'removing without a value clears the members');
  assert.deepEqual(patch(group, [{ op: 'replace', path: 'members', value: [{ value: 'u9' }] }], GROUP_SCHEMAS).members.map(m => m.value), ['u9']);
  const renamed = patch(group, [{ op: 'replace', value: { id: 'g1', displayName: 'Platform' } }], GROUP_SCHEMAS);
  assert.equal(renamed.displayName, 'Platform');
  assert.equal(patch(group, [{ op: 'remove', path: 'members[value eq "nobody"]' }], GROUP_SCHEMAS).members.length, 2, 'removing a member that is not there changes nothing');
});

test('patch requests that are malformed or touch read-only attributes are refused whole', () => {
  const refuses = (body, type) => assert.throws(() => applyPatch(ana, body, SCHEMAS), e => e.status === 400 && e.scimType === type);
  refuses({ Operations: [{ op: 'replace', path: 'displayName', value: 'x' }] }, 'invalidSyntax');
  refuses({ schemas: [PATCH_SCHEMA], Operations: [] }, 'invalidSyntax');
  refuses({ schemas: [PATCH_SCHEMA], Operations: [{ op: 'move', path: 'displayName' }] }, 'invalidSyntax');
  refuses({ schemas: [PATCH_SCHEMA], Operations: [{ op: 'remove' }] }, 'noTarget');
  refuses({ schemas: [PATCH_SCHEMA], Operations: [{ op: 'replace', path: 'id', value: 'x' }] }, 'mutability');
  refuses({ schemas: [PATCH_SCHEMA], Operations: [{ op: 'replace', path: 'emails[type sw "zz"].value', value: 'x' }] }, 'noTarget');
  refuses({ schemas: [PATCH_SCHEMA], Operations: Array.from({ length: 1001 }, () => ({ op: 'replace', path: 'displayName', value: 'x' })) }, 'invalidSyntax');
  const ops = [{ op: 'replace', path: 'displayName', value: 'Changed' }, { op: 'replace', path: 'meta', value: {} }];
  assert.throws(() => applyPatch(ana, { schemas: [PATCH_SCHEMA], Operations: ops }, SCHEMAS));
  assert.equal(ana.displayName, 'Ana Lima', 'a refused request leaves nothing half applied');
});

test('a sub-attribute after a bracketed filter compares only the matching elements', () => {
  assert.ok(hit('emails[type eq "work"].value co "corp"'));
  assert.ok(!hit('emails[type eq "home"].value co "corp"'));
  assert.ok(hit('emails[type eq "home"].value pr'));
  assert.throws(() => parseFilter('emails[type eq "work"].value'), e => e.scimType === 'invalidFilter');
});