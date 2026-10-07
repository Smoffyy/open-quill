# Interface Overview

## The sidebar

Down the left edge, from top to bottom:

- **App name and version**, with buttons to collapse the sidebar (`Ctrl+Shift+S`) and to search your chats (`Ctrl+Shift+F`). Drag the sidebar's edge to resize it.
- **New** starts a chat (`Ctrl+Shift+O`). The small button beside it opens **Scheduled** tasks.
- **Projects**, **Artifacts**, **Scheduled** and **Customize** open full pages. See [Organizing Your Chats](organizing-chats.md), [Artifacts & Sandbox](artifacts-sandbox.md) and [Settings](settings.md#customize).
- **Projects** lists your projects, **Starred** your starred chats, and **Recents** everything else. The **Group by** button on Recents groups chats by date, by project or not at all. **All chats** at the bottom of the list opens the chats overview.
- **Model docs** opens the model reference, a page per model with what it is good at, what it accepts and what it costs.
- **Your name**, at the bottom, opens the profile menu.

Chats, projects and New are real links, so middle-click or `Ctrl`-click opens them in a new tab.

## The profile menu

| Item | Opens |
| --- | --- |
| **Admin Panel** | Workspace administration, for editors and up. See the [Admin Guide](admin-guide.md) |
| **Playground** | A bench for testing models and prompts, for editors and up |
| **Settings** | Your own settings (`Ctrl+,`). See [Settings](settings.md) |
| **Credits**, **Changelog**, **Licensing** | The project's credits, release history and license |
| **Privacy & security** | How this app handles your data |
| **Log out** | Signs this device out |

## The home screen

Shown when no chat is open: a greeting, the composer and, if an admin has set them up, starter prompts underneath. The top right has the incognito button (a ghost, `Alt+I`), the artifacts button and a **⋯** menu with **Personas**.

## The chat view

The open conversation fills the middle, with the composer pinned to the bottom.

The top bar shows the chat title. Click it for the chat menu: rename, star, add to or remove from a project, export as Markdown or JSON, and delete. On the right are the incognito button, the artifacts button (with a badge counting files) and the **⋯** menu:

| Item | Does |
| --- | --- |
| **Conversation memory** | Shows the summary that replaced older messages, once a long chat has been compacted |
| **Personas** | Apply a saved persona to this chat |
| **Copy all** | Copies the whole conversation |
| **Inspect context** | A breakdown of everything sent to the model on the next turn |
| **Chat controls (admin)** | Per-chat system prompt and sampling overrides, admins only |
| **Find in conversation** | Search inside this chat (`Ctrl+F`) |
| **Branch map** | Every branch of the conversation as a tree (`B`) |
| **Contents** | The headings in the assistant's replies, for jumping around (`Alt+O`) |
| **Focus mode** | Hides everything but the conversation (`Alt+F`) |

Some items only appear once they apply, for example Contents needs a reply with headings.

## Presets and themes

Two settings that are easy to mix up:

- The **preset** (Anthropic-style or OpenAI-style) is the whole layout: fonts, composer shape, where the model picker sits. An admin sets it for everyone under **Admin Panel → Interface**, and it switches live.
- The **theme** is yours, under **Settings → Interface → Theme**. Choose **System** to follow your device's light or dark mode, or pick a palette that belongs to the current preset, such as Anthropic Light or Anthropic Dark 2026 Q3. Themes change colors only, never the layout.

An admin can also build a fully custom look with the theme builder, which sits on top of whichever preset it is based on.

## Command palette

`Ctrl+K` opens a searchable list of commands: start a chat, open a page, toggle a setting, switch theme and most other actions in these docs. It is the quickest way to find something when you do not remember which menu holds it.

## Language

**Settings → General → Language** sets the interface language for this device. It changes the app's text, not the language the model replies in. Open Quill ships English, German, Spanish (Spain and Mexico), French, Portuguese, Russian, Japanese, Korean and Simplified Chinese.