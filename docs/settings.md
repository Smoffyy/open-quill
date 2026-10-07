# Settings

Open **Settings** from the profile menu at the bottom left, or with `Ctrl+,`. The search box at the top of the window finds any setting by name and jumps to it.

## Settings

### General

- **What should we call you?** Your display name, used in greetings.
- **Language**: the interface language on this device. Replies are not translated.
- **Instructions for the Assistant**: added to every chat you have, up to 8000 characters.
- **Export everything** downloads your chats, styles, personas, prompts and memory as one JSON file. **Import** reads one back, adding its chats and merging the rest.
- **Danger zone**: **Delete all chats** (your account stays), **Reset all settings** to the current theme's defaults, and **Delete account**, which removes the account and everything in it. The owner account cannot be deleted.

### Interface

**Appearance**

- **Theme**: **System** follows your device, or pick one of the current preset's palettes. Colors only, the layout never changes.
- **Chat font**: overrides the theme's font on this device.
- **Message density**: Comfortable or Compact.
- **Reading width**: Comfortable, or Wide for tables and code.
- **OLED screen protection**: shifts the interface by a few pixels and eases brightness to limit burn-in.

**Streaming text**

- **Text reveal**: **Instant**, **Modern** or **Legacy**, with a reveal speed for the animated styles.
- **Streaming cursor**: a cursor at the point where text is being written, with a choice of block or circle and its blink or pulse speed.

**Navigation**: **Conversation map**, **Find in conversation**, **Branch map**, **Contents** and **Message shortcuts**. See [Chatting](chatting.md#finding-your-way-around-a-long-chat). Turning one off removes its button and its shortcut.

### Security

- **Password**: change it. Every other device is signed out when you do.
- **Two-factor authentication**: set it up with an authenticator app, then keep the one-time recovery codes somewhere safe. See [Privacy & Security](privacy-security.md#two-factor-authentication).
- **Active sessions**: every device signed in to your account, with browser, address and last activity. **Revoke** one, or **Revoke others** to end every session except this one. Sessions end on their own after 30 days without use, unless an admin changed that limit.

### Chat

- **Auto-scroll**: follow the reply as it is written unless you scroll up.
- **Web search on by default**: new chats start with web search on, where the model allows it. Shown only when web search is set up.
- **Engine telemetry**, **Speed on each reply** and **Progress line**: see [Models & Reasoning](models.md#readouts).
- **Mid-stream steering**: lets you correct a reply while it is being written. See [Chatting](chatting.md#sending-and-streaming).

### Keybinds

Change any shortcut, switch presets or back up your layout. See [Keyboard Shortcuts](keyboard-shortcuts.md).

### Memory

Memory is a list of facts about you that the assistant saves while you chat, so later conversations can use them. It is stored on this server.

- **Use memory in chats**: when on, the assistant sees your memories and can save new ones. When off, it can neither read nor change them.
- **Saved memories**: add your own, or edit and delete any entry. Each entry shows whether you or the assistant added it.
- **Forget everything** deletes every saved memory.

Memory only works with models an admin has given the memory tool.

### Usage

Your own token counts and estimated cost for the last 7, 30 or 90 days, or all time, broken down by model. Cost is estimated from prices an admin set; models marked **no price** are local or free.

## Customize

**Customize** in the sidebar opens this group directly.

### Skills

Skills are instruction files the assistant loads when a task matches their description.

- **Browse** a directory of starter skills and add the ones you want.
- **Add** one by writing it (**Write skill instructions**), uploading a file (**Upload a skill**), or **Create with the assistant**, which starts a chat that writes one with you.
- Each skill can be enabled, disabled, edited, tried in a chat or removed.

Skills an admin added for the whole workspace appear too, but are managed in the Admin Panel. Turn skills on or off per chat with the composer's **+ → Skills**.

### MCP

Connect your own MCP servers over HTTP so their tools are available in your chats. **Add server**, give it a name and URL, and add headers such as an API key if it needs them. **Import a config** fills the fields from the JSON in a server's README. Saved headers are kept on the server and are not shown again.

Each server shows whether it is connected and which tools it offers, and can be reconnected, edited, disabled or deleted. Servers listed under **From this workspace** were added by an admin for everyone and cannot be changed here. Servers that run as a local command can only be added by an admin.

## About

### Version

The version you are running, its release notes and a link to the changelog. **Copy details** copies the version information for a bug report.