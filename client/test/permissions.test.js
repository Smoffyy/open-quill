import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS } from '../../server/lib/authz/permissions.js';
import { PERMISSION_LABELS, PERMISSION_CATEGORIES } from '../src/lib/permissionlabels.js';
import { ADMIN_SECTIONS } from '../src/lib/permissions.js';

test('every server permission has a label, a note and a known category', () => {
  const categories = new Set(PERMISSION_CATEGORIES.map(c => c.id));
  for (const p of PERMISSIONS) {
    assert.ok(PERMISSION_LABELS[p.id]?.label, `${p.id} has a label`);
    assert.ok(PERMISSION_LABELS[p.id]?.note, `${p.id} has a note`);
    assert.ok(categories.has(p.category), `${p.id} sits in a category the admin screens show`);
  }
  const known = new Set(PERMISSIONS.map(p => p.id));
  for (const id of Object.keys(PERMISSION_LABELS)) assert.ok(known.has(id), `${id} is still a permission`);
});

test('every admin section is gated by a real admin permission', () => {
  const admin = new Set(PERMISSIONS.filter(p => p.tier === 'admin').map(p => p.id));
  for (const [section, permission] of Object.entries(ADMIN_SECTIONS)) assert.ok(admin.has(permission), `${section} needs ${permission}`);
});