# Admin Guide

Everything here lives in the **Admin Panel**, reachable from the profile menu for accounts with admin rights. Most sections work as a draft: you make changes, then hit **Push to all clients** to publish them live to every connected user. Dashboard and Databases apply immediately instead, since there's nothing to draft.

## Catalog

**Models**: the list of models available to users, with publish/draft state per model, reordering, discovery (pulling available models from a configured provider), and pricing presets. Opens the **model editor** for any entry, which has its own tabs:

| Tab | Controls |
| --- | --- |
| Essentials | Display name, model id, provider, description, system prompt, visibility (default / hidden / temporarily unavailable + reason), retirement date and action (hide or mark unavailable, with a countdown banner shown to users as the date nears) |
| Routing | Turns this entry into a router: ordered match rules (keyword, regex, has image, has file, has code, length, always) that hand a turn to a different model, plus a fallback |
| Reasoning | Thinking-mode trigger words, reasoning tag delimiters, whether users can expand full reasoning or only see "Thinking…", auto-summarization settings (context window size, headroom %, turns kept), context-overflow strategy (retain full history vs. keep KV cache warm) |
| Kwargs | Extra request parameters exposed to users in the model picker as toggles, sliders, or dropdowns |
| Tools | Core abilities (image input, sandbox allowed/auto-on, web search allowed/auto-on), assistant features (Skills, MCP connectors, past-chat search, long-conversation awareness, an "end conversation" tool), and the tool-call round limit |
| Appearance | Static/generating/thinking logos and animation, icon size and position, whether the logo/name show in the picker, picker capability badges, an optional showcase background shown behind the whole UI while this model is selected |
| Advanced | Sampling parameters (temperature, top-p/k, min-p, penalties, seed, max tokens, DRY, XTC, Mirostat, filtered to what the provider actually supports), stop sequences, per-million-token input/output pricing, a voice-call system prompt override |
| Docs | The model's public docs page: frontier/featured flag and banner, docs-only logo, intelligence/speed rating, input/output modality toggles, max output tokens, knowledge cutoff, long description |

**Providers**: the LLM backends themselves, base URL, API key, and provider type per connection. A model's **Essentials** tab picks which provider it uses.

## Workspace

- **Appearance**: app name and icon, the **interface preset** (Anthropic-style vs. OpenAI-style, see [Interface Overview](interface-overview.md)), default fonts, a disclaimer/footer if wanted.
- **Home Screen**: the greeting text and quick-prompt buttons shown when no chat is open.
- **Members**: user accounts, roles, per-user budgets, and removal (which purges that user's chats).

## Capabilities

- **Web Search**: configures the SearXNG instance the search tool queries.
- **Voice**: the speech-to-text and text-to-speech engines used for dictation and voice calls.
- **Memory**: turns per-user long-term memory on/off workspace-wide, and controls past-chat search.
- **Memory Bank**: reference files any model can read from, independent of any one chat.
- **Skills**: reusable instruction files a model can load on demand mid-conversation.
- **Connectors (MCP)**: Model Context Protocol servers, added as local subprocesses or remote `http(s)` endpoints, exposing extra tools to models.
- **Privacy**: a log of outbound connections the server has made, for auditing what's actually leaving the machine.
- **Safety**: configures a screening model that reviews requests before they reach the assistant.

## Insights

- **Analytics**: workspace-wide usage and cost charts, plus pricing presets used by the Models tab.
- **Feedback**: thumbs up/down responses users have left on messages, with any comments.

## Governance

- **Databases**: Open Quill can run multiple, fully isolated databases (users, chats, prefs, everything) and switch between them. Create named databases, see which is active vs. which loads next, and delete unused ones. A switch is staged and only takes effect on the next server restart. See the [root README](../README.md#databases) for the underlying mechanics.
- **Limits & Budgets**: upload size, sandbox, session, queue, and spending caps. These apply immediately, unlike most of the panel.
- **Audit Log**: a history of sensitive admin actions (retained 120 days), exportable as CSV.

## Dashboard

A landing overview when you open the Admin Panel. It surfaces the state that's most likely to need attention (unpublished changes, provider health, and similar) without digging into individual tabs.

## Publishing changes

Most tabs distinguish a **draft** from what users currently see. Edit freely, and nothing changes for anyone until you click **Push to all clients**, at which point every connected client re-themes/re-configures live, no refresh required. Databases and Limits & Budgets are the exceptions: those apply the moment you save.
