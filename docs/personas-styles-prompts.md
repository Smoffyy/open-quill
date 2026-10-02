# Personas, Styles & Prompts

A few ways to shape how the assistant answers without retyping the same instructions every time.

## Personas

A persona is a name, a model (or **Any**, to keep whatever is selected) and a set of chat instructions. Applying one switches the chat to that model and sets its instructions in one step. Think of it as a saved mode, such as "Senior code reviewer".

Open **Personas** from the **⋯** menu at the top right of the home screen or a chat. From there you can create a persona with **+ New persona**, edit or delete one, and **Apply** it to the current chat.

## Response styles

Styles change how replies are written without changing the model or the instructions. Four are built in: **Normal**, **Concise**, **Explanatory** and **Formal**. Pick one under **+ → Response style** and it applies to the chat straight away.

To make your own, choose **+ Create a style** in the same menu. Either describe it ("bullet points only, no preamble"), or paste a sample of writing you like and press **Generate from sample** to have the model write the style for you. Review it, name it and **Save style**. Your styles are listed under **Your styles** and can be deleted from there.

## Saved prompts

For messages you send often, type the text and choose **+ → Saved prompts → Save current text as prompt**. Saved prompts can be inserted from that menu, or from the slash command list by typing `/` and part of the name. They can be deleted from the same menu.

## Improve prompt

**+ → Improve prompt** sends your draft to the model and replaces it with a tightened version before you send it. Choose **Restore original prompt** to get back exactly what you typed.

## Skills

Skills are instruction files the assistant loads on its own when a task matches their description, for example "writing release notes" or "reviewing SQL". Add your own under **Customize** in the sidebar, and switch them on or off per chat with **+ → Skills**. See [Settings](settings.md#customize).

## How instructions layer

Several sources of instructions can apply to the same chat. They are all sent together:

- **Settings → General → Instructions for the Assistant** applies to every chat you have.
- **Project instructions** apply to every chat inside that project.
- **Chat instructions** apply to one chat. Applying a persona sets them.
- The **response style** you picked.

The model's own system prompt, set by an admin, sits around all of these. **Inspect context** in the **⋯** menu shows exactly what ended up in the prompt.