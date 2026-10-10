# The Composer

The composer is the message box at the bottom of every chat and in the middle of the home screen. Besides text, it handles attachments, voice, slash commands and a few per-message switches.

## The parts

From left to right: the **+** menu, the message field, the model picker, the microphone, and a button that changes with what is happening:

- **Send** when there is text to send.
- **Start a voice call** (a waveform) when the field is empty and calls are on.
- **Stop** while a reply is being written. Type something and it becomes **Queue** or **Steer** instead, see [Chatting](chatting.md#sending-and-streaming).

In the OpenAI layout the model picker sits at the top left of the chat instead.

## Attachments

Drop files onto the window, paste them, or use **+ → Add files or photos** (`Ctrl+U`). Any file type can be attached; text, code and PDFs are read by the model, and images are sent only to models an admin has given **Image input**, always at their full original quality. Formats a model cannot read (BMP, AVIF, ICO, and TIFF in browsers that open it) are converted to a lossless PNG of the same size when you attach them; HEIC photos are not, so share a JPEG copy instead. On a model without image input, images you add are left out and the composer says so. Each attachment shows as a removable chip above the field.

**+ → Take a screenshot** captures a screen, window or browser tab through your browser's screen picker and attaches the image.

Inside a project, files you attach in a chat can be pinned to keep them in context. See [Chatting](chatting.md#message-actions).

## Dictation

The microphone turns speech into text in the field. Depending on how the admin set up **Voice**, it uses your browser's built-in speech recognition, which types as you speak, or a speech-to-text server, which records until you stop and then transcribes. If neither is available, or the microphone is blocked, a message explains why. The admin can hide the microphone altogether.

## Slash commands

Type `/` at the start of the field for a list of commands: **New chat**, turn **Sandbox tools** or **Web search** on or off, **Keyboard shortcuts**, and every prompt you have saved. Keep typing to filter, use the arrow keys to move and **Enter** or **Tab** to pick. **Esc** closes the list.

## The + menu

| Item | Does |
| --- | --- |
| **Add files or photos** | Attach files, see above |
| **Take a screenshot** | Attach a capture of your screen |
| **Add to project** | Move this chat into one of your projects, or out of one |
| **Response style** | Normal, Concise, Explanatory, Formal or one of your own |
| **Compare models** | Pick up to two more models to answer your next message, each reply becoming a version of one response |
| **Skills** | Turn your skills on or off for this chat, or browse and manage them |
| **MCP** | Opens your MCP servers in Settings |
| **Sandbox tools** | Gives the assistant a workspace with files and a shell. See [Artifacts & Sandbox](artifacts-sandbox.md) |
| **Web search** | Lets the assistant search the web, shown only when an admin has set it up |

Items only appear when they apply. Sandbox tools and web search depend on the model, and both are off in incognito chats. Styles and instructions are covered in [Styles & Instructions](styles-and-instructions.md).

## Plans and questions

Models with the right tools can show their work above the composer:

- A **Plan** lists the steps the assistant is working through and ticks them off as it goes.
- A **Question** asks you to pick an answer, or several, before it continues. Pick one, or ignore the options and type your own reply.

## Voice calls

When calls are on and the field is empty, the waveform button starts a call. A full-screen panel shows an animated mark that reacts as it listens, thinks and speaks, and replies are read out as they are written. Tap to interrupt, use the mute button to stop your microphone, and the close button to hang up. Calls are not available in incognito chats.

## Banners

Messages appear above the composer when something needs your attention: the selected model was removed, is unavailable or is going away on a date, the assistant ended the conversation, a message was blocked by the safety check, or you are close to or over a monthly spending cap set by an admin.

## Drafts

Anything you type and do not send is saved per chat, and separately for the home screen, so leaving or reloading never loses it. Incognito chats are the exception: nothing typed there is stored.