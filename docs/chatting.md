# Chatting

## Sending and streaming

Type in the composer and press **Enter** to send, **Shift+Enter** for a new line. The reply streams in as it is written. While it streams:

- **Stop** it with the stop button or `Ctrl+.`. If the assistant is in the middle of a tool step, it finishes that step and then stops.
- **Queue** a follow-up. Type while the reply is running and send it: the message waits above the composer and goes out the moment the reply finishes. Queued messages can be removed before they send.
- **Steer** the reply, if **Mid-stream steering** is on in **Settings → Chat**. A short correction such as "shorter" or "you misread the file" is applied to the reply in progress. It restarts from where it was cut, so it costs an extra request.

The thread follows new text as it arrives. Scroll up to read and it stops following; a button appears to jump back to the latest message (`Alt+↓`).

If a reply stops early, for example because it hit the length limit, a **Continue** button picks up where it left off.

## Message actions

Hover a message to see its actions. With **Message shortcuts** on you can also move between messages with `J` and `K` and act on the focused one from the keyboard.

**Your messages**: copy, edit, and from the **⋯** menu branch, pin or delete. Editing resends from that point as a new version.

**Assistant replies**:

- **Copy**, or copy what has been written so far while it is still streaming.
- **Read aloud**, using the speech settings the admin configured.
- **Good response** and **Bad response**, which an admin can see under **Admin Panel → Ratings**.
- **Retry**, and the arrow beside it to **Retry with** a different model.
- **Compare versions**, once a reply has more than one version.
- From the **⋯** menu: **Edit** the reply's text, **Branch** into a new chat, **Pin** it, or **Delete** it.

A pinned message is never folded into a summary when a long chat is compacted, so it always stays in what the model sees. Files attached to a message can be pinned the same way, with the pin button on the attachment.

## Branching

Editing a message or retrying a reply never overwrites anything. It creates a new version from that point, and the chat you see is one path through those versions.

- **Version arrows** (`‹ 2/3 ›`) on a message step between its versions in place.
- **Compare versions** shows the versions of a reply side by side, and **Use this version** switches to the one you like.
- The **branch map** (`B`, or **⋯ → Branch map**) draws every version as a tree. Long straight runs fold into "N more turns", and your current path is highlighted. Click any message to **Jump to this message** or **Switch to this branch**, or **Copy into the current branch** to bring it over without leaving where you are.
- **Branch** in a message's **⋯** menu copies the conversation up to that point into a new, separate chat.

## Finding your way around a long chat

These live under **Settings → Interface → Navigation**. Each one can be turned off, which removes its button and its shortcut.

- **Find in conversation** (`Ctrl+F`) searches the open chat and steps between matches. Turn it off to give `Ctrl+F` back to the browser.
- **Branch map**, described above.
- **Contents** (`Alt+O`) lists the headings in the assistant's replies. Click one to jump to it.
- **Conversation map** puts a rail down the right edge with one mark per turn. Off by default.
- **Message shortcuts**: `J`/`K` to move, then `C` copy, `E` edit, `R` retry, `Y` branch.

**Focus mode** (`Alt+F`) hides the sidebar and everything else but the conversation.

## What the model sees

Once a chat has started, the ring beside the model name shows how full the context window is; hover it for the exact count. After switching models it is recounted when you send the next message, or right away with Shift+Click on the ring. Two more views go deeper:

- **Inspect context** breaks the next request down into its parts: system prompt, instructions, memory, files and messages, with their token counts.
- **What gets sent** (`Alt+P`) shows the exact prompt in order, ready to copy.

When a chat outgrows the model's context window, older turns are compacted into a summary, if the admin has turned that on. **Conversation memory** in the **⋯** menu shows that summary.

## Managing a chat

Click the chat title in the top bar to rename it, star it, add it to or remove it from a project, export it as Markdown or JSON, or delete it. The same menu is on each chat in the sidebar. See [Organizing Your Chats](organizing-chats.md) for projects, archiving and search.