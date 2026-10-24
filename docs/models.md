# Models and reasoning

## Picking a model

The model picker sits at the bottom right of the composer, or at the top left of the chat in the OpenAI layout. It lists every model an admin has published, with its logo, name and a short description. Models grouped by an admin appear in submenus, such as **More models**. The info button on an entry opens that model's page in the model reference.

Changing the model affects the chat from your next message. Earlier replies keep the model that wrote them. To redo a reply with a different model, pick that model and press **Retry** on the reply.

Small badges show what a model can do:

| Badge | Meaning |
| --- | --- |
| **Auto** | A router that picks a model for each message |
| **Code** | Can run code and work with files |
| **Vision** | Can read the images you attach |
| **Web search** | Can look things up online |
| **Reasoning** | Thinks before it answers |
| **Long context** | Holds a lot of text. The size shows on hover |

## Routers

A **router** does not run a model itself. Each message is checked against rules the admin wrote, such as "has an image attached", "looks like code", a keyword or a length. The message goes to the first model that matches. The reply shows which model answered.

## Extended thinking

Models that can reason show an **Extended** switch at the bottom of the picker. When one replies, its thinking streams into a collapsible section above the answer. The admin decides whether you see the full thinking or only a status line.

Some models offer more than on or off, such as a reasoning effort level. These appear in the same place.

## Request controls

An admin can expose a model's extra options in the picker as switches, sliders or lists. What they do depends on the model. Check the model's page in the reference if one is unfamiliar. Some appear only after another control is set.

If a model has a backdrop image, **Background in chat** keeps it behind the conversation, not only on the home screen.

## Per-chat overrides (admins)

**⋯ → Chat controls (admin)** in the top bar overrides the model's system prompt and sampling settings for one chat. These are temperature, top P, top K, min P, max tokens, and the frequency, presence and repeat penalties. Each value can be reset to the model's default on its own. A system prompt override replaces the model's text but keeps its tool and context blocks.

## Readouts

Optional numbers for people who want to see how a model is doing. All are under **Settings → Interface**:

| Setting | Shows |
| --- | --- |
| **Engine telemetry** | Live speed and context fill above the composer while a reply streams |
| **Speed on each reply** | Tokens per second for each reply, next to the reply |
| **Progress line** | What the model is doing, beside its logo, when a reply takes more than a few seconds |

Token counts are always exact, never estimated. Local llama.cpp and vLLM backends count the prompt with the model's tokenizer before sending it. Other providers report counts after each reply, so the ring shows the last exact count until you send another message.

## The model reference

**Model docs** in the sidebar has a page for every published model. Each page covers what the model is good at, what it accepts and produces, its context window, maximum output, knowledge cutoff, pricing, and how it compares with others. **Try in chat** switches to that model. Admins can edit these pages, and their changes are published with everything else.