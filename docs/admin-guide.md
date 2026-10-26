# Admin guide

Editors, publishers and the owner open the **Admin Panel** from the profile menu. Press `Ctrl+K` inside the panel to find any section or setting.

Most changes are saved to a shared draft and reach members only when a publisher ships them from **Review changes**. See [Publishing changes](#publishing-changes). Providers, model folders, Storage and a few infrastructure settings apply immediately, because members never see them directly.

## Runtime

### Overview

The landing page. It shows the running version, what is waiting in the draft, the size of the model catalog, connection health, member count, 30-day spend and recent admin events. If something members need is missing, it says so and offers **Run the setup guide**.

### Releases

Every version members have run, newest first, with who published it, its notes and what changed. **Restore this version** makes an older version live again. See [Publishing changes](#publishing-changes).

### Models

The catalog members choose from. Add models one at a time, or discover them from a provider. Select several models to change one setting on all of them. Drag to reorder, and group models into folders, which appear as submenus in the picker.

Each model has these tabs:

| Tab | Controls |
| --- | --- |
| **General** | Display name, subtitle, connection, model id, whether it is listed, default for new accounts, a down notice, a retirement date, and prices per million tokens |
| **Prompts** | The system prompt, its blocks and variables, and a separate prompt for voice calls. See [System prompt](#system-prompt) |
| **Tools** | What the model may do: image input, Available in Code (Code sessions), web search, past-chat search, skills, MCP tools, memory, calculator, to-do list, asking the member a question, consulting other models and ending the conversation. Each can be off, offered to members, or on by default. Also the tool-call limit per turn |
| **Reasoning** | Whether thinking is shown in full, collapsed or as a status line, the thinking tags, and prompt tokens that switch thinking on or off |
| **Context** | The context window (detected from the backend, with an optional override), whether a llama.cpp model runs several requests at once, how many recent turns stay word for word, and length awareness |
| **Sampling** | Temperature, top P and K, min P, penalties, max tokens, experimental samplers and stop sequences. A blank value uses the backend's default |
| **Request controls** | Extra request fields that members set in the picker, that are fixed to one value, or that follow another control. Includes a live preview |
| **Appearance** | Logos and their motion, logo size, whether the name shows, picker badges and an optional backdrop |
| **Routing** | For routers: ordered rules that send a message to another model, plus a fallback. The first matching rule wins |

### System prompt

A model's system prompt is exactly what the model receives. Nothing is added behind it. Turning on a tool adds its instructions as a block, and turning it off removes the block:

```
You are a helpful assistant.

<context>
<section name="user_instructions">
The user has provided the following instructions ...
{{userInstructions}}
</section>
</context>

<tools>
<tool name="calculator">
...
</tool>
</tools>
```

- `<tools>` holds one block per tool. A block is sent only when its tool is on for that chat.
- `<context>` holds the member's instructions and memories, project and chat instructions, pinned files, response style, the conversation summary and, if turned on, conversation timing.
- `{{variables}}` are filled in when a message is sent. The **Prompts** tab lists them all. A block whose variables are all empty is left out.
- Every block can be edited. A block you write yourself is always sent. If a tool is on but its block was deleted, the tab lists it under **Missing blocks**, with **Restore**.
- A voice-call prompt or a per-chat override replaces only the text outside the blocks.

A new version of Open Quill changes default block text only for new models. Existing prompts are left alone.

### Providers

The backends models run through. Press **Add connection**, choose its type (llama.cpp, LM Studio, vLLM, Ollama, OpenAI, Anthropic, Google Gemini, OpenRouter, Mistral, Moonshot or Meta), then set the base URL and API key.

Keys stay on the server and are never sent to a browser. **Test** checks the connection. **Discover** lists the models the backend reports, so you can add them in one go. For llama.cpp, the card also shows the loaded model and its slots.

Changes here apply immediately.

## Tools

| Section | Controls |
| --- | --- |
| **Web search** | Turns web search on for the workspace and points it at your SearXNG instance, with how many pages are read and an optional host allowlist |
| **Voice** | Dictation and calls: the speech-to-text and text-to-speech engines, voices, speed, and which voice buttons show in the composer |
| **Chat history** | Lets models search a member's own earlier chats |
| **Reference files** | Shared files that every model can list, read and search on demand. You can choose whether members see the model reading them |
| **Skills** | Workspace skills offered to every member. Each has a name, a description of when it loads, and Markdown instructions |
| **MCP servers** | MCP servers shared with everyone: local commands (admins only), streamable HTTP, or HTTP with SSE. Environment variables and headers stay on the server. **Import a config** reads one from a server's README |

A tool also has to be allowed for each model under that model's **Tools** tab.

## Workspace

### Interface

The look every member gets once it is published.

- **Identity**: the app name and icon, the display font, the footer line under the composer, a support contact, and model reference settings.
- **Themes**: the theme library. Each theme is based on the Anthropic or OpenAI layout. **Use this** makes a theme active. Themes can be duplicated, renamed, imported, exported or deleted.
- **Theme builder**: **Enter build mode** opens the live app with the builder around it. Select an element to change its style, position, size or order, add elements, preview at desktop, tablet and mobile sizes, and undo. Versions are saved before every publish, and build changes join the draft like everything else.

### New chat screen

The greetings above the composer and the starter prompts below it. Each starter has a label, an icon and the full prompt it sends.

### Members

Every account, with its role, two-factor status, monthly spend and optional monthly cap. Filter by name, email or role. **Accept new sign-ups** turns open registration on or off. **Remove member** deletes the account and its chats. See [Roles](#roles).

## Policy

| Section | Controls |
| --- | --- |
| **Guardrails** | Screens every message with a model before the assistant sees it. The **Refusal log** lists what was blocked |
| **Network** | **Block public internet** (on by default), the host allowlist, an exemption for web search, and a **Connection log** of every outbound attempt |
| **Quotas** | Upload caps, sandbox storage caps, request scheduling, monthly spend caps with warnings, session lifetime and devices per member, and automatic chat titles |

## Records

| Section | Shows |
| --- | --- |
| **Usage** | Tokens, generations and estimated spend by member and by model over 7, 30 or 90 days, plus **Tool reliability** |
| **Ratings** | Thumbs members left on replies, with comments |
| **Event log** | Sensitive admin actions, kept for 120 days. Filter them, and **Export CSV** |
| **Storage** | The isolated databases on this server. See [Databases](databases.md) |

## Playground

**Playground** in the profile menu is a bench for trying models before members see them. It uses the same model editor as the Admin Panel, so changes are staged in the draft like any other.

- **Conversation**: chat with a model, add system messages, edit any message, and switch tools and thinking on or off.
- **Compare**: run the same input against other models, or the draft against the live release, side by side.
- **Test sets**: saved prompts with expected answers, shared between admins. Run one with **Run all**. A starter set is included.

Playground runs are not saved as chats.

## Roles

| Role | Can |
| --- | --- |
| **Member** | Chat. No Admin Panel |
| **Editor** | Use the Admin Panel and the playground, and stage changes. Can discard only their own changes |
| **Publisher** | Everything an editor can, plus publish, restore versions and discard anyone's changes |
| **Owner** | Everything, including making and removing publishers. The first account is the owner |

You can manage only accounts below your own role, and grant only roles below it. Nobody can change their own role.

## Publishing changes

Every edit saves itself to one shared draft. There is no save button. All admins see the draft live, along with who else is in the panel and which model they have open. Members keep using the published version until a publisher ships the draft.

**Review changes** in the top bar lists every pending change, with the old and new values, who made it and when. Long text, such as a system prompt, can be compared line by line. Tick what should go out, add an optional note, and press **Publish**. Unticked changes stay in the draft. **Discard** throws the ticked changes away.

Some changes always ship together: only one model can be the default, a new model ships with its place in the order, and the active theme ships with its base layout.

Each publish becomes a numbered version under **Releases**, which keeps the last 50. **Restore this version** makes an older one live again as a new version, so a restore can itself be undone. Work still in the draft is left alone.

Connected members pick up a new version within about a second without reloading. A reply already being written finishes on the version it started with.

If someone publishes while you are reviewing, your publish is refused until you look at the updated list. If another admin changes a field you are typing in, your text is kept and you are told about theirs.