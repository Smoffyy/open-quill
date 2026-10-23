# Models & Reasoning

## Picking a model

The model picker sits at the bottom right of the composer (top left of the chat in the OpenAI layout). It lists every model an admin has published, with its logo, name and a one-line description. Models an admin has grouped together sit in submenus, such as **More models**. The info button on an entry opens that model's page in the model reference.

Changing the model affects the chat from the next message on. Earlier replies keep the model that wrote them. To redo one reply with a different model, pick that model in the picker and press **Retry** on that reply.

Small badges show what a model can do:

| Badge | Means |
| --- | --- |
| **Auto** | A router that picks the best model for each message |
| **Code** | Can run code and work with files |
| **Vision** | Can read the images you attach |
| **Web search** | Can look things up online |
| **Reasoning** | Thinks before it answers |
| **Long context** | Holds a lot of text, with the size on hover |

## Routers

Some entries are **routers**. Picking one does not run a model itself. Each message is checked against rules the admin wrote, such as "has an image attached", "looks like code", a keyword or a length, and sent to whichever model matches first. The reply shows which model actually answered.

## Extended thinking

Models that can reason show an **Extended** switch at the bottom of the picker. When a reasoning model replies, its thinking streams into a collapsible section above the answer. The admin decides whether you see the full thinking or only a status line.

Some models offer more than an on/off switch: a reasoning effort level or other options. These appear in the same place.

## Request controls

An admin can expose a model's extra request options in the picker as switches, sliders or lists. What they do depends on the model, so check the model's page in the reference if one is unfamiliar. Some only appear once another control is set, and some are visible to admins only.

If a model has a showcase backdrop, **Background in chat** keeps it behind the conversation instead of only on the home screen.

## Per-chat overrides (admins)

**⋯ → Chat controls (admin)** in the top bar overrides the model's system prompt and sampling settings (temperature, top P, top K, min P, max tokens and the frequency, presence and repeat penalties) for one chat. Each value can be reset to the model's default on its own. A system prompt override replaces the model's own text but keeps its tool and context blocks, so tools still get their instructions.

## Readouts

Optional numbers for people who want to see how the model is doing, all under **Settings → Interface**:

| Setting | Shows |
| --- | --- |
| **Engine telemetry** | Live speed and how full the context is, above the composer while a reply streams |
| **Speed on each reply** | The tokens per second each reply ran at, kept beside the reply |
| **Progress line** | What the model is doing, beside its logo, when a reply takes longer than a few seconds |

Token counts are always exact, never estimated. Local llama.cpp and vLLM backends count the next prompt with the model's own tokenizer before it is sent. Other providers only report counts after a reply, so the ring shows the exact count from the last reply, and "Send a message to load context" before there is one.

## The model reference

**Model docs** in the sidebar opens a reference page for every published model: what it is good at, what it accepts and produces, its context window, maximum output, knowledge cutoff, pricing and how it compares to the others. **Try in chat** switches to that model. Admins can edit these pages in place, and their changes are published with everything else.