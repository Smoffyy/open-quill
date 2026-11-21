# Identity and access

This guide explains how Open Quill decides who someone is and what they may do. It is written for the people who run an Open Quill server for a team or a company: IT, security and the admins who look after accounts.

Access is decided in four layers, each checked on the server for every request:

1. **Accounts and roles.** Every person has one account with one role. The role sets a rank and a base set of permissions.
2. **Groups.** Groups add everyday permissions, limit which models and connectors people see, set default models, and can be nested.
3. **Sharing.** Projects, chats and skills can be shared with people and groups at a chosen level.
4. **Sign-in and provisioning.** Passwords, single sign-on, LDAP, a trusted proxy and SCIM decide how people prove who they are and how accounts appear and disappear. See [Sign-in methods](sign-in.md) and [SCIM provisioning](provisioning.md).

Nothing in the browser grants access. Hiding a button is only a convenience: the server checks the same permission again, and anything a person cannot reach answers as if it did not exist.

## Accounts

An account is identified by its email address. It has a role, a status (**active** or **disabled**) and a source, which says where it came from:

| Source | Created by | Badge in **Users** |
| --- | --- | --- |
| Local | Signing up with a password, or the first-run owner | none |
| Single sign-on | Signing in through Google, Microsoft, GitHub or an OpenID Connect provider | **single sign-on** |
| Directory | Signing in with an LDAP or Active Directory password | **directory** |
| Provisioned | Your identity provider, over SCIM | **provisioned** |
| Proxy | A trusted reverse proxy that has already signed the person in | **proxy** |

Directory, provisioned and proxy accounts are **managed**: their name and email follow the source, and the person cannot delete the account from **Settings**. Removing them is done in the source, or by an admin.

### Lifecycle

| Stage | What happens |
| --- | --- |
| **Sign-up** | Depends on **Admin Panel → Users → Registration**: open, approval (new accounts wait as Pending) or closed, optionally limited to email domains. Single sign-on, LDAP, the proxy and SCIM each have their own setting for new accounts |
| **Pending** | A hard gate. The person can see the waiting screen, sign out, set up two-factor and delete their own account. Every other request is refused, the live connection is refused, scheduled tasks do not run and group memberships grant nothing |
| **Approval** | An admin changes the role from Pending to User or higher. Access applies on the next request |
| **Disable** | Every session ends at once, open windows are disconnected, replies being written stop and scheduled tasks are skipped. Chats and files are kept. Enabling the account restores access |
| **Delete** | Removes the account with its chats, projects, skills, files, sessions, sign-in links and two-factor factors. It cannot be undone |

The last owner can never be demoted, disabled or deleted, by an admin, by SCIM or by the person themselves.

## Roles

| Role | Rank | Can |
| --- | --- | --- |
| **Pending** | 0 | Nothing until approved |
| **User** | 10 | Everything in the User baseline (below) |
| Custom roles | 11 to 99 | The User baseline plus the permissions you add, which may include admin permissions |
| **Admin** | 100 | Every permission, including publishing |
| **Owner** | 1000 | Everything, plus the owner-only settings |

Rules that always hold:

