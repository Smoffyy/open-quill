# Chatting

## Sending and streaming

Type in the composer and press **Enter** to send. **Shift+Enter** starts a new line. The reply streams in as it is written. While it streams, you can:

- **Stop** it with the stop button or `Ctrl+.`. If it is in the middle of a tool step, it finishes that step first.
- **Queue** a follow-up by typing and sending while the reply runs. The message waits above the composer and sends when the reply finishes. You can remove it before it sends.
- **Steer** the reply, if **Mid-stream steering** is on under **Settings → Interface → Streaming text**. A short correction such as "shorter" is applied to the reply in progress. It costs an extra request.

The thread follows new text. Scroll up to read, and it stops following. A button jumps you back to the latest message (`Alt+↓`).

If a reply stops early, for example at the length limit, press **Continue** to pick up where it left off.

## Message actions

Hover a message to see its actions. With **Message shortcuts** on, `J` and `K` move between messages, and the keys below act on the focused one.

**Your messages:** copy, edit, and from **⋯**, branch, pin or delete. Editing resends from that point as a new version.

**Assistant replies:**

- **Copy**, including the text so far while it is still streaming
- **Read aloud**, using the speech settings your admin chose
- **Good response** or **Bad response**. Admins see these under **Admin Panel → Ratings**
- **Retry** to write the reply again. To use another model, pick it in the picker first
- **Compare versions**, once a reply has more than one version
- From **⋯**: **Edit** the text, **Branch** into a new chat, **Pin** or **Delete**

A pinned message is never folded into the summary, so the model always sees it. You can pin an attachment the same way.

## Branching

Editing a message or retrying a reply never overwrites anything. It creates a new version from that point. The chat shows one path through the versions.

- **Version arrows** (`‹ 2/3 ›`) switch between versions in place.
- **Compare versions** shows the versions side by side. **Use this version** picks one.
- The **branch map** (`B`, or **⋯ → Branch map**) draws every version as a tree. Click a message to jump to it, switch to its branch, or copy it into the current branch.
- **Branch** in a message's **⋯** menu copies the conversation up to that point into a new chat.

## Finding your way around a long chat

These live under **Settings → Interface → Navigation**. Turning one off removes its button and shortcut.

- **Find in conversation** (`Ctrl+F`) searches the open chat. Turn it off to give `Ctrl+F` back to the browser.
- **Branch map**, described above.
- **Contents** (`Alt+O`) lists the headings in replies.
- **Conversation map** adds a rail down the right edge with one mark per turn. Off by default.
- **Message shortcuts**: `J` and `K` move, `C` copies, `E` edits, `R` retries and `Y` branches.

**Focus mode** (`Alt+F`) hides everything except the conversation.

## What the model sees

The ring beside the model name shows how full the context window is. Hover it for the exact count. After you switch models, the count is updated when you send the next message. Shift+click the ring to update it right away.

**What gets sent** (`Alt+P`) shows the exact prompt, in order, ready to copy.

When a chat fills about two thirds of the context window, the model folds its oldest turns into a rolling summary after a reply, so your next message does not wait for it. The most recent turns and pinned messages always stay word for word.

- **Conversation memory** in the **⋯** menu shows the summary.
- When a turn with an image is summarized, a vision model writes a description of the image once. That description stays next to the summary.
- A model that uses tools can search the exact wording of summarized messages with **recall**.
- If the window still overflows, long parts of older turns (images, long code blocks, tool output) are trimmed first. Old messages are dropped only as a last resort.
- If a reply runs out of room partway through, it stops cleanly, and **Continue** picks it up.

## Managing a chat

Click the chat title in the top bar to rename it, star it, add or remove it from a project, export it, or delete it. The same menu is on each chat in the sidebar. See [Organizing your chats](organizing-chats.md) for projects, archiving and search.