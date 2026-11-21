# Enterprise deployment

This guide is for teams running Open Quill for a company: how to deploy it securely, connect it to your identity systems, monitor it and recover from mistakes. Read it with [Identity and access](identity-access.md), [Sign-in methods](sign-in.md) and [SCIM provisioning](provisioning.md).

## How it is built

Open Quill is one Node.js server. It serves the web app, the API and the live connection from one port, and keeps everything in one folder per database: an encrypted SQLite file (SQLCipher), uploads and Code session workspaces. There is no external database, cache or queue to run.

- **Nothing leaves the machine unless you configure it.** Fonts and libraries are bundled. There is no analytics, telemetry or update check. With **Block public internet** on (the default), the server reaches only private addresses. There are two deliberate exceptions: web search, when you turn it on, and the identity providers you configure, which the server reaches only at their own hosts and the endpoints they publish, over `https`.
- **Secrets are encrypted at rest.** Provider client secrets, the LDAP service password and two-factor secrets are sealed with AES-256-GCM under a key derived from the database key. Recovery codes and SCIM tokens are stored only as keyed hashes. Connection API keys never reach a browser.
- **Every request is checked on the server.** Permissions, roles, sharing and group availability are enforced per request. Writes from another origin are refused, every response carries strict security headers, and the browser is confined to this origin by a Content Security Policy.
- **The instance is never indexed.** Every response says `noindex`, and there is no public page beyond the sign-in screen.

## Deployment checklist

