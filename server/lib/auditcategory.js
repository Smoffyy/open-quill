export const AUDIT_CATEGORIES = ['signin', 'access', 'provisioning', 'administration'];

const RULES = [
  ['signin', [
    /^auth\.(login|login_fail|logout|mfa_fail|sso_refused|ldap_refused|header_refused)$/,
    /^account\.(identity_link|identity_unlink|password_change|2fa_enable|2fa_disable|2fa_recovery|sessions_revoke)$/,
    /^user\.(recover|mfa_reset|sessions_revoke)$/
  ]],
  ['provisioning', [/^scim\./, /^user\.(provision|register|delete)$/, /^account\.delete$/, /^auth\.ldap_sync$/]],
  ['access', [/^share\./, /^group\./, /^role\./, /^review\./, /^user\.(role|approve|disable|enable|budget)$/]]
];

export function auditCategory(action) {
  const name = String(action || '');
  for (const [category, patterns] of RULES) {
    if (patterns.some(p => p.test(name))) return category;
  }
  return 'administration';
}