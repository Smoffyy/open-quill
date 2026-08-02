# Models & Reasoning

## Picking a model

The model dropdown lives in the chat topbar (and on the home screen). It lists every model an admin has published, each with its configured icon and name; a "More models" submenu holds anything that doesn't fit the main list. Selecting a model only affects the current chat going forward, earlier replies keep whatever model actually generated them.

Some entries are **routers**: picking one doesn't run that model directly, it hands your message to a different model chosen automatically based on rules the admin configured (a keyword, a regex, "has an image," message length, and so on). The reply still shows which underlying model actually answered.

## Extended thinking / reasoning

Models the admin has flagged as reasoning-capable show an **Extended** toggle in the dropdown, plus (if the provider supports it) an effort slider. When a reasoning model replies, its thought process streams into a collapsible section above the final answer, collapsed by default to "Thinking…", or fully expanded if the admin allows it. This works whether the model emits `<think>` tags or a separate reasoning stream, and Open Quill appends the right trigger tokens (like `/think` or `/no_think`) automatically so you don't have to type them.

## Custom parameters (kwargs)

Some models expose extra request parameters directly in the picker, as a toggle, a slider, or a dropdown, depending on how the admin set it up. These map to whatever the underlying provider supports and aren't standardized across models, so check the model's docs page (the small "i"/docs button next to the picker) if one is unfamiliar.

## Per-chat overrides

The chat menu's **Chat Controls** section lets you override a model's system prompt and sampling parameters (temperature, top-p/top-k, min-p, max tokens, frequency/presence/repeat penalty) just for that chat, each individually resettable back to the model's default, or all at once.

## Context and speed readouts

These are separate, optional surfaces (**Settings → Chat → Tools & context**), each answering a different question:

| Surface | Shows | When |
| --- | --- | --- |
| **Context gauge** | how full the model's context window is right now | always, between turns |
| **Engine telemetry** | live tokens/second with a sparkline, prompt tok/s, context fill for this turn | while a reply streams, plus a few seconds after |
| **Speed** | the tokens/second a specific past reply ran at | on hover, forever |
| **Prefill status** | how far a reply is into prefill, how much was reused from cache | before the first token appears |

All are opt-in and off by default except prefill status. They're extra numbers that mostly matter if you're running the model yourself and care about its performance. Context accounting uses the model's own tokenizer where available, not an estimate, so the gauge is trustworthy rather than approximate.

## Model docs

Each model can have a public docs page (its small doc button) summarizing intelligence/speed rating, input/output modalities, max output tokens, and knowledge cutoff. Useful for deciding which model fits a task before you switch to it.
