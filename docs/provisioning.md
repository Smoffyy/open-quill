# SCIM provisioning

With SCIM 2.0 your identity provider manages accounts and groups in Open Quill: people are created when they are assigned to the app, updated when their details change, disabled when they leave, and groups follow your directory. It works with Okta, Microsoft Entra ID, OneLogin, JumpCloud and any client that follows RFC 7643 and RFC 7644.

SCIM handles the account lifecycle. People still need a way to sign in, which is usually single sign-on with the same identity provider. See [The recommended setup](#the-recommended-setup).

## Turn it on

Only an owner can change provisioning, under **Admin Panel → Provisioning**.

1. Set the [public address](sign-in.md#the-public-address) first, so the base URL is one your identity provider can reach.
2. Turn **Turned on** on.
3. Copy the **Base URL**, which is your public address followed by `/scim/v2`.
4. Under **Tokens**, press **New token**, name it after the identity provider, choose how long it lasts, and copy it. The token is shown once. Open Quill keeps only a hash of it.
5. Paste the base URL and the token into your identity provider, as below.

| Setting | Choices |
| --- | --- |
| **New accounts** | **User**: people can use their account right away. **Pending**: they wait for an admin to approve them |
| **When someone is removed** | **Disable** (default): the account is turned off, its chats are kept, and provisioning the same person again restores it. **Delete**: the account is deleted with all its chats and files |
| **Existing accounts with the same email** | **Off** (default): creating a user whose email already has an account here is refused. **Below admin**: an existing account below the admin role is handed over to provisioning; its password and sessions end and its chats stay. Admin and owner accounts are never handed over |

SCIM never assigns roles. Provisioned people get the User or Pending role, and admins change roles under **Users** as usual. Open Quill refuses any change that would disable or remove the last owner.

**Recent activity** lists the latest changes and the token that made them. Every change is also in the event log under **Provisioning**.

## The recommended setup

For most companies:

1. **SCIM** creates, updates and disables accounts, and pushes the groups you use for permissions and model access.
2. **Single sign-on** with the same identity provider lets people sign in. Set the provider's **New accounts** to **Off**, so only provisioned people get in, and turn on **Link existing accounts by email**, so each provisioned account links itself at its first sign-in.
3. **Registration** under **Users** is **Closed**.
4. Give the SCIM groups their permissions, default models and model access under **Groups**.

Provisioned accounts have no password, which is what allows the first single sign-on to link them safely. See [Linking accounts](sign-in.md#linking-accounts).

## Okta

1. In the Okta Admin Console, open your Open Quill app (or create an app integration with SAML or OIDC for sign-in), then the **General** tab, and enable **SCIM provisioning**.
2. On the **Provisioning** tab, under **Integration**, set:
   - **SCIM connector base URL**: the base URL from Open Quill
   - **Unique identifier field for users**: `userName`
   - **Supported provisioning actions**: Push New Users, Push Profile Updates and Push Groups
   - **Authentication Mode**: HTTP Header, with the token as the **Bearer** value
3. Press **Test Connector Configuration**, then save.
4. Under **Provisioning → To App**, enable **Create Users**, **Update User Attributes** and **Deactivate Users**.
5. Assign people and groups to the app. Use **Push Groups** for the groups Open Quill should know about.

Okta's userName is usually the email. If yours is not, make sure the profile has an email, because Open Quill uses it to sign people in.

## Microsoft Entra ID

1. In the Microsoft Entra admin center, open **Enterprise applications → New application → Create your own application**, and choose **Integrate any other application you don't find in the gallery**.
2. Open **Provisioning**, set **Provisioning Mode** to **Automatic**, and enter:
   - **Tenant URL**: the base URL from Open Quill
   - **Secret Token**: the token
3. Press **Test Connection**. Entra checks the connection by looking up a user that does not exist, which Open Quill answers with an empty list.
4. Under **Mappings**, keep the user mapping for `userName`, `active`, `displayName`, `emails[type eq "work"].value`, `name.givenName`, `name.familyName` and `externalId`. Remove mappings Open Quill does not keep if you want shorter logs; unsupported attributes are ignored.
5. Assign users and groups under **Users and groups**, set **Provisioning Status** to **On**, and save.

Entra disables a person by setting `active` to false, and deletes them about 30 days after they are removed from the app. Open Quill follows **When someone is removed** for the delete.

## Other identity providers

Any SCIM 2.0 client works. Point it at the base URL with the token as an HTTP Bearer token. The discovery endpoints `/ServiceProviderConfig`, `/ResourceTypes` and `/Schemas` describe exactly what is supported.

## What is stored

| SCIM attribute | Used for |
| --- | --- |
| `userName` | Unique per provisioned user, compared without case |
| `emails` | The primary or work email becomes the sign-in email. Without one, `userName` is used if it is an email address |
| `displayName`, `name` | The name shown in Open Quill. Without a display name, the formatted or given and family name is used |
| `active` | `false` disables the account at once: sessions end, open windows disconnect and running replies stop. `true` turns it back on |
| `externalId` | Your identity provider's own ID, unique per provisioned user |
| `title`, `nickName`, `userType`, `preferredLanguage`, `locale`, `timezone`, `phoneNumbers` | Kept and returned as sent |
| Enterprise extension: `employeeNumber`, `costCenter`, `organization`, `division`, `department`, `manager` | Kept and returned as sent |
| `password`, `roles` and anything else | Ignored |

Groups have a `displayName` (unique among provisioned groups), an `externalId` and `members`. Members must be provisioned users. Groups inside groups are not accepted over SCIM; nest groups under **Groups** in Open Quill instead.

## Protocol details

| Feature | Support |
| --- | --- |
| Users and Groups | Create, read, replace (`PUT`), update (`PATCH`) and delete |
| Filters | `eq`, `ne`, `co`, `sw`, `ew`, `gt`, `ge`, `lt`, `le`, `pr`, `and`, `or`, `not`, parentheses and bracketed filters such as `emails[type eq "work"]`. `userName eq`, `externalId eq` and `id eq` use indexes |
| Paging | `startIndex` and `count`, up to 200 results per page |
| Attributes | `attributes` and `excludedAttributes`, for example `excludedAttributes=members` |
| PATCH | `add`, `replace` and `remove`, in any letter case, with or without a path, including `members[value eq "..."]` and the value-list removals Entra sends. All operations in a request apply together or not at all |
| Not supported | Bulk, sorting, ETags and password changes, as declared in `/ServiceProviderConfig` |
| Errors | The SCIM error schema with a `scimType`, such as `uniqueness`, `invalidFilter`, `invalidValue` or `mutability` |

Requests are limited to 1 MB and to 1,200 per minute per token. Tokens are 256-bit random values that expire after the chosen time; an owner can create up to 20 and revoke any of them at once. SCIM requests never use cookies and are refused when provisioning is turned off.

## Troubleshooting

| Response | Meaning |
| --- | --- |
| `401` | The token is missing, wrong, expired or revoked. Create a new one |
| `403` | Provisioning is turned off |
| `409 uniqueness` | Another provisioned user has the same userName, email or externalId, or an account with that email exists and is not managed by provisioning. Hand it over with **Existing accounts with the same email**, or remove it |
| `400 invalidValue` on a group | A member is not a provisioned user. Assign the person to the app first |
| `400 mutability` | The change would turn off or remove the last owner |
| `429` | Too many requests. Your identity provider retries on its own |