import { t, tk } from '../i18n.jsx';

const MESSAGES = {
  __proto__: null,
  expired: tk('That sign-in took too long or started in another tab. Try again.'),
  failed: tk('The sign-in provider did not confirm who you are. Try again.'),
  not_allowed: tk('Your account at the provider is not allowed to sign in here.'),
  account_exists: tk('An account with this email already exists. Sign in with your password, then link this provider under Settings, Security.'),
  no_account: tk('There is no account here for that sign-in. Ask an administrator for access.'),
  no_email: tk('The provider did not share an email address.'),
  unverified: tk('The provider has not verified your email address.'),
  domain: tk('That email domain cannot sign in here.'),
  disabled: tk('This account is disabled. Contact your administrator.'),
  link_session: tk('Linking was started from another session. Try again from Settings.'),
  linked_elsewhere: tk('That sign-in is already linked to another account.')
};

export const ssoMessage = (code) => t(MESSAGES[code] || MESSAGES.failed);