| Step | Why |
| --- | --- |
| Put Open Quill behind a reverse proxy that terminates TLS, and keep `HOST=127.0.0.1` | The server then accepts connections only from the proxy, and cookies are marked `Secure` |
| Have the proxy send `X-Forwarded-Proto: https` and set `TRUST_PROXY=1` | Secure cookies and HSTS, and the real client address in the event log and rate limits |
| Proxy WebSocket upgrades on `/ws` | Replies stream over the live connection |
| Set `PUBLIC_URL` to the address people use | Single sign-on redirects and the SCIM base URL are built from it |
| Set `DB_ENCRYPTION_KEY` from your secrets manager | One key for every database, kept outside the data folder. Without it, each database keeps its own key file beside its data |
| Keep a local owner account with a strong password and two-factor | Your way in if the identity provider or directory is down |
| Close **Registration** under **Users**, or limit it to your domains | Only people you provision or approve get in |
| Connect single sign-on, and SCIM or LDAP | See [The recommended setup](provisioning.md#the-recommended-setup) |
| Set the two-factor policy to **Admins** or **Everyone** | For any password or directory sign-ins that remain |
| Review **Admin Panel → Quotas** | Session lifetime, devices per person, upload and spend caps |
| Review the User baseline and create groups | Decide who may use Code sessions, connectors, web search, sharing and exports |
| Schedule an event log export into your SIEM | See [Monitoring and audit](#monitoring-and-audit) |
| Back up the data folder and the key | See [Backups](#backups) |

### Reverse proxy examples

nginx:

```nginx
server {
  listen 443 ssl;
  server_name chat.example.com;
  client_max_body_size 110m;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
```

Caddy:

```
chat.example.com {
  reverse_proxy 127.0.0.1:3001
}
```

Caddy sets the forwarding headers and upgrades WebSockets on its own. With either proxy, set `TRUST_PROXY=1` in `.env`. If your proxy rewrites the `Host` header and very old browsers must be supported, list the public origin in `TRUSTED_ORIGINS`.

## Configuration reference

Identity and security settings in `.env`, besides those in [Building and running](building.md#configure):

| Variable | Meaning |
| --- | --- |
| `PUBLIC_URL` | The public `https` address. Locks the public address in the admin panel |
| `TRUST_PROXY` | `1` when a proxy sets `X-Forwarded-For` |
| `TRUSTED_ORIGINS` | Extra origins allowed to make changes, only for a proxy that rewrites `Host` |
| `DB_ENCRYPTION_KEY` | The database key. A 64-character hex value is a raw key; anything else is a passphrase |
| `TRUSTED_HEADER_*` | Sign-in through a trusted proxy. See [Trusted reverse proxy](sign-in.md#trusted-reverse-proxy) |

Settings that live in the admin panel and apply immediately, without a release: sign-in providers, LDAP, SCIM, the two-factor policy, registration, the User baseline, roles and groups. Security changes should never wait for a release. Everything members see, including which groups may use a model, is staged and published as described in the [Admin guide](admin-guide.md#publishing-changes).

## Monitoring and audit

The event log keeps 120 days, sorted into **Sign-in**, **Access**, **Provisioning** and **Administration**. Every entry has a timestamp, the actor (an email, `system`, or `SCIM: <token name>`), the action, the target, the client address and details.

**Export JSON Lines** under **Admin Panel → Event log** writes one event per line:

```json
{"timestamp":"2026-11-20T14:02:47.512Z","actor":"ana@corp.example.com","actor_id":"0f8f...","action":"auth.login","category":"signin","target_type":"user","target_id":"0f8f...","ip":"203.0.113.7","meta":{"method":"sso","provider":"..."}}
```

Download it on a schedule and ship it to Splunk, Elastic, Microsoft Sentinel or any SIEM, or use **Export CSV** for spreadsheets. Exports themselves are recorded.

Events worth alerting on:

| Action | Why |
| --- | --- |
| `auth.login_fail` in bursts | Password guessing. The meta holds the attempted email and method |
| `auth.header_refused` | Something reached the server with a sign-in header but not from your proxy, or without the secret |
| `auth.sso_refused`, `auth.ldap_refused` | Sign-ins refused by domain, group, linking or provisioning rules |
| `user.role` | Role changes, especially to Admin or Owner |
| `user.mfa_reset`, `account.2fa_disable` | Two-factor removed from an account |
| `user.recover` | The break-glass script was used |
| `auth.scim_token_create`, `auth.provider_update`, `auth.ldap_update`, `auth.mfa_policy` | Changes to how people sign in |
| `scim.user_adopt` | An existing account was handed over to provisioning |
| `review.view` | An admin opened a member's chat through quality review |

## Backups

Stop the server (or use your file system's snapshots), then copy the data folder: `server/data/` for the default database, `server/data/databases/<name>/` for the others. The copy is encrypted, so keep the database key with it, in a separate place: without the key a backup cannot be opened, and with the key anyone can open it. Test a restore regularly by starting a copy with `OPEN_QUILL_DB` set to its name.

## Break-glass recovery

If the owner is locked out (a lost authenticator, a broken identity provider, a forgotten password), run this on the server, with access to the database key:

```shell
npm run auth:recover -- --email owner@example.com
```

It removes the account's two-factor, ends its sessions and prints a temporary password. It uses the database named in `.env`, or `OPEN_QUILL_DB` when set. The recovery is recorded in the event log as `user.recover`. Change the temporary password right after signing in, and set up two-factor again.

Because it needs shell access and the key, recovery is only possible for whoever runs the server, never through the web.

## Leavers and access reviews

- With SCIM or LDAP sync, removing someone in your directory disables their account within one sync, ends their sessions at once and stops anything they had running. Their chats are kept until you delete the account, or deleted at once if you chose **Delete**.
- Without them, disable the account under **Users**. Disabling is immediate everywhere.
- **See access** on an account lists every permission and where it comes from. The share dialog on any project, chat or skill lists everyone who can reach it, directly or through a group.
- Admins cannot browse members' chats. Review of a chat is possible only through **Quality** when it failed a check, was rated, or became a test case, and every view is logged.

## Troubleshooting sign-in

| Symptom | Likely cause |
| --- | --- |
| The provider says the redirect URI does not match | The public address differs from what was registered, or `http` and `https` differ. Copy the redirect address from the provider's dialog again |
| "This account already exists" after single sign-on | Linking by email is off, the email is not verified by the provider, or the account has a password, an admin role or another sign-in method. Link it from **Settings → Security** while signed in |
| Single sign-on works but groups do not appear | **Keep groups in sync** is off, the groups claim name differs, or the provider does not put groups in the token. Check the claim with a test account |
| "Sign-in is temporarily unavailable" with LDAP | The directory cannot be reached, its certificate is not trusted, or the service account was refused. Use **Test saved settings** |
| Directory sign-in says the password is wrong for the right password | The user filter matches no entry or more than one. Use **Look up a person** |
| SCIM test connection fails | The base URL is not reachable from the internet, provisioning is off, or the token was copied incompletely |