- You can manage only accounts ranked below you, and grant only roles ranked below you. Nobody can change their own role.
- Only an owner can make someone an admin or an owner.
- An admin can reset another person's two-factor; an owner's two-factor can be reset only by another owner or by the [recovery script](enterprise.md#break-glass-recovery).
- Changing a role updates the person's open windows immediately. Removing an account disconnects them.

**Owner only**, and not grantable through any role: sign-in methods and identity providers, LDAP, SCIM tokens and settings, the two-factor policy, the sign-up policy, custom roles, and assigning Admin or Owner.

### The User baseline

**Admin Panel → Roles → User** sets what every User can do. Anyone with the **Groups** admin permission can change it, and it applies immediately to every User and every custom role. Two permissions are off by default: **Advanced chat controls** and **Use unavailable models**.

### Custom roles

A custom role sits between User and Admin. Use it for team leads who should approve accounts but not change models, or for a help desk that can reset two-factor but not read the event log. Its rank decides who it can manage.

## Permissions reference

Everyday permissions can come from a role or from a group. Admin permissions come only from a role.

| Permission | Allows |
| --- | --- |
| Start and continue chats | Send messages, regenerate replies and import chats |
| Edit chats | Edit and delete messages, branch, rename, tag and pin |
| Delete chats | Delete whole conversations |
| Export chats | Download chats as Markdown, JSON or PDF |
| Incognito chats | Chats that are never saved or reviewed |
| See what gets sent | Inspect the full prompt and context of their own chats |
| Advanced chat controls | Per-chat sampling, a system prompt override and admin-only request options |
| Share chats | Let people and groups read their chats |
| Use unavailable models | Pick models an admin has marked unavailable |
| Code sessions | Run Code sessions with a workspace and a command line |
| Create projects | Start projects and add knowledge to them |
| Share projects | Give people and groups access to their projects |
| Upload files | Attach files and images, and upload to projects and workspaces |
| Scheduled tasks | Run prompts on a schedule |
| Personal skills | Write their own skills |
| Share skills | Let people and groups use the skills they write |
| Personal connectors | Add their own MCP servers, which this server calls on their behalf |
| Web search, Workspace connectors, Memory, Search past chats, Reference files, Consult other models | Let models use that tool |
| Dictation, Voice calls | Speak instead of typing, or talk in a hands-free call |
| Delete own account | Remove their own account and everything in it |

| Admin permission | Allows |
| --- | --- |
| Open the admin panel | See the overview and try unpublished changes in their own chats |
| Models | Models, folders, prices, reference pages and the playground |
| Connections | Provider connections and their keys |
| Tools | Web search, voice, chat history, reference files, skills and MCP servers |
| Interface | Themes, branding and the new chat screen |
| Policy | Guardrails, network policy and quotas |
| Quality | Evaluations, quality checks, ratings and flagged conversations |
| Usage | Usage, spend and tool reliability |
| Event log | Read and export the event log |
| Databases | Create and switch databases |
| Publish | Publish and restore releases, and discard anyone's staged changes |
| Users | Approve, disable and manage accounts below their own role |
| Groups | Groups, their members and permissions, and what the User role allows |

**See access** on any account in **Users** lists every permission the person holds and where each one comes from, for example `Role: User` or `Group: Designers ⊂ Product`.

## Groups

**Admin Panel → Groups** holds the groups. A group can:

- grant everyday permissions to its members,
- be the only audience allowed to use a model or a workspace connector,
- set a default model for new chats,
- be shared with, like a person.

### Nesting

Put group B inside group A and everyone in B is also in A: they get A's permissions, A's models and connectors, A's shared projects, chats and skills, and A's default model (below B's own). Putting a group inside itself, directly or through others, is refused with an explanation. Groups nest at most 8 levels deep, and a server holds at most 2,000 groups.

When several groups set a default model, the order on the **Groups** page decides: the first group wins, then the nearer group. A person's own choice in **Settings** always comes first.

### Synced groups

Groups that come from an identity source keep their membership in that source and are read-only here:

| Source | Comes from |
| --- | --- |
| Single sign-on | The groups claim of an OpenID Connect provider, when **Keep groups in sync** is on, updated at every sign-in |
| Directory | LDAP `memberOf` or a group search, updated at sign-in and at every directory sync |
| Provisioned | SCIM groups pushed by your identity provider |
| Proxy | The groups header, when the proxy sends one |

You can still give a synced group permissions and a default model, share with it, and nest it inside a local group. A synced group cannot contain other groups, because the next sync would undo it.

## Model and connector availability

In a model's **General** tab, and on each workspace MCP server, you can limit who may use it to chosen groups. People outside those groups never see it in the picker, cannot select it through the API and never have its tools offered. Admins with the **Models** permission (for models) or the **Tools** permission (for connectors) can always use them, to test before rolling out. Model availability is staged and published with the rest of the model.

## Sharing

People can share their own projects, chats and skills from the **Share** button. The share dialog searches people and groups, sets a level, and shows everyone who has access and why.

| Level | Project | Skill | Chat |
| --- | --- | --- | --- |
| **View** | Open it, read its knowledge, notes and instructions, and start chats in it | Use it | Read it, and make a copy |
| **Edit** | Also change knowledge, notes and instructions | Also change it | (view only) |
| **Manage** | Also share it with others, up to their own level | Also share it | (view only) |
| **Owner** | Also delete it | Also delete it | Everything |

- Sharing needs the matching permission (**Share projects**, **Share chats** or **Share skills**), and you can never grant more than your own level.
- Sharing with a group reaches everyone in it, including nested groups, and follows membership as it changes.
- Chats started in a shared project belong to the person who started them. Others in the project see the project's shared context, never each other's chats, unless a chat is shared on its own.
- Code sessions cannot be shared. A shared chat opens read-only with **Make a copy**.
- Each item can be shared with at most 200 people and groups.
- Anything you cannot reach answers "not found", never "forbidden", so its existence is not revealed. Files attached in a chat are readable only by the people who can read that chat.
- Admins cannot read a member's chats. The only exception is the review flow under **Quality**, which shows a chat only when it failed a quality check, was rated, or was turned into a test case, and records every view in the event log.

## The event log

**Admin Panel → Event log** keeps 120 days of security events, sorted into four categories:

| Category | Examples |
| --- | --- |
| **Sign-in** | Sign-ins, failed sign-ins, sign-outs, refused single sign-on, LDAP or proxy attempts, two-factor changes, password changes, revoked sessions, account recovery |
| **Access** | Sharing, group membership and nesting, roles, approvals, disabling and enabling accounts, review views |
| **Provisioning** | Every SCIM change, accounts created at first sign-in, directory syncs, sign-ups and deletions |
| **Administration** | Everything else: publishing, models, providers, sign-in settings, tokens, policy |

Each entry records who acted, from which address, what changed and when. Provisioning entries name the token that made the change, for example `SCIM: Okta`. **Export CSV** and **Export JSON Lines** download the whole log; JSON Lines is one event per line, ready for Splunk, Elastic, Microsoft Sentinel or any other SIEM. See [Enterprise deployment](enterprise.md#monitoring-and-audit).