import { t, tk } from '../../../i18n.jsx';

const BADGES = { __proto__: null, scim: tk('provisioned'), ldap: tk('directory'), header: tk('proxy'), sso: tk('single sign-on') };
const NAMES = { __proto__: null, scim: tk('SCIM provisioning'), ldap: tk('Directory (LDAP)'), header: tk('Trusted proxy'), sso: tk('Single sign-on') };

const kindOf = (source) => (String(source || '').startsWith('sso:') ? 'sso' : String(source || ''));

export const sourceBadge = (source) => (BADGES[kindOf(source)] ? t(BADGES[kindOf(source)]) : '');

export const sourceName = (source) => (NAMES[kindOf(source)] ? t(NAMES[kindOf(source)]) : String(source || ''));