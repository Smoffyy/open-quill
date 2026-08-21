# Privacy & Security

## Incognito chats

Toggle the ghost icon near the composer (`Alt+I`, or the command palette) to start a temporary chat. While in incognito:

- Nothing is saved to your chat history. Closing it or leaving is permanent and immediate.
- The sandbox and web search are unavailable.
- Showcase backgrounds and other per-chat cosmetics are suppressed.
- Voice calls are disabled.
- Drafts aren't written to local storage either, unlike a normal chat's autosaved draft.

Leave incognito with the **✕** on its topbar, or by starting/opening a real chat.

## Two-factor authentication

Set up in **Settings → Security**: scan a QR code with an authenticator app (or type in the secret manually), confirm a code, and you're given one-time recovery codes. Store these somewhere safe, they're the only way back in if you lose the device. From then on, signing in asks for a 6-digit code after your password. 2FA can be disabled (password required) and recovery codes regenerated at any time.

## Sessions

**Settings → Sessions** lists every device currently signed into your account with browser/OS, IP address, and last-active time. Revoke any one of them, or **Revoke all other sessions** if you're not sure what's still logged in somewhere. Sessions also expire on their own after 30 days.

## Account and data deletion

- **Delete all chats** (Settings → General) removes every chat but keeps the account.
- **Delete account** removes the account and everything tied to it. It's hidden for the workspace owner, since deleting that account would leave the workspace without an admin.
- An admin can also purge chats or remove a member from **Admin Panel → Members**.

## Spending limits

If an admin has set a budget for your account or the workspace, the composer shows a warning banner as you approach the cap and a blocking banner once you're over it. There's no separate account page for this, it surfaces right where you'd hit it.

## What leaves the machine

Open Quill is designed to run entirely on your own hardware. Nothing is sent anywhere unless a feature is explicitly configured to reach an external destination:

- **Model requests** go to whatever provider URL is configured, a local server by default, or a cloud provider if an admin adds one.
- **Voice** (dictation/calls) uses whatever speech endpoint is configured, local by default.
- **Web search** is off unless enabled, and only reaches the SearXNG instance the admin points it at (plus the actual result pages it fetches, which is the point of a search).
- **Connectors (MCP)** only run servers an admin has explicitly added.
- **The sandbox** runs code with the same network access as the host machine. A script it runs could make its own requests, same as if you'd run it yourself.

There's no telemetry, analytics, or crash reporting anywhere in the app. The **Analytics** tab in the admin panel is your own local usage data, computed from your own database, never transmitted. See the [root README](../README.md#privacy-and-local-only-operation) for the technical enforcement behind this (egress guard, CSP, build-time checks).
