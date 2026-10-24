# Settings

Open **Settings** from the profile menu, or with `Ctrl+,`. The search box at the top finds any setting by name.

The left column has three groups: **Settings** (General, Interface, Security, Keybinds, Memory and Usage), **Customize** (Skills and MCP) and **About** (Version).

## General

**Profile**

- **What should we call you?** Your display name, used in greetings.

**Preferences**

- **Language**: the interface language on this device. Chats and replies are not translated.
- **Instructions for the Assistant**: added to every chat, up to 8000 characters. See [How instructions combine](#how-instructions-combine).

**Your data**

- **Export** downloads your chats, styles and memory as one JSON file.
- **Import** reads one of those files back. Imported chats are added, and profile data is merged.

**Danger zone**

- **Delete all saved chats** removes every chat and its files. Your account stays.
- **Reset all settings** returns settings to the defaults for the current theme. Chats and your account are untouched.
- **Delete account** removes your account and everything in it. The owner account cannot be deleted.

## How instructions combine

Several sources can apply to one chat. All of them are sent together:

- The **Instructions for the Assistant** in General, which apply to every chat.
- **Project instructions**, which apply to every chat in that project.
- **Chat instructions**, which apply to one chat.
- The **response style** you picked for the chat.

An admin's system prompt for the model sits around all of these. **What gets sent** (`Alt+P`) shows exactly what ended up in the prompt.

## Interface

This page controls how the app looks and behaves on this device. The layout itself is set by an admin.

**Appearance**

- **Colour palette**: **System** follows your device, or pick a palette for the current layout. Colours only.
- **Chat font**: Theme default, Literata, Newsreader or Open Sans. Applies to this device only.
- **Message density**: Comfortable or Compact.
- **Reading width**: Comfortable, or Wide for tables and code.
- **OLED screen protection**: nudges the interface a few pixels and eases brightness to limit burn-in.
- **Speed on each reply**: shows tokens per second beside each reply. See [Models and reasoning](models.md#readouts).

**Streaming text**

- **Auto-scroll**: keeps the latest text in view unless you scroll up.
- **Text reveal**: Instant, Modern (words fade in) or Legacy (letters type out). Not every layout offers this.
- **Reveal speed**: Fast, Normal or Relaxed. Shown with the Legacy style.
- **Streaming cursor**: a block or a circle at the point where text is being written, with blink or pulse speed.
- **Engine telemetry**: live speed and context fill above the composer while a reply streams.
- **Progress line**: shows what the model is doing when a reply takes a while.
- **Mid-stream steering**: lets you correct a reply while it is being written. See [Chatting](chatting.md#sending-and-streaming).

**Notifications**

- **Notify when a reply is ready**: a system notification when a chat you are not looking at finishes, including scheduled tasks. If your browser blocks notifications, allow them in the site settings first.

**Navigation**

These are tools for moving around a long conversation. Turning one off removes its button and shortcut. See [Chatting](chatting.md#finding-your-way-around-a-long-chat).

- **Conversation map**: a rail down the right edge with one mark per turn. Off by default.
- **Find in conversation**
- **Branch map**
- **Contents**
- **Message shortcuts**

**Tools and context**

- **Web search on by default**: new chats start with web search on, where the model allows it. Shown only when web search is set up.

**Presets and themes**

Two settings are easy to mix up:

- The **preset** (Anthropic-style or OpenAI-style) sets the whole layout: fonts, composer shape and where the model picker sits. An admin sets it for everyone.
- The **theme** is the colour palette you choose here. Themes never change the layout.

## Security

- **Password**: change it. Every other device is signed out. Passwords must be at least 4 characters.
- **Two-factor authentication**: set it up with an authenticator app, then keep the recovery codes somewhere safe. See [Privacy and security](privacy-security.md#two-factor-authentication).
- **Active sessions**: every device signed in to your account, with its browser, address and last activity. **Revoke** one device, or **Revoke others** to end every session except this one. Sessions expire after 30 days without use.

## Keybinds

Change any shortcut, switch between the defaults and a Vim-style layout, or export and import your keys. See [Keyboard shortcuts](keyboard-shortcuts.md).

## Memory

Memory is a list of facts about you that the assistant saves while you chat, so later conversations can use them. It is stored on this server.

- **Use memory in chats**: when on, the assistant sees your memories and can save new ones. When off, it can neither read nor change them.
- **Saved memories**: add, edit or delete entries. Each one shows whether you or the assistant added it.
- **Forget everything** deletes every saved memory.

Memory works only with models an admin has given the memory tool.

## Usage

Your token counts and estimated cost, broken down by model, for the last 7, 30 or 90 days, or all time.

Cost is estimated from prices an admin set. Models marked **no price** are local or free.

## Customize

**Customize** in the sidebar opens this group directly.

**Skills**

Skills are instruction files the assistant loads when a task matches their description.

- **Browse** a list of starter skills and add the ones you want.
- **Add** a skill by writing its instructions, uploading a file, or using **Create with the assistant**, which starts a chat that writes one with you.
- Enable, disable, edit, try or remove each skill.

Skills an admin added for the whole workspace appear here too, but only admins can change them. You can also turn skills on or off for one chat from **+ → Skills** in the composer.

**MCP**

Connect your own MCP servers over HTTP so their tools work in your chats. Press **Add server**, give it a name and URL, and add any headers it needs, such as an API key. Paste the JSON from a server's README and the fields fill in.

Saved headers stay on the server and are never shown again. Each server shows whether it is connected and which tools it offers. You can reconnect, edit, disable or delete it.

Servers listed under **From this workspace** were added by an admin and cannot be changed here. Servers that run as a local command can only be added by an admin.

## About

**Version**

The version you are running, its release notes and a link to the changelog. **Copy details** copies the version information for a bug report.