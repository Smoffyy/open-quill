# Admin Guide

Everything here lives in the **Admin Panel**, opened from the profile menu by editors, publishers and the owner. `Ctrl+K` inside the panel finds any section or setting by name.

Most changes do not reach members straight away. They are saved into a shared draft and shipped by a publisher from **Review changes**, see [Publishing changes](#publishing-changes). Providers, model folders, Storage and a few infrastructure settings apply immediately, since members never see them directly.

## Runtime

### Overview

The landing page. It shows the live version and what is waiting in the draft, the size of the catalog, connections and their health, member count, 30-day spend and the most recent admin events. If the workspace is missing something members need to chat, it says so and offers **Run the setup guide**.

### Releases

Every version members have run, newest first, with who published it, its note and exactly what changed. **Restore this version** puts an older version live again, see [Publishing changes](#publishing-changes).

### Models

The catalog members choose from. Add models one by one, or discover them from a provider. Select several models to change a setting on all of them at once. Drag to reorder, and group models into folders, which appear as submenus in the picker.

Each model opens in an editor with these tabs:

| Tab | Controls |
| --- | --- |
| **General** | Display name, subtitle, connection and model id, whether it is listed in the picker, default for new accounts, marking it as down with a reason, a retirement date, and input and output price per million tokens |
| **Prompts** | The system prompt, its tool and context blocks, the list of variables, and a separate prompt for voice calls. See [System prompt](#system-prompt) |
| **Tools** | What the model may do in a chat: image input, sandbox tools, web search, past-chat search, skills, MCP tools, memory, calculator, to-do list, asking the member a question, consulting other models and ending the conversation. Each can be off, available for members to turn on, or on by default. Also the tool-call limit per turn and whether tool calls are hidden |
| **Reasoning** | Whether thinking is shown in full, collapsed or as a status line only, the thinking tags the model uses, and prompt tokens that switch thinking on or off |
| **Context** | The context window (detected from the backend, with an optional override), whether a llama.cpp model may run several requests at once, how many recent turns are kept word for word when older ones are folded into the rolling summary, and conversation length awareness |
| **Sampling** | Temperature, top P and K, min P, repetition penalties, max tokens, the more experimental samplers and stop sequences. Only what the provider supports is listed, and a blank value uses the backend's default |
| **Request controls** | Extra request fields, shown to members in the picker as toggles, ranges or lists, with who may change them, conditions for when they appear, and a preview of the request they produce |
| **Appearance** | Static, generating and thinking logos and their motion, logo size and position beside replies, whether the name is shown, picker badges, and an optional showcase backdrop |
| **Routing** | For routers: ordered rules (contains words, matches a regular expression, has an image or file, looks like code, longer or shorter than N characters, always) that send a message to another model, plus a fallback. The first matching rule wins |

#### System prompt

A model's system prompt is exactly what the model receives. Nothing is added behind it. Turning a tool on writes its instructions into the prompt as a block, and turning it off removes that block:

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

- `<tools>` holds one block per tool: sandbox, web search, reference files, chat search, skills, MCP, memory, calculator, to-do, ask user, consult model and end conversation. A block is sent only when its tool is on for that chat.
- `<context>` holds the member's context: their instructions and memories, project and chat instructions, pinned files, response style, the conversation summary and, when turned on, conversation timing.
- `{{variables}}` are filled in when a message is sent. The **Prompts** tab lists every one. A block whose variables are all empty is left out, so a member with no instructions sends nothing for that block.
- Every block can be edited. A block you write yourself is always sent. If a tool is on but its block was deleted, the tab lists it under **Missing blocks** with **Restore**.
- A voice-call prompt, or a per-chat override, replaces only the text outside the blocks.

Changing a block's default text in a new version of Open Quill only affects new models; prompts you already have are left alone.

### Providers

The backends models run through. **Add connection**, choose its type (llama.cpp, LM Studio, vLLM, Ollama, OpenAI, Anthropic, Google Gemini, OpenRouter, Mistral, Moonshot or Meta), and set its base URL and API key. Keys stay on the server and are never sent to a browser. **Test** checks the connection, and **Discover** lists the models the backend reports so you can add them in one go. For llama.cpp, the card also shows the loaded model and its slots.

Changes here apply immediately.

## Tools

| Section | Controls |
| --- | --- |
| **Web search** | Turns the web search tool on for the workspace and points it at your SearXNG instance, with how many pages are read per search and an optional host allowlist |
| **Voice** | Dictation and calls: the speech-to-text engine (the browser's own, or a server endpoint), the text-to-speech engine, voice and speed, and which voice buttons appear in the composer |
| **Chat history** | Lets models search a member's own earlier chats |
| **Reference files** | A shared set of files every model can list, read and search on demand. Upload, rename and delete files, and choose whether members see the model reading them |
| **Skills** | Workspace skills, offered to every member. Each has a name, a description of when it loads and Markdown instructions |
| **MCP servers** | MCP servers shared with everyone: local commands (stdio, admins only), streamable HTTP or the older HTTP and SSE transport. Add environment variables and headers, which stay on the server, or **Import a config** from a server's README. Each server shows its state and tools |

A tool also has to be allowed per model under the model's **Tools** tab.

## Workspace

### Interface

The look every member gets once it is published.

- **Identity**: the app name and icon (used in the tab, sidebar and greeting), the display font, the footer line under the composer, a support contact and the model reference settings.
- **Themes**: the theme library. Each theme is based on the Anthropic or OpenAI layout. **Use this** makes a theme the active one, and themes can be duplicated, renamed, imported, exported or deleted.
- **Theme builder**: **Enter build mode** opens the live app with the builder around it. Select any element and change its style, move, resize, reorder or hide parts, add elements, preview at desktop, tablet and mobile sizes, and undo, redo or revert. Versions are saved automatically before every publish. Build-mode changes join the draft like everything else.

### New chat screen

The greetings shown above the composer and the starter prompts under it. Each starter has a label, an icon and the full prompt it sends.

### Members

Every account, with its role, two-factor status, monthly spend and an optional monthly cap. Filter by name, email or role. **Accept new sign-ups** turns open registration on or off. **Remove member** deletes the account and its chats. See [Roles](#roles).

## Policy

| Section | Controls |
| --- | --- |
| **Guardrails** | Screens every message with a model before it reaches the assistant: the chatting model or a dedicated one, the screening prompt, whether refusals are explained and whether progress is shown. The **Refusal log** lists what was blocked |
| **Network** | **Block public internet** (on by default) and the host allowlist for outbound requests, an exemption for web search, the browser policy that serves every asset from this origin, and a **Connection log** of everything the server tried to reach |
| **Quotas** | Upload caps for members and admins, sandbox storage caps, scheduling (serialize requests across models, for a single GPU that holds one model at a time), monthly spend caps with a warning threshold and optional blocking, session lifetime and how many devices a member may be signed in on, and automatic chat titles with the model that writes them |

## Records

| Section | Shows |
| --- | --- |
| **Usage** | Tokens, generations and estimated spend by member and by model over 7, 30 or 90 days, cache reads, the price table used for estimates, and **Tool reliability**: calls and failures per tool, with the reason for each failure |
| **Ratings** | Thumbs members left on replies, with comments, filterable by rating |
| **Event log** | Sensitive admin actions, kept for 120 days. Filter by action, person and time, and **Export CSV** |
| **Storage** | The isolated databases on this server: create one, choose which loads on the next start, and delete unused ones. See [Databases](databases.md) |

## Playground

**Playground** in the profile menu is a bench for trying models before members see them. It uses the same model editor as the Admin Panel, so a change made there is staged in the draft like any other.

- **Conversation**: chat with a model, add system messages, edit or delete any message or reply, and switch tools and extended thinking on or off.
- **Compare**: run the same input against other models, or the draft against the live release, in side-by-side columns.
- **Test sets**: saved lists of prompts with expected answers, shared between admins. Run one against a model with **Run all**. A starter set is included.

Playground runs are not saved as chats.

## Roles

| Role | Can |
| --- | --- |
| **Member** | Chat. No Admin Panel |
| **Editor** | Use the Admin Panel and the playground, and stage changes. Can discard only their own changes |
| **Publisher** | Everything an editor can, plus publish, restore old versions and discard anyone's changes |
| **Owner** | Everything, including making and removing publishers. The first account is the owner |

You can only manage accounts below your own role, and only grant roles below it. Nobody can change their own role.

## Publishing changes

Every edit in the panel saves itself into one shared draft. There is no save button. All admins see the draft live, along with who else is in the panel and which model they have open. Members keep running the published version until a publisher ships the draft.

**Review changes** in the top bar lists every pending change, grouped by model, setting and theme, with the old and new value, who changed it and when. Long text such as a system prompt can be compared line by line. Tick what should go out, add an optional note and **Publish**. Anything left unticked stays in the draft. **Discard** throws the ticked changes away instead. Some changes always travel together: only one model can be the default, a new model ships with its place in the order, and the active theme ships with its base layout.

Every publish becomes a numbered version under **Releases**, which keeps the last 50 with their author, note and full contents. **Restore this version** makes an older one live again as a new version, so a restore can itself be undone, and work still waiting in the draft is left alone. Connected members pick up a new version within about a second without reloading. A reply already being written finishes on the version it started with, and a member who was offline catches up when they reconnect.

If someone publishes while you are reviewing, your publish is refused until you look at the updated list. If another admin changes a field you are still typing in, your text is kept and you are told about theirs.