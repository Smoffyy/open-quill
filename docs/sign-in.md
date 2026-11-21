# Sign-in methods

Open Quill supports passwords, single sign-on with Google, Microsoft Entra ID, GitHub and any OpenID Connect provider (Okta, Keycloak, Authentik, Auth0, Ping and others), LDAP and Active Directory, and sign-in through a trusted reverse proxy. Methods can be combined. Accounts can also be created and removed by your identity provider over [SCIM](provisioning.md).

Every method feeds the same pipeline: prove an identity, find or create the account, apply the account's status and the [two-factor policy](#two-factor-authentication), then start a session. Only an owner can change sign-in settings, under **Admin Panel → Sign-in**, and every change is recorded in the event log.

## The public address

Identity providers send people back to Open Quill, so the server must know the address people reach it at. Set it once, either:

- with `PUBLIC_URL` in the server's `.env` (for example `PUBLIC_URL=https://chat.example.com`), which locks the field in the admin panel, or
- under **Admin Panel → Sign-in → Public address**.

It must be `https`, except on `localhost` for testing. Each provider's dialog then shows its exact **Redirect address**, `https://chat.example.com/api/auth/sso/<provider id>/callback`, with a copy button. Register that exact address with the provider.

## Passwords and sign-up

- **Registration** under **Admin Panel → Users** is **Open**, **Approval** (new accounts wait as Pending until an admin approves them) or **Closed**. **Allowed email domains** limits sign-up to your company's domains.
- Passwords are at least 8 characters and stored as Argon2id hashes. They are never logged or sent anywhere.
- Sign-in is rate limited per account and per address. A wrong email and a wrong password give the same answer in the same time, so the form never reveals which accounts exist. Every failed attempt is recorded as `auth.login_fail`.
- An account created by single sign-on, LDAP, SCIM or the proxy has no password and cannot sign in with one.

Closing registration does not affect single sign-on, LDAP, the proxy or SCIM. Each of those has its own **New accounts** setting.

## Single sign-on

**Admin Panel → Sign-in → Add a provider** creates a provider, which starts turned off. Every provider has these settings:

