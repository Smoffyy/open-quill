# Personas, Styles & Prompts

Three related but distinct ways to shape how the assistant responds, all reachable from the composer's **+** menu or the profile menu.

## Personas

A persona bundles a **model** and a set of **custom instructions** under a name. Think of it as a saved "mode" you can switch into with one click, rather than re-typing instructions every time. Open **Personas** from the profile menu to create one (name, a model or "Any"), edit, delete, or **Apply** an existing one, which sets both the model and the instructions for the current chat in a single action.

## Response styles

Styles change how replies are written without changing the model or instructions. Four are built in, **Normal**, **Concise**, **Explanatory**, **Formal**, and you can add your own from **+ → Response style → new style**, either by describing it in a prompt ("bullet points only, no preamble") or by pasting a writing sample and choosing **Generate from sample**, which asks the model to derive a style prompt that mimics it. Selecting a style applies immediately to the current chat.

## Saved prompts

If you find yourself typing the same message repeatedly, save it: **+ → Saved prompts → Save current text as prompt**. Saved prompts show up both in the **+** menu and as slash-command entries (type `/` and start typing the prompt's name), and can be deleted from the same submenu.

## Improve Prompt

Not a saved artifact, a one-off rewrite. **+ → Improve prompt** sends your current draft to the model and replaces it with a tightened-up version before you send it. Toggling it again restores exactly what you had typed, so it's safe to try and discard.

## Per-chat instructions vs. account-wide instructions

Two other places layer into every request, worth distinguishing from personas:

- **Settings → General → Instructions for the Assistant**: applies to every chat you have, account-wide.
- **Chat menu → per-chat instructions**: applies only to that one conversation, layered on top of the account-wide instructions.

A persona's instructions layer in the same way, scoped to whichever chat you applied it in.
