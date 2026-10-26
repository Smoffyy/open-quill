# The composer

The composer is the message box at the bottom of every chat and in the middle of the home screen.

## The parts

From left to right: the **+** menu, the message field, the model picker and the microphone. The button on the right changes with the situation:

- **Send**, when there is text to send
- **Start a voice call** (a waveform), when the field is empty and calls are on
- **Stop**, while a reply is being written. If you type something, the button becomes **Queue** or **Steer**. See [Chatting](chatting.md#sending-and-streaming)

In the OpenAI layout, the model picker sits at the top left of the chat.

## Attachments

Drop files on the window, paste them, or use **+ → Add files or photos** (`Ctrl+U`). On a model that cannot read images, the menu says **Add files** instead.

- Text, code and PDFs are read by the model.
- Images go only to models with **Image input**, at full original quality.
- If the model cannot read images, the composer leaves them out and tells you.

Each attachment appears as a removable chip above the field.

**+ → Take a screenshot** captures a screen, window or browser tab through your browser's screen picker.

## Dictation

The microphone turns speech into text in the field. It uses either your browser's speech recognition, which types as you speak, or a speech-to-text server set up by an admin, which transcribes when you stop. An admin can also hide the microphone.

## Slash commands

Type `/` at the start of the field to open a list of commands:

- New chat
- Incognito chat, or Exit incognito
- Web search, to turn it on or off
- Switch model
- Response style
- Skills
- Add to project
- Conversation memory
- What gets sent
- Keyboard shortcuts

Keep typing to filter. Use the arrow keys, then **Enter** or **Tab** to pick. **Esc** closes the list.

## The + menu

| Item | Does |
| --- | --- |
| **Add files or photos** | Attaches files (see above) |
| **Take a screenshot** | Attaches a capture of your screen |
| **Add to project** | Moves this chat into a project, or out of one |
| **Response style** | Picks a style for this chat |
| **Compare models** | Picks up to two extra models. Each one answers your next message, and the replies become versions of one response |
| **Skills** | Turns skills on or off for this chat, or browses and manages them |
| **MCP** | Opens your MCP servers in Settings |
| **Web search** | Lets the assistant search the web. Shown only when an admin has set it up |

## Response styles

A style changes how replies are written, not which model writes them. Four are built in: **Normal**, **Concise**, **Explanatory** and **Formal**. Pick one under **+ → Response style**.

To make your own, choose **Create a style** in the same menu. Describe it, or paste a sample of writing you like and generate a style from it. Review the style, give it a name and save it.

## Plans and questions

Models with the right tools can show their work above the composer:

- A **Plan** lists the steps the assistant is working through and ticks them off.
- A **Question** asks you to choose one or more answers before it continues. You can also type your own reply.

## Voice calls

When calls are on and the field is empty, the waveform button starts a voice call. A full-screen panel shows an animated mark that reacts while it listens, thinks and speaks. Replies are read aloud as they are written.

Use the call panel to mute your microphone or end the call. Calls are not available in incognito chats.

## Banners

A banner above the composer tells you when something needs attention:

- The selected model was removed or is unavailable.
- The assistant ended the conversation.
- A message was blocked by the safety check.
- You are near or over a monthly spending cap.

## Drafts

Anything you type and do not send is saved per chat, and separately for the home screen. Leaving or reloading does not lose it. Incognito chats are the exception: nothing you type is stored.