| Setting | Meaning |
| --- | --- |
| **Button label** | The text on the sign-in page, for example "Continue with Okta" |
| **Client ID**, **Client secret** | From the app you register with the provider. The secret is encrypted on the server and never shown again |
| **Allowed email domains** | One per line. Empty means the domains allowed for sign-up |
| **New accounts** | **Off**: only people who already have an account can use the provider. **Pending**: new people get an account that waits for approval. **User**: new people can start right away |
| **Link existing accounts by email** | See [Linking accounts](#linking-accounts) |
| **Also ask for this server's two-factor** | Off trusts the provider's own sign-in checks, including its multi-factor |
| **Turned on** | Shows the button on the sign-in page |

OpenID Connect providers also have **Issuer**, **Extra scopes**, **Groups claim**, **Only members of this group**, **Keep groups in sync** and **Client authentication** (secret in the request body, or HTTP Basic). **Test saved settings** fetches the provider's discovery document to confirm the issuer.

What happens on the wire: the authorization code flow with PKCE (S256), a random `state` and `nonce`, and a signed, short-lived flow cookie that expires after 10 minutes. The ID token's signature, issuer, audience and nonce are verified against the provider's published keys. The server talks only to the hosts of configured providers and their discovered endpoints, over `https`, with a 10 second timeout, and refuses cloud metadata and link-local addresses.

### Linking accounts

The first time someone signs in with a provider, Open Quill looks for an account already linked to that provider identity. If there is none and an account with the same email exists, it is linked automatically only when all of these hold:

- **Link existing accounts by email** is on for the provider,
- the provider says the email is verified,
- the account has no password,
- the account has no admin role,
- the account has no other sign-in method.

Otherwise the sign-in is refused, so a provider can never take over a password account or an admin. People link providers to their own account themselves under **Settings → Security → Sign-in methods** while signed in, and can unlink one there as long as they keep another way in.

### Google Workspace

1. In the Google Cloud console, open **APIs & Services → OAuth consent screen**. For company accounts only, choose **Internal**.
2. Open **Credentials → Create credentials → OAuth client ID**, application type **Web application**.
3. Under **Authorized redirect URIs**, paste the redirect address from Open Quill.
4. Copy the client ID and secret into the Google provider in Open Quill.
5. Put your Workspace domain in **Allowed email domains**, then turn the provider on.

### Microsoft Entra ID

1. In the Microsoft Entra admin center, open **App registrations → New registration**. Choose **Accounts in this organizational directory only**.
2. Under **Redirect URI**, choose **Web** and paste the redirect address from Open Quill.
3. Under **Certificates & secrets**, create a client secret and copy its **Value**.
4. Copy the **Application (client) ID** and the **Directory (tenant) ID** from the overview page into the Microsoft provider. Only people in that directory can sign in.
5. To link existing accounts by email, add the optional claim `xms_edov` to the ID token under **Token configuration**, which tells Open Quill the email's domain is verified.

The Microsoft provider does not sync groups. Use [SCIM](provisioning.md) to push Entra groups, or add Entra as an OpenID Connect provider with the issuer `https://login.microsoftonline.com/<tenant id>/v2.0` and a groups claim.

### GitHub

1. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set **Authorization callback URL** to the redirect address from Open Quill, then generate a client secret.
3. Copy the client ID and secret into the GitHub provider.
4. To admit only your company, enter the organization's login in **Only members of this organization**. If the organization restricts third-party apps, an organization owner must approve the app.

Only a verified primary email on the GitHub account is accepted.

### Okta

1. In the Okta Admin Console, open **Applications → Create App Integration**, choose **OIDC** and **Web Application**.
2. Add the redirect address from Open Quill as a **Sign-in redirect URI**, and assign the app to the people or groups who should use it.
3. Add an OpenID Connect provider in Open Quill with the issuer `https://<your Okta domain>` (or `https://<your Okta domain>/oauth2/default` when you use a custom authorization server), and the app's client ID and secret.
4. For group sync, on the app's **Sign On** tab set **Groups claim** to a filter such as `groups` matching `.*`, then turn on **Keep groups in sync**.

### Keycloak

1. In your realm, open **Clients → Create client**, type **OpenID Connect**, with **Client authentication** on and **Standard flow** enabled.
2. Add the redirect address from Open Quill to **Valid redirect URIs**, and copy the secret from the **Credentials** tab.
3. Add an OpenID Connect provider with the issuer `https://<keycloak host>/realms/<realm>`.
4. For group sync, add a **Group Membership** mapper to the client's dedicated scope with the token claim name `groups` and **Full group path** off, then turn on **Keep groups in sync**.

### Any other OpenID Connect provider

The provider needs a discovery document at `<issuer>/.well-known/openid-configuration`, the authorization code flow, and an `https` issuer. Request extra scopes, such as `groups`, under **Extra scopes**. **Only members of this group** refuses anyone whose groups claim does not include that group.

## LDAP and Active Directory

**Admin Panel → Sign-in → Directory (LDAP) → Configure** connects one directory. **Fill in defaults for** sets sensible filters and attributes for OpenLDAP or Active Directory.

| Setting | Meaning |
| --- | --- |
| **Address** | `ldaps://ldap.example.com` for LDAPS, or `ldap://dc1.example.com:389` for StartTLS |
| **Encryption** | **LDAPS** or **StartTLS**, with TLS 1.2 or newer and a verified certificate. **None** is only accepted for a directory on the same machine |
| **Certificate authority** | A PEM certificate when your directory's certificate is signed by an internal authority |
| **Service account** and its password | The account Open Quill searches with. Read access to people and groups is enough. The password is encrypted on the server and never shown again |
| **User base**, **User filter** | Where to search and how to find a person. `{{username}}` is replaced by what the person types |
| **Attributes** | Which attributes hold the username, email, name and a unique ID (`entryUUID` for OpenLDAP, `objectGUID` for Active Directory) |
| **Groups** | **memberOf**, a group search with `{{dn}}`, or none |
| **New accounts**, **Link existing accounts by email** | As for single sign-on |
| **Sync with the directory** | Off, or every 1, 6, 12 or 24 hours |
| **Disable accounts that leave the directory**, **Most accounts one sync may disable** | See below |

When directory sign-in is on, the sign-in form asks for **Email or username**. A sign-in works like this:

1. The service account searches the user base with the user filter. The typed username is escaped, so filter syntax in it is treated as text. The search must find exactly one entry, otherwise the sign-in fails.
2. Open Quill binds as that entry with the typed password on a separate connection. An empty password is always refused, because many directories treat it as an anonymous bind.
3. The entry needs an email. The account is found or created, groups are synced, and the two-factor policy applies.

A local account with a password keeps signing in with its own password, so an owner account stays usable even if the directory is down. If the directory cannot be reached, directory sign-ins fail with "Sign-in is temporarily unavailable" rather than falling back to anything weaker.

**Test saved settings** checks the service account and the user base. **Look up a person** shows what Open Quill would see for a username (the entry, email and groups) without signing anyone in.

**Sync** (manual with **Sync now**, or on a schedule) updates the names, emails and groups of every linked account and, when turned on, disables accounts whose entry is gone. A sync changes nothing if the directory cannot be reached, if it returns no accounts at all, or if it would disable a larger share of linked accounts than **Most accounts one sync may disable** (10% by default). The last result is shown on the card and every sync is recorded in the event log.

Active Directory tips:

- The default filter accepts both `sAMAccountName` and `userPrincipalName`, so people can type either `jdoe` or `jdoe@corp.example.com`.
- `memberOf` lists only direct groups. To include nested groups, choose **Search for groups** with the filter `(&(objectClass=group)(member:1.2.840.113556.1.4.1941:={{dn}}))`.
- Use LDAPS on port 636, or the global catalog on 3269 for a multi-domain forest.

## Trusted reverse proxy

If an authenticating proxy (oauth2-proxy, Authelia, Authentik, Pomerium or your corporate gateway) already signs people in, Open Quill can trust the email it passes in a header. This is configured only in the server's `.env`, never in the admin panel, so a stolen admin session cannot turn it on.

| Variable | Required | Meaning |
| --- | --- | --- |
| `TRUSTED_HEADER_AUTH` | yes | `on` to enable |
| `TRUSTED_HEADER_PROXIES` | yes | The proxy addresses, comma separated, as single addresses or CIDR ranges such as `10.0.0.5,10.1.0.0/16`. `0.0.0.0/0` is refused |
| `TRUSTED_HEADER_SECRET` | yes | At least 32 characters. The proxy must send it in `X-OpenQuill-Proxy-Secret` |
| `TRUSTED_HEADER_EMAIL` | yes | The header holding the email, for example `X-Forwarded-Email` |
| `TRUSTED_HEADER_NAME` | no | A header holding the display name |
| `TRUSTED_HEADER_GROUPS` | no | A header holding comma-separated groups, synced as proxy groups |
| `TRUSTED_HEADER_PROVISION` | no | `pending` (default), `user` or `off` for people without an account |
| `TRUSTED_HEADER_LINK` | no | `on` to link an existing account with the same email |

A header is trusted only when the request comes from a listed proxy address **and** carries the secret, compared in constant time. Anything else is ignored and recorded as `auth.header_refused`. A session started this way is bound to the header: when the header changes or disappears, the session ends. If the settings are invalid, header sign-in stays off and the server logs why at startup; **Admin Panel → Sign-in** shows the active settings read-only.

Your proxy must remove any copy of these headers that arrives from the client, and must be the only way to reach Open Quill (keep `HOST=127.0.0.1`, or firewall the port). An nginx example with oauth2-proxy:

```nginx
location / {
  auth_request /oauth2/auth;
  auth_request_set $email $upstream_http_x_auth_request_email;
  proxy_set_header X-Forwarded-Email $email;
  proxy_set_header X-OpenQuill-Proxy-Secret "your-32-character-or-longer-secret";
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_pass http://127.0.0.1:3001;
}
```

## Two-factor authentication

**Admin Panel → Users → Two-factor authentication** sets the policy:

| Policy | Effect |
| --- | --- |
| **Optional** | Everyone may turn it on under **Settings → Security** |
| **Admins** | Everyone with an admin permission must enroll before they can do anything else |
| **Everyone** | Every account must enroll |

The card shows how many accounts have enrolled. The policy applies to password and directory sign-ins. Single sign-on trusts the provider's own multi-factor unless **Also ask for this server's two-factor** is on, and the trusted proxy is trusted to have done it.

- Codes are standard TOTP (RFC 6238), so any authenticator app works. Setup shows a QR code and the key as text. The secret is encrypted on the server.
- Enrolling gives 10 single-use recovery codes, stored only as keyed hashes.
- After the password, sign-in asks for a code on a separate step that expires after 5 minutes. A code can never be used twice, and failures count toward the sign-in rate limit.
- An admin can reset another person's two-factor under **Users**, which also ends that person's sessions.

## Sessions

- The session is an `HttpOnly` cookie with `SameSite=Lax`, marked `Secure` when the request arrives over HTTPS (directly, or with `X-Forwarded-Proto: https` from your proxy).
- Sessions end after 30 days without use by default. **Admin Panel → Quotas** sets the lifetime (1 to 365 days) and how many devices one person may be signed in on.
- **Settings → Security** lists every session with its sign-in method, and can end any of them.
- Sensitive actions (changing the password, turning off two-factor, new recovery codes, unlinking a sign-in method, deleting the account) ask again for the password, or for a two-factor code or a sign-in within the last 10 minutes when the account has no password.