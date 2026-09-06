# Settings

Open **Settings** from the profile menu (bottom-left) or `Ctrl+,`. It's organized into four groups.

## Account

**General**
- Display name.
- Interface **Language**, device-only; it changes UI text, not what language the model replies in.
- **Instructions for the Assistant**, an account-wide system-prompt addition applied to every chat (up to 8000 characters).
- **Export everything**, downloads a JSON snapshot of chats, folders, styles, personas, saved prompts, memory, and preferences.
- **Import**, merges a snapshot back in; adds any chats it contains without touching existing ones.
- Danger zone: **Delete all chats**, **Reset all settings**, **Delete account** (the last is hidden for the workspace owner, who can't delete themselves out from under the workspace).

**Security**
- Change password.
- Two-factor authentication setup: scan a QR code (or enter the secret manually) in an authenticator app, confirm a code, and get one-time recovery codes. Recovery codes can be regenerated; 2FA can be disabled (password required).

**Sessions**
- Every device currently signed into your account: browser/OS, IP, and last-active time. Revoke any single session or **Revoke all other sessions** (useful if you think a device was left signed in somewhere). Sessions expire automatically after 30 days regardless.

## Interface

**Appearance**: Theme (System/Light/Dark), accent color, message density, font override, OLED screen protection. See [Interface Overview](interface-overview.md).

**Chat**, in four sub-sections:
- *Streaming*: typewriter reveal on/off and its speed, auto-scroll, streaming cursor style (block/circle) with blink/pulse speed.
- *Tools & context*: web search on by default, engine telemetry, context gauge, per-reply speed display, context ledger open by default, mid-stream steering. See [Models & Reasoning](models.md).
- *Navigation*: thread rail, in-thread find, branch map, message keyboard shortcuts. Each is opt-out and mounts nothing at all when off. See [Chatting](chatting.md).
- *Motion* and *Effects*: message entrance animation, staggered reveal, micro-interactions, model logo glow, input bar/focus effects. Purely cosmetic; turn them off for a calmer or lower-motion interface.

**Keybinds**: rebind any shortcut, pick a preset (default or a Vim-flavored layout), export/import your bindings. See [Keyboard Shortcuts](keyboard-shortcuts.md).

## Insights

**Memory** (if the admin has enabled it): turn memory use on/off for your chats, edit what the assistant remembers about you directly (up to 6000 characters), force an update from recent conversations, or clear it entirely.

**Usage**: your own token and cost totals over 7/30/90 days or all time, broken down per model. This is computed locally from your own chat history, not sent anywhere.

## About

App name/icon, version, and release notes.
