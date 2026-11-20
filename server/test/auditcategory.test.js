import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditCategory, AUDIT_CATEGORIES } from '../lib/auditcategory.js';

test('every audit action falls into exactly one category', () => {
  const cases = {
    signin: ['auth.login', 'auth.login_fail', 'auth.logout', 'auth.mfa_fail', 'auth.sso_refused', 'auth.ldap_refused', 'auth.header_refused', 'account.password_change', 'account.2fa_enable', 'account.identity_unlink', 'account.sessions_revoke', 'user.mfa_reset', 'user.recover'],
    access: ['share.grant', 'share.revoke', 'group.members', 'group.nest', 'role.update', 'user.role', 'user.approve', 'user.disable', 'review.view'],
    provisioning: ['scim.user_create', 'scim.group_update', 'user.provision', 'user.register', 'user.delete', 'account.delete', 'auth.ldap_sync'],
    administration: ['config.publish', 'model.update', 'auth.provider_create', 'auth.ldap_update', 'auth.scim_token_create', 'auth.mfa_policy', 'audit.export', 'mcp.policy', 'something.new', '', null]
  };
  for (const [category, actions] of Object.entries(cases)) {
    assert.ok(AUDIT_CATEGORIES.includes(category));
    for (const action of actions) assert.equal(auditCategory(action), category, String(action));
  }
  assert.equal(auditCategory('auth.login_failed_extra'), 'administration', 'names match whole, not by prefix');
});