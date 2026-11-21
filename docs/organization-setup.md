# Setting up Open Quill for your organization

This guide takes an organization from an empty server to everyone signed in, with the right access and nothing left open. Follow it in order. Each step links to the reference guide with every detail:

- [Identity and access](identity-access.md): roles, permissions, groups, sharing and the event log
- [Sign-in methods](sign-in.md): passwords, single sign-on, LDAP and Active Directory, a trusted proxy and two-factor
- [SCIM provisioning](provisioning.md): accounts and groups managed by your identity provider
- [Enterprise deployment](enterprise.md): the server, the reverse proxy, monitoring, backups and recovery

The steps:

1. [Choose how people will sign in](#1-choose-how-people-will-sign-in)
2. [Prepare the server](#2-prepare-the-server)
3. [Create and protect the owner account](#3-create-and-protect-the-owner-account)
4. [Connect your identity provider](#4-connect-your-identity-provider)
5. [Organize access](#5-organize-access)
6. [Set the policies](#6-set-the-policies)
7. [Connect models and publish](#7-connect-models-and-publish)
8. [Run a pilot](#8-run-a-pilot)
9. [Go live](#9-go-live)
10. [Run it day to day](#10-run-it-day-to-day)

## 1. Choose how people will sign in

Pick the row that matches what your organization already uses:

| Your organization uses | People sign in with | Accounts are created by |
| --- | --- | --- |
| Microsoft 365 or Microsoft Entra ID | Microsoft single sign-on | SCIM from Entra |
| Okta | Okta, as an OpenID Connect provider | SCIM from Okta |
| Google Workspace | Google single sign-on | Their first sign-in |
| Keycloak, Authentik, Auth0, Ping or another OpenID Connect provider | That provider | Their first sign-in, with groups from the token |
| Active Directory or OpenLDAP on your own network | Their directory username and password | Their first sign-in, kept current by a scheduled sync |
| An authenticating gateway already in front of your internal apps | Nothing more: the gateway has signed them in | Their first request |
| None of these, or a small team | A password and two-factor | Signing up, with approval |

Methods can be combined, for example single sign-on for staff and approved password accounts for contractors. Whatever you choose, keep one local owner account with a password, so you can always get in when the identity provider or the directory is down.

## 2. Prepare the server

1. Install Open Quill on the machine that will run it, as in [Building and running](building.md).
2. Put it behind a reverse proxy that serves HTTPS on the address people will use, such as `https://chat.example.com`. [Enterprise deployment](enterprise.md#reverse-proxy-examples) has nginx and Caddy examples.
3. Set these in the `.env` file in the project root:

   ```shell
   HOST=127.0.0.1
   PORT=3001
   PUBLIC_URL=https://chat.example.com
   TRUST_PROXY=1
   DB_ENCRYPTION_KEY=<64 hex characters, kept in your secrets manager>
   ```

   `HOST=127.0.0.1` means only the proxy can reach the server. `PUBLIC_URL` is the address single sign-on and SCIM are built on. `TRUST_PROXY=1` records real client addresses. Make the key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, and store it outside the server as well: backups cannot be opened without it.
4. Start the server with `npm start` and open the public address.

## 3. Create and protect the owner account

1. The first screen asks for the **setup token**, which the server prints in its console until an owner exists. Only whoever runs the server can see it.
2. Create the owner account with a strong password. Use a named administrator or an IT break-glass mailbox, not a personal address that could leave with someone.
3. Turn on two-factor at once under **Settings → Security**, and store the recovery codes in your password vault.
4. Later, once people can sign in, make a second person an owner under **Admin Panel → Users**, so one absence never locks you out.

If the owner is ever locked out, `npm run auth:recover -- --email <owner>` on the server resets it. See [Break-glass recovery](enterprise.md#break-glass-recovery).

## 4. Connect your identity provider

Everything here is under **Admin Panel → Sign-in** and **Admin Panel → Provisioning**, and only an owner can change it. Each provider's dialog shows the exact **Redirect address** to register with the provider.

### Microsoft Entra ID with SCIM

1. Under **Sign-in**, **Add a provider → Microsoft**. Register the app in Entra as described in [Microsoft Entra ID](sign-in.md#microsoft-entra-id), then fill in the client ID, the secret and the tenant ID.
2. Set **New accounts** to **Off**, so only provisioned people get in, and turn on **Link existing accounts by email**. Add the optional claim `xms_edov` in Entra, which linking needs. Turn the provider on.
3. Under **Provisioning**, turn provisioning on, create a token named "Entra", and set up provisioning in Entra as described in [Microsoft Entra ID](provisioning.md#microsoft-entra-id).
4. In Entra, assign a small pilot group to the app first. Watch **Provisioning → Recent activity** fill in.

### Okta with SCIM

1. Create an OpenID Connect web app in Okta and add it under **Sign-in** as an OpenID Connect provider, as described in [Okta](sign-in.md#okta). Set **New accounts** to **Off** and turn on **Link existing accounts by email**.
2. Under **Provisioning**, turn provisioning on, create a token named "Okta", and enable SCIM on the same Okta app as described in [Okta](provisioning.md#okta), with **Push Groups** for the groups you will use.
3. Assign a pilot group in Okta and push its group.

### Google Workspace

1. Add the Google provider as described in [Google Workspace](sign-in.md#google-workspace), with your domain in **Allowed email domains**.
2. Set **New accounts** to **User**, or to **Pending** if an admin should approve each person.
3. Google does not send groups, so create groups under **Admin Panel → Groups** and add people to them there.

### Keycloak or another OpenID Connect provider

1. Add an OpenID Connect provider with its issuer, client ID and secret, as described in [Keycloak](sign-in.md#keycloak) or [Any other OpenID Connect provider](sign-in.md#any-other-openid-connect-provider).
2. Set **New accounts** to **User**. To admit only some people, fill in **Only members of this group**.
3. Turn on **Keep groups in sync** so the groups claim becomes groups here.

### Active Directory or LDAP

1. Under **Sign-in → Directory (LDAP) → Configure**, choose **Fill in defaults for → Active Directory** or **OpenLDAP**.
2. Enter the `ldaps://` address, the service account and the user base, as described in [LDAP and Active Directory](sign-in.md#ldap-and-active-directory). Use **Certificate authority** if your directory uses an internal certificate.
3. Press **Test saved settings**, then try **Look up a person** with your own username.
4. Set **New accounts** to **User**, **Groups** to **memberOf**, **Sync with the directory** to every 6 hours, and turn on **Disable accounts that leave the directory**. Keep **Most accounts one sync may disable** low, such as 10%.
5. Turn it on. The sign-in form now asks for **Email or username**.

### An authenticating gateway

Set the `TRUSTED_HEADER_*` variables in `.env` as described in [Trusted reverse proxy](sign-in.md#trusted-reverse-proxy), make sure the gateway strips those headers from incoming requests and is the only way to reach the server, and restart. **Admin Panel → Sign-in** shows the settings it read.

### Passwords only

Under **Admin Panel → Users → Registration**, choose **Approval** and list your email domains in **Allowed email domains**. Set the two-factor policy to **Everyone** in step 6.

## 5. Organize access

Decide what an ordinary person may do, then grant more through groups.

1. **The User baseline.** Under **Admin Panel → Roles → User**, turn off what most people should not have. Common choices are **Code sessions**, **Personal connectors**, **Share chats** and **Export chats**. Every User and every custom role starts from this baseline.
2. **Groups.** Under **Admin Panel → Groups**, use the groups your identity provider sends (marked as synced), or create your own. Give each group the extra permissions it needs, for example **Code sessions** for Engineering, and a **default model**. Groups can sit inside other groups: put "Platform" inside "Engineering" and Platform inherits everything Engineering has. A synced group can be placed inside a local group.
3. **Models and connectors.** On a model's **General** tab, and on each workspace MCP server, **Who can use it** limits it to chosen groups. Model changes reach people only after you publish them in step 7.
4. **Admins.** Make your IT administrators **Admin** under **Users**; only an owner can. For people who should manage some things but not all, such as team leads who approve accounts, create a custom role under **Roles** with only those admin permissions.
5. **Check.** **See access** on any account under **Users** shows every permission the person has and where each one comes from.

## 6. Set the policies

| Where | Recommended |
| --- | --- |
| **Users → Two-factor authentication** | **Admins** when everyone signs in with single sign-on, **Everyone** when passwords or directory sign-in are used |
| **Users → Registration** | **Closed** when every account comes from your identity provider or directory |
| **Network** | Keep **Block public internet** on, and allow only the hosts your models and tools need |
| **Quotas** | The session lifetime (30 days by default), devices per person, upload limits and monthly spend caps |
| **Guardrails** | Optional: screen each message with a model before the assistant sees it |

Sign-in settings, policies, groups and roles apply at once. Nothing here waits for a release.

## 7. Connect models and publish

Connect your model providers under **Admin Panel → Providers**, or run the setup guide from **Overview**, then open **Review changes** and **Publish**. People see models, interface changes and model availability only after a publish. See [Getting started](getting-started.md) and the [Admin guide](admin-guide.md).

## 8. Run a pilot

Before inviting everyone, try it with a small group and check each line:

| Check | How |
| --- | --- |
| A pilot user signs in and lands with the right role | Sign in as them; look under **Users** |
| Someone outside the pilot is refused | Try a test account that is not assigned to the app |
| Groups arrive and give the right access | **Groups** shows them as synced; **See access** on a pilot user |
| A model limited to a group is visible only to its members | Sign in as one person inside the group and one outside |
| Removing someone upstream locks them out | Unassign a pilot user in your identity provider, or remove them from the directory and press **Sync now**; their account turns **disabled** and their session ends |
| The owner can still get in alone | Sign in with the owner's password and two-factor code |
| The event log records it all | **Event log**, category **Sign-in** and **Provisioning**; try **Export JSON Lines** |

## 9. Go live

1. Assign everyone who should have access in your identity provider, or announce the address to your directory users.
2. Close **Registration** if it is still open.
3. Tell people the address and how to sign in. Point them to [Getting started](getting-started.md) and [Privacy and security](privacy-security.md).

## 10. Run it day to day

- **Joiners and leavers** follow your identity provider or directory on their own. To lock someone out by hand, disable the account under **Users**: their sessions end and anything they had running stops.
- **Access reviews:** **See access** on an account, the share dialog on any project, chat or skill, and the **Access** category of the event log.
- **Audit:** export the event log as JSON Lines on a schedule into your SIEM, and alert on the events listed in [Monitoring and audit](enterprise.md#monitoring-and-audit).
- **Secrets that expire:** before a provider's client secret expires (Entra secrets do), paste the new one into the provider's dialog. Before a SCIM token expires, create a new one, put it into your identity provider, then revoke the old one.
- **Backups and updates:** back up the data folder and keep the key separately, as described in [Backups](enterprise.md#backups), and update as described in [Building and running](building.md#update).

## Go-live checklist

- [ ] HTTPS reverse proxy in front, `HOST=127.0.0.1`, `PUBLIC_URL` and `TRUST_PROXY=1` set
- [ ] `DB_ENCRYPTION_KEY` set and stored outside the server
- [ ] Owner account with a strong password, two-factor and recovery codes in the vault
- [ ] A second owner
- [ ] Single sign-on, directory or proxy sign-in connected and tested
- [ ] SCIM connected, or directory sync scheduled, if you use them
- [ ] User baseline reviewed, groups and admins set up
- [ ] Models limited to the right groups and published
- [ ] Two-factor policy, registration, network and quotas set
- [ ] Pilot checks passed
- [ ] Event log export and alerts in place
- [ ] Backups running and a restore tested