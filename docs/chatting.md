# Chatting

## Sending and streaming

Type in the composer and press **Enter** to send (`Shift+Enter` inserts a newline instead). The reply streams in token by token with a fade-in reveal. While it's streaming you can:

- **Stop** it (`Ctrl+.` or the stop button that replaces send).
- **Steer** it by sending a correction that's folded into the reply without discarding what's already been written (if enabled, see [Settings](settings.md)).
- **Queue** a follow-up message. It's held and sent automatically the instant the current reply finishes, with a counter showing how many are queued.

The thread auto-scrolls as new content arrives; scroll up to read back and a **jump-to-bottom** control appears to snap back.

## Per-message actions

Hover a message (or focus it with `J`/`K` and use single-key shortcuts) for:

- **Copy**: copies the message text; code blocks also get their own hover-to-copy button.
- **Edit** (your messages): rewrites and resends from that point, forming a new branch (see below).
- **Retry** (assistant replies): regenerates the response, also forming a new branch. If more than one model is available you can retry with a different model than the one that answered originally.
- **Branch into new chat**: spins the conversation up to that point off into its own separate chat.
- Thumbs up/down feedback, if enabled by the admin, with an optional comment, visible to admins under **Admin Panel → Feedback**.

## Branching

Editing a message or retrying a reply doesn't overwrite history, it creates a sibling branch from that point, so nothing is ever lost. The conversation you're viewing is always one path through that tree.

- Small **version arrows** (`‹ 2/3 ›`) appear on any message with siblings, letting you step between versions in place.
- The **branch map** (`B`, or the header button) opens a full visual tree of every edit and retry. Long straight stretches collapse into "N more turns" you can expand, forks render as parallel columns labeled Version 1/2/…, and the active path is highlighted. Click a node already on your current path to jump to it; click a node on a different branch to switch onto it.
- **Side-by-side branch compare** lets you view two versions of a reply next to each other instead of stepping between them one at a time.
- **Cherry-pick**: copying a message from one branch onto your current one adds it as a new message on the active path. The source branch is untouched, so it's a copy, not a move.

## Navigating a long thread

Three optional aids, all under **Settings → Chat → Navigation** (each defaults on, and costs nothing when turned off since the feature isn't just hidden, it isn't mounted):

- **Thread rail**: a slim tick-mark strip along the right edge, one tick per turn, highlighting whichever part of the conversation is currently on screen. Click a tick to jump there.
- **Find in conversation**: `Ctrl+F` searches only the open thread instead of the browser's page search, highlighting every match and letting you step between them.
- **Message shortcuts**: `J`/`K` move focus between messages; with a message focused, `C`/`E`/`R`/`Y` copy/edit/retry/branch it without touching the mouse.

See [Keyboard Shortcuts](keyboard-shortcuts.md) for the complete list.

## Ending and organizing a chat

The chat header menu (**…**) offers Rename, Star, Archive, Fork, Copy all, per-chat instructions, pinned messages/files, and **Inspect context**, a full breakdown of exactly what gets sent to the model on the next turn (every segment, its role, token count, and a preview). See [Organizing Your Chats](organizing-chats.md) for folders, projects, spaces, and search.
