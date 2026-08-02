# Open Quill Documentation

This is the user guide for Open Quill, covering everything the interface can do. It's written for people using the app, not people building it. If you're looking for build/deploy instructions, environment variables, or database management, see the [root README](../README.md). These docs cover what you can do once the app is running.

## Guides

| Guide | What's in it |
| --- | --- |
| [Getting Started](getting-started.md) | Creating your account, first-run setup, connecting a model |
| [Interface Overview](interface-overview.md) | The layout: sidebar, topbar, home screen, themes and presets |
| [Chatting](chatting.md) | Sending messages, streaming, editing, retrying, branching, the branch map |
| [The Composer](composer.md) | Attachments, dictation, slash commands, the "+" menu, steering/queueing, voice calls |
| [Models & Reasoning](models.md) | Picking a model, extended thinking, kwargs, context gauge, engine telemetry |
| [Personas, Styles & Prompts](personas-styles-prompts.md) | Personas, response styles, saved prompts, Improve Prompt |
| [Organizing Your Chats](organizing-chats.md) | Folders, projects, spaces, search, pins, export/import |
| [Artifacts & Sandbox](artifacts-sandbox.md) | The per-chat file workspace: versions, previews, downloads |
| [Settings](settings.md) | Every tab in the Settings modal, field by field |
| [Keyboard Shortcuts](keyboard-shortcuts.md) | The full default keymap and how to rebind it |
| [Privacy & Security](privacy-security.md) | Incognito chats, 2FA, sessions, account deletion, local-only networking |
| [Admin Guide](admin-guide.md) | Every tab in the Admin Panel, for whoever administers the workspace |

## Conventions used in these docs

- **Bold** marks a clickable label, button, or field name exactly as it appears in the UI.
- `Ctrl+K`-style combos are shown in their Windows/Linux form. On macOS, `Ctrl` becomes `Cmd`. Every shortcut is rebindable, see [Keyboard Shortcuts](keyboard-shortcuts.md).
- Anything under **Admin Panel** requires an admin account. Everything else is available to any signed-in user.
- Open Quill ships two interface presets, Anthropic-style and OpenAI-style. These docs describe behavior that is identical across both. Where a preset changes something meaningfully, it's called out.
