# The Composer

The composer is the input box at the bottom of every chat and the home screen. Beyond plain text, it's the entry point for attachments, voice, slash commands, and a handful of per-turn toggles.

## Attachments

Drag and drop a file, paste one, or use the file picker (`Ctrl+U` or the **+** menu → **Add files or photos**). Accepted types include text and code files (`.txt .md .csv .json .js .jsx .ts .tsx .py .lua .html .css .xml .yml .yaml .log`), PDFs, and images. Images only work with models the admin has marked as vision-capable. Attach multiple files at once; each shows as a removable chip above the composer.

## Dictation

The microphone button transcribes speech into the composer. Depending on how the admin has configured **Voice**, this is either your browser's built-in speech recognition (live, word-by-word) or a server-side speech-to-text engine (records while you hold/toggle, then transcribes on stop). If neither is available or permission is denied, a toast explains why.

## Slash commands

Type `/` at the start of an empty composer to open a filtered command list: **New chat**, toggling sandbox/web search on or off, **Keyboard shortcuts**, plus every prompt you've saved (see [Personas, Styles & Prompts](personas-styles-prompts.md)). Arrow keys and `Enter`/`Tab` select; `Esc` dismisses.

## The "+" menu

- **Add files or photos**: same as above.
- **Saved prompts**: insert, delete, or save your current draft as a new one.
- **Response style**: Normal, Concise, Explanatory, Formal, or any custom style you've created.
- **Improve prompt**: rewrites your current draft through the model before you send it; toggle again to restore what you originally typed.
- **Compare models**: pick up to two additional models to answer the same message alongside the one currently selected, so you can see several answers side by side.
- **Sandbox tools**: lets the assistant write and run files in a per-chat workspace. See [Artifacts & Sandbox](artifacts-sandbox.md).
- **Web search**: lets the assistant search the web (only shown if an admin has configured it).

## Voice calls

When the composer is empty and voice calls are enabled, the send button becomes a wave/call icon. Starting a call opens a full-screen panel with an animated orb reflecting listening/thinking/speaking state; replies are spoken back sentence by sentence as they stream. Tap the orb to interrupt it mid-sentence, use the mute button to stop your mic, and the **✕** to hang up.

## Banners

The composer surfaces context-sensitive banners above itself when relevant: the selected model has been removed or made temporarily unavailable, a model is scheduled for retirement (with a countdown that intensifies as the date nears), the assistant has ended the conversation, a message was flagged by the safety filter, or you're approaching or over a spending cap set by an admin.

## The right-hand controls

From left to right in the composer's action row: the context gauge (if enabled, see [Models & Reasoning](models.md)), the model dropdown, a docs button for the selected model, the microphone, and send/stop/steer, which swap in for each other depending on whether a reply is in flight.

## Drafts

Whatever you've typed but not sent is saved automatically per chat (and separately for the home screen's "new chat" box), so navigating away and back, or reloading the page, never loses a draft. Incognito chats are the one exception: nothing typed there is ever written to disk. See [Privacy & Security](privacy-security.md).
