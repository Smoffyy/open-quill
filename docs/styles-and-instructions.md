# Styles & Instructions

A few ways to shape how the assistant answers without retyping the same instructions every time.

## Response styles

Styles change how replies are written without changing the model or the instructions. Four are built in: **Normal**, **Concise**, **Explanatory** and **Formal**. Pick one under **+ → Response style** and it applies to the chat straight away.

To make your own, choose **+ Create a style** in the same menu. Either describe it ("bullet points only, no preamble"), or paste a sample of writing you like and press **Generate from sample** to have the model write the style for you. Review it, name it and **Save style**. Your styles are listed under **Your styles** and can be deleted from there.

## Skills

Skills are instruction files the assistant loads on its own when a task matches their description, for example "writing release notes" or "reviewing SQL". Add your own under **Customize** in the sidebar, and switch them on or off per chat with **+ → Skills**. See [Settings](settings.md#customize).

## How instructions layer

Several sources of instructions can apply to the same chat. They are all sent together:

- **Settings → General → Instructions for the Assistant** applies to every chat you have.
- **Project instructions** apply to every chat inside that project.
- **Chat instructions** apply to one chat.
- The **response style** you picked.

The model's own system prompt, set by an admin, sits around all of these. **What gets sent** (`Alt+P`) shows exactly what ended up in the prompt.
