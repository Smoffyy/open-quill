## Open Quill

Self-hosted chat interface for local and cloud LLMs. Express 5 + encrypted SQLite server, React 19 + Vite client, WebSocket streaming, per-workspace file sandbox. Package name is `open-quill`; the repo folder may be named differently.

`dev` is the working branch, `main` is release; PRs target `dev`.

## Commands

Run from the repo root unless noted.

| Command | Does |
| --- | --- |
| `npm run install:all` | Install root, `server/` and `client/` deps |
| `npm run dev` | Server `:3001` + Vite client `:5173` (proxied), both hot-reloading |
| `npm start` | Production server on `:3001`, serves `client/dist` |
| `npm run build` | `vite build` then `check-local.mjs` (fails on any off-origin URL in the bundle) |
| `npm run lint` / `lint:fix` | ESLint over the whole repo (flat config at root) |
| `npm run test:client` | `node --test` in `client/`, every `client/test/*.test.js` |
| `npm run smoke` | SSR-renders every admin section and modal, catching runtime-only prop bugs |
| `npm run i18n:check` | Missing/orphaned translation keys (`-- --json` for machine output) |
| `npm run i18n:sync` | Prune orphans, merge a translation patch, scaffold a new language |
| `npm run check:release` | Version, release folder and changelog entry agree |

Server tests: `cd server && npm test` runs `node --test`, which auto-discovers every `server/test/*.test.js`. A single file: `cd server && node --test test/logic.test.js`. A single case: `node --test --test-name-pattern "<name>" test/logic.test.js`.

Client-only extras live in `client/`: `npm run dead:css` is an **advisory** unused-class report (a zero-hit class can still be emitted by a library), `npm run check:local` re-runs the off-origin check against an existing `dist/`.

CI (`.github/workflows/ci.yml`, Node 24) runs, in order: server syntax check, `lint --quiet`, build, `i18n:check`, `smoke`, `check:release`, `test:client`, `cd server && npm test`. All must stay green.

## Not a marketing site

open-quill is login-walled software someone runs on their own machine, not a public page, and the usual launch checklist inverts here:

- **No crawling, no indexing.** `client/public/robots.txt` disallows everything and `server/index.js` sets `X-Robots-Tag: noindex, nofollow, noarchive, noimageindex` on every response. An instance exposed to the internet must not end up in a search index. There is deliberately **no sitemap.xml**.
- **No analytics, ever.** Any script, pixel or beacon breaks the everything-is-local rule below and `npm run build` fails on it. Per-instance numbers already exist and stay local: `lib/audit.js`, `lib/toolstats.js` and the admin Usage section.
- **No cookie banner.** The only cookie is the session, which is strictly necessary and therefore consent-exempt. A banner would ask for permission that is not required.
- **No terms page.** The software is MIT and self-hosted; `LICENSE` and `CREDITS.md` are surfaced through `DocModal` and that is the whole obligation.
- **Meta tags are for unfurls, not ranking.** `client/index.html` carries one static title, description and Open Graph block so a pasted instance URL previews in a chat app. Per-view titles are set at runtime by the `document.title` effect in `App.jsx`, which every view must extend when it is added.
- **Contact is per-instance.** `support_contact` (Admin, Interface, Identity) is whoever runs *this* server, not a vendor address, and is empty by default.

## The everything-is-local rule

Nothing may reach the network that the user did not configure. Fonts, KaTeX and highlight.js are bundled npm deps, never CDN. Three mechanisms enforce this and none may be weakened:

- `server/lib/egress.js` wraps global `fetch`. With "local only" on (default) a hostname must resolve to *all*-private addresses, which is what blocks DNS rebinding. Web search bypasses it only through the explicit `unguardedFetch` import.
- `server/lib/localonly.js` builds the CSP that confines the browser to this origin.
- `client/scripts/check-local.mjs` fails `npm run build` if the bundle would fetch off-origin (short allow-list of doc links only).

## Server

Entry `server/index.js` owns middleware order: security headers, `sameOriginGuard`, JSON body, cookies, authenticated `/uploads` static, `register*Routes(app)`, JSON 404 for `/api` and `/uploads`, SPA static, error handler, then `initWs(server)`.

**Database** (`db.js`, `db/schema.js`, `db/collection.js`): one SQLCipher-encrypted file per database, key from `DB_ENCRYPTION_KEY` or a generated `.dbkey`. Every table is `id` plus a few mirrored index columns plus one JSON blob (`data`); `MIRROR` in `db/collection.js` declares which fields get mirrored, so a new indexed column means an entry there and in the migration. Schema changes are appended to `MIGRATIONS` in `db/schema.js` (each entry brings the DB to version `index + 2`) and run unconditionally at startup: **append, never edit a shipped entry**. Query in SQL, not JS: `db.<table>.all()` parses every row, so hot paths get a prepared statement (see `messages.byChat` and the search statements). `getSetting` returns the cached object itself, so never mutate in place; build a new value and `setSetting`.

`server/lib/dataroot.js` resolves which database directory to use from `OPEN_QUILL_DB` in the root `.env`, read once at startup. `default` is `server/data/`, anything else `server/data/databases/<name>/`. It also writes the first-run `.env` from `.env.example`.

**Layout**:

```
server/
  index.js        app assembly, middleware order, route registration
  db.js           encrypted SQLite + collections + settings cache
  auth.js         argon2, JWT sessions, authMiddleware, adminOnly
  llm/            provider-agnostic completion pipeline; import from llm/index.js only
  tools/          tool schemas, arg parsing, text-fallback call parsing, name aliasing
  sandbox.js      barrel; impl in sandbox/ (paths, meta, ignore, files, shell, exec, zip, hostenv)
  lib/            shared logic and services (appconfig, convo, ctxwindow, prompts, router, memory, tasks, theme,
                  mcp, providers, pricing, websearch, totp, projectfiles, userskills, workspaceskills,
                  referencefiles, toolproto, ...)
  lib/ws/         broadcast, live (in-flight turns), turn (agentic loop), connection
  routes/         one default-exported register(app) per resource
  test/           http.test.js (real server) + logic/mcp/schema/usage tests (pure)
```

Dependency direction is **routes to lib**; `lib/ws/` never imports from `routes/`. Only the entry point, the database, auth and the sandbox barrel live at the server root; anything else is a `lib/` module. `lib/referencefiles.js` is the admin "Reference files" store; its settings keys, data folder and `/api/admin/membank` routes keep the older "membank" name because they are stored and wire formats. `lib/workspaceskills.js` (admin skills, in settings) and `lib/userskills.js` (per-member skills, in the database) share name and size rules from `lib/skillfile.js`.

`db.js` exports `closeDb()`; a test that opens its own database closes it and removes the folder in `after()`, so a test run leaves nothing under `server/data/databases/`.

**Security invariants**:
- `lib/origin.js` (`sameOrigin`) is the single "did this come from our own UI" check, used by HTTP writes and the WS handshake. It leads with `Sec-Fetch-Site`, not `Origin` vs `Host`, because a naive host comparison breaks behind the Vite dev proxy and any reverse proxy. Test both `npm run dev` and `npm start` when touching it.
- Uploads return 404, not 401, when signed out: existence is itself privileged.
- Login timing and responses never reveal which half was wrong.
- Untrusted keys index lookup tables declared with `__proto__: null` (`SETTING_FIELDS` in `routes/settings.js` is the pattern: coerce and cap once at the boundary). WS handlers sit outside Express's error handler, so they type-check ids themselves.
- User-supplied regex runs in a killable worker (`sandbox/regexsearch.worker.js`); `lib/sandboxguard.js` rejects catastrophic-backtracking shapes before compiling.

**Sandbox** (`server/sandbox/`, dispatch table in `exec.js`): a versioned virtual filesystem plus a bash tool. Every sandbox function takes a workspace key, not a chat id: `wsKey(chatRow)` in `sandbox/paths.js` returns the project's shared workspace when the chat belongs to one and the chat's own otherwise, so a project's chats share one directory and its attached files are ordinary files in it. `bash` runs with an explicit environment allowlist, never this process's own. `lib/sandboxguard.js` (`normalizeRel`, `screenCommand`) is the enforced boundary, rejecting absolute/UNC/home paths, `..` escapes and a fixed list of host-admin commands. Both are pure and tested; the false-positive set (ordinary build commands must keep working) matters as much as the false-negative one. Wrong tool and argument names are *resolved* through `tools/aliases.js` rather than rejected, so a small model does not burn its turn budget on a typo; a truncated tool call is refused before dispatch, never partially applied.

**Drafts and releases** (`lib/draft.js`, `lib/changes.js`, `lib/releases.js`, `routes/changes.js`): every admin edit to something a member can see or that changes member behaviour is staged; providers and model folders are infrastructure and apply immediately. The draft lives in `db.models` plus the `draft:` settings namespace; the live state is the `published_models` snapshot plus the plain settings. `lib/changes.js` is pure: it diffs the two states into one change per model field, setting or theme field (`model:<id>:<field>`, `setting:<key>`, `theme:<id>:<field>`, plus create, delete, `models:order` and `themes:active`), applies any subset in either direction, and `expandKeys` couples changes that only make sense together (one default model, a new model with its order, the active theme with `ui_preset`). A publish ships any subset as a numbered release (`releases` table, last 50 kept, each with a full snapshot) and is refused with 409 when the reviewer's `base` version is stale; a restore is itself a new release and leaves work still waiting in the draft alone. Who changed what lives in `draft_edits`, written by `staged(req, scope, { keys, ...frame })`, which every staging route calls instead of broadcasting by hand. Secrets (`secret: true` in `lib/settingfields.js`) never leave the server in a change list. A new staged setting needs its key in `SETTING_FIELDS` or `CONFIG_KEYS`, a label in `components/admin/changes/labels.js` and a section in `lib/changeset.js`.

**Roles** (`lib/roles.js`, mirrored in `client/src/lib/roles.js`): member, editor, publisher, owner, stored as `is_admin`, `can_publish` and `is_owner`. `adminOnly` admits editors and up; `publisherOnly` guards publish and restore; an editor's discard is refused unless every chosen change is theirs alone. Every account route checks `canManage` (strictly below your own rank) and every role change `canAssign` (strictly below), so only the owner makes publishers and nobody edits their own rank.

**Sync frames**: members only ever get `config { version }` after a release, and refetch once, with jitter, when the version is newer; `hello { configVersion }` on connect catches a release missed while offline. Admins also get `admin_draft` (scope, the editing tab's `X-Oq-Tab`, and the changed rows or fields, so other panels merge in place instead of refetching) and `presence` (who is on which section and model). An admin's own unsaved field always wins over an incoming one, with a toast rather than a silent overwrite.

**Code sessions** (`lib/codeprompt.js`, `routes/artifacts.js`): a chat with `mode: 'code'` is a Code session. Only Code sessions and project chats get the sandbox; ordinary chats never do, and there is no per-model or per-chat sandbox switch. `toolState` and `systemPrompt` in `systemprompt.js` branch on the mode, so every caller (turns, compaction, inspect) gets the code tool set and the code prompt without asking: `codeprompt.js` renders its own coding-agent template with the sandbox, todo, ask_user and web_search blocks plus user instructions, chat instructions and the summary, never the model's chat `system_prompt`. Plan mode (`plan` on the chat frame) offers only `SANDBOX_READONLY` tools, `turn.js` refuses a write that arrives anyway, and the reply is stored with `plan_mode` so the client can ask to proceed. A session never joins a project, because that would swap its workspace. The panel's file routes (`POST /api/chats/:id/files` upload, `/files/new`, `/files/rename`, `DELETE /files`) refuse while a turn is running.

**Turns and streaming** (`lib/ws/`): a turn belongs to the chat, not the socket, so `live.js` tracks by `chatId` and a mid-reply reload resumes. `stops` (a `Set`) is the durable "user asked to stop", checked everywhere the agentic loop in `turn.js` could continue; the per-step `AbortController` in `aborts` only cancels the current step.

**System prompt** (`lib/promptblocks.js`, `lib/systemprompt.js`): a model's `system_prompt` is the whole template and nothing is appended behind it. `promptblocks.js` is the registry: one entry per tool (`<tool name>` inside `<tools>`) or piece of member context (`<section name>` inside `<context>`), with its eligibility and default text. `syncModelPrompt` adds or removes blocks when a tool flag or workspace feature changes (diff-based, so an edited block is kept and a deleted one is not re-added); `renderPrompt` drops blocks whose tool is off this turn or whose `{{variables}}` are all empty, then fills the variables. `systemprompt.js` computes the per-turn tool state and variable values (lazily, so an inactive block never walks the workspace). A new tool is one registry entry, its runtime flag in `toolState`/`activeBlocks`, any variables in `systemPrompt`, and a line in the Prompts tab's variable list. A shipped default text is not rewritten in stored prompts, so a wording change reaches new models only.

**Providers** (`lib/providers.js`, `llm/`): every connection type names a `protocol`, `openai`, `ollama` or `anthropic`, and `llm/stream.js` and `llm/oneshot.js` branch on it. Anthropic goes through `llm/anthropic.js` and the official `@anthropic-ai/sdk`, handed a fetch that calls the guarded global so the egress rules still apply; it maps the OpenAI-shaped history (system messages, `image_url` parts, `tool_calls`, `role: 'tool'`) onto the Messages API, and the signed thinking blocks of a tool step ride on that step's assistant message as `blocks` so the next request can replay them. `llm/compat.js` remembers, per connection and model, a parameter the provider refused, and drops or renames it on the retry. Connection keys never leave the server: `GET /api/admin/providers` sends `publicProvider()` (`has_key`, `key_hint`). Provider behaviour is tested against strict mocks of both APIs in `test/mockapis.js`, in process by `providers.test.js` and end to end by `http.test.js`.

**MCP** (`lib/mcp.js`): stdio servers (admin only), streamable HTTP and the 2024 HTTP+SSE transport, which is used for a `/sse` address or when streamable HTTP is refused. On Windows a command is resolved on the PATH and a `.cmd` shim such as `npx` runs through the shell with every argument quoted, and stopping a server kills its process tree.

**Context window** (`lib/ctxwindow.js`, `lib/convo.js`, `lib/recall.js`): token counts are exact or absent, never estimated, and no hosted provider's counting endpoint is ever called. `canCount` is true only for local backends that tokenize for free (llama.cpp through `/apply-template` + `/tokenize`, vLLM through `/tokenize`); for them `fitToWindow` counts the prompt before sending, sheds bulk from older turns (`shedBulk`: images, long code blocks, tool output), and only then lets `slideWithCounter` drop the oldest messages, always protecting the system prompt, held messages and everything from the newest user message on. Every other provider is measured by the exact `usage` it returns (stored on the reply as `ctx_used`) and the exact sizes in its overflow errors (`parseOverflow`), and is fitted reactively. Every model uses a rolling summary: after a reply that leaves the chat past about two thirds of the window, `foldHistory` runs `foldStep` in the background, which has the chatting model fold the oldest turns outside `recent_window` into `chat.summary` in batches sized to fit the window, then the client gets a `folded` frame; a synchronous `foldStep` runs only when a prompt still does not fit. A reasoning model that spends the summary's output cap thinking is asked again with a closed think block prefilled, and that choice is remembered per model. Images are always sent at full original quality (the composer only converts formats a model cannot read to a lossless PNG). When a turn with an image is folded, a vision model writes a detailed description once (`image_detail` on the attachment); the latest ones live in `chat.summary_images` and `summaryText` renders them verbatim after the summary, so they are never re-summarized. `recall` searches the summarized messages and image descriptions word for word, returns matching images at full quality to a vision model, and is offered only to a model that already uses tools in a chat that has a summary. Ollama takes images in its own `images` field (`normalizeMessages`). A turn never fails because of the window: every counted request is capped to the room left, an `error` frame inside the stream is raised rather than read as the end of the reply, a reply that runs out of room mid-answer is saved as truncated for a manual Continue, and one that runs out while still thinking is retried once with its reasoning cut (`lib/forceanswer.js`). A llama.cpp server shares one window across its slots, so `llm/slots.js` runs requests to the same llama.cpp model one at a time unless the model sets `parallel_requests`; this is separate from the workspace-wide "Serialise across models" queue in `lib/queue.js`. `num_ctx` is only an override; 0 means the size the backend reports, which for Ollama and LM Studio is the size the loaded model runs at.

## Client

**Layout**:

```
client/src/
  main.jsx, App.jsx, i18n.jsx   entry, root component, translation runtime (+ locales/)
  lib/                          hooks and pure logic, including api, prefs, toast, clipboard
  styles/                       one stylesheet per feature, imported in order by app.css
  components/
    ui/          shared primitives: icons, Tip, TipLayer, Dialog, CloseButton, controls (rows, switch,
                 segmented control, select, range), Skeleton, Toaster, ChordHint
    sidebar/     Sidebar, ChatMenu, DocsNav
    chat/        the open conversation: Message, Markdown, ToolCard, ChatTopbar, Greeting,
                 ChatError, QueuedMessages, thread navigation, ContextRing, call panel
    composer/    Composer, ModelDropdown, StyleMenu
    dialogs/     modal windows opened from anywhere (search, command palette, shortcuts, ...)
    settings/    SettingsModal and one component per tab
    pages/       full views: projects, scheduled, all chats, model docs, playground, login
    code/        Code mode: CodeView (header, layout, panel resize), CodeTranscript, CodeComposer,
                 CodeFiles (the files panel) and CodeMenu
    artifacts/, admin/, builder/, setup/, playground/   feature areas
```

The admin panel, playground, model docs, setup guide and build mode are `React.lazy` chunks, so members never download them; a stylesheet only one of them uses is imported by that component, not by `app.css`. The playground (`pages/Playground.jsx`, parts in `playground/`) mounts the admin store with `AdminProvider fixedSection="models"`, so its settings panel is the admin model `Inspector` itself and edits stage to the draft exactly as in the admin panel; its runs go through `routes/playground.js`, which renders the prompt with `systemPrompt()` like an incognito chat and resolves a `live` column from the published snapshot.

`client/src/App.jsx` holds top-level state, WS wiring and routing. Its state lives in `client/src/lib/`, one hook per concern; App wires them together and owns the ordering between them, nothing more:

- `turnstream`: the assistant message being written (received text, revealed text, reveal timer); `revealChunk`/`revealPeriod` are pure and tested.
- `turnmeta`: telemetry, prompt size, backend status, steers, routing. `route` sits deliberately outside `reset()` because the `routed` frame arrives before `start`.
- `livetools`: the file being written and the tool rows of the current step; `mergeCall` keeps simultaneous calls on their own rows by index.
- `genmirror`: per-chat records for turns not on screen, held in a ref'd `Map` so streamed tokens do not re-render the tree.
- `wsmessages`: one handler per server frame, `dispatchWs(m, ctx)`. Two protocol rules live here: a frame for a background chat updates the mirror, and only a frame for `activeKey()` touches the view. It cannot import `i18n.jsx` (`node --test` cannot parse JSX), so translated strings arrive through `ctx.text` and `ctx.actions`.
- `configsync` (version gating, member jitter, which reloads a draft frame needs), `wsbus` (the socket sender and presence snapshot for lazy chunks such as the admin panel), `useChanges` (the pending change list, publish and discard, shared by the admin panel and build mode) and `changeset` (pure grouping, value formatting and line diff for the review panel).
- `socket`/`wsclient`: socket lifecycle apart from React. A `close()` must stay closed; letting `onclose` schedule a retry leaks a live socket on every remount, and App is keyed by language.
- `threadscroll` owns scroll, where `stick` means "at bottom, wants to stay".
- `dismiss` (`useDismiss`, `useLayer`) is the one outside-click/Escape implementation. Every surface Escape can close (menu, dialog, full-screen view) registers a layer, and only the most recently opened layer hears the key, so Escape closes a dropdown before the dialog it sits in. A field that owns Escape itself (a rename input cancelling) calls `preventDefault` and no layer closes. Modal layers pause background shortcuts through `isModalOpen()`; never test for an `.overlay` element instead. Every modal renders through `components/ui/Dialog.jsx` (dialog semantics, focus trap and restore via `lib/focus.js`, backdrop click, Escape). `submenu` (`useSubmenus`) holds one open id per menu so "only one submenu open" is structural, `anchor` portals menus that can leave their container, `route` has the pure `parseRoute` and path builders, `lru` the bounded chat cache.

`lib/brand.js`, `lib/toolproto.js`, `lib/promptblocks.js` and `lib/presets.js` exist in both a client and a server copy and must agree (server tests compare them; the admin editor uses `promptblocks.js` to add a block the moment a tool is toggled); model rows store icon paths, so moving files needs a `LEGACY` entry in the server copy.

**Brand icons**: inside the app the mark is never an image. `components/ui/BrandMark.jsx` renders the live weave (the same `Weave` the model icons use), starting on the chosen brand frame `BRAND_FRAME` from `lib/brand.js`, so it follows every theme, preset and palette through CSS `color`; pass `state` for meaning (the queue indicator shows `thinking`). It falls back to an `<img>` only for an icon uploaded in the admin panel. Every model icon and brand mark animates in real time wherever it appears, the picker and admin lists included; the shared loop in `Weave.jsx` only animates marks on screen and honours reduced motion. Uploaded icons keep their motion too: `lib/animatedimage.js` recognises animated GIF, PNG and WebP files, which upload as they are instead of going through the raster crop that would flatten them. Static files exist only for what cannot run the app's JavaScript, all in `client/public/brand/`: favicons, install and PWA icons, and the link preview image. They are named by how they look (`favicon-light.svg` is the light icon); the tab icon follows the theme through `lib/favicon.js`, called from `applyPrefs`, and the boot script in `index.html` sets it before React loads. `press-kit/` at the repository root holds logos and media for use outside the app (the README, articles, videos); nothing in the client or server may reference it. Both folders and `BRAND_FRAME` are generated together from one frame of the weave, so change them together. The retired legacy mark set is moved to the weave on startup (`legacy_mark_v1` in `db.js`).

**Routing** (`lib/route.js`): screens with an address are `/`, `/chat/:id`, `/code`, `/code/:id`, `/projects`, `/project/:id`, `/artifacts`, `/scheduled`, `/docs/...`, `/admin` and `/playground`. Sidebar chats, projects and New are real links: a plain click is handled in place, any modified or middle click is left to the browser. `parseRoute` is a whitelist. A path no screen claims returns `{ view: 'notfound' }`, which `App.jsx` renders as the `NotFound` overlay, so a mistyped URL says so instead of quietly showing home. Adding a screen means adding its pattern here, or it 404s.

**Accessibility**: an `<img>` that repeats adjacent text is `alt="" aria-hidden="true"`, never a restated label; an image carrying its own meaning (an upload, an attachment, a preview) gets real `alt`. A form reports failure through one `role="alert"` node that stays mounted so it is announced when filled, marks the offending field `aria-invalid` with `aria-describedby` pointing at that node, and clears both on the next keystroke; `Login.jsx` is the pattern. A submit that waits swaps its label and shows `.btn-spin` rather than only going disabled.

**Layout, palette and preset.** The base layout (`ui_preset`) is always the active theme's `basePreset`: activating a theme, changing the active theme's base or deleting the active theme runs `syncPreset` in `routes/theme.js`, which also moves `app_font` to the new preset's font while it is still the old default, and nothing else writes it. Members pick a colour palette under Settings, Interface (stored as `prefs.theme`, a palette id, `system`, or a retired value that `paletteFor` maps). Three registries own everything, and nothing outside them names a preset or a palette:
1. **Presets** (`lib/presets.js`, byte-identical in `server/lib/`): one entry per preset with its label, layout id, default display font, default dark and light palette, the icon defaults new models get, the setup swatch and the seed theme's note and blurb. `presetId` normalises any stored value and `presetById` always returns an entry, so a removed or unknown preset falls back to `DEFAULT_PRESET` instead of breaking. The server derives `ui_preset` validation, the font set on a switch, the model look and the builtin themes from it; the admin control, the theme labels and the setup swatches read it on the client. The boot script in `index.html` is generated from it and from `lib/palettes.js` by the `oq-boot` plugin in `vite.config.js`, so it is never edited by hand.
2. **Palettes are colour tokens only.** `<html>` carries `data-theme="light"|"dark"` (the mode) and `data-palette`, the palette's chain of ids from `paletteChain` (`"anthropic-2025q2 anthropic-2026q3"`), so a palette that builds on another (`base` in `PALETTES`) only lists what it changes. Every palette is one `:root[data-palette~="<id>"]` block of custom properties in `styles/palettes/<preset>.css`, base before variant. A palette never selects a component: a component that needs a palette-specific value reads a token with its own fallback (`var(--composer-shadow, ...)`, `var(--sidebar-label, var(--text-faint))`), so the palette block sets the token and the shared rule stays put. Mode defaults live in `base.css` (`:root` for dark, `:root[data-theme="light"]`), and a shared sheet may adjust light mode with `[data-theme="light"]`. Only `::selection` may appear as a rule in a palette file. A token that references another variable resolves on `<html>`, so it ignores subtree overrides such as `.main.incognito`; use `initial` to drop an inherited token back to the component's fallback.
3. **Layouts** (`lib/layout.js`, `data-layout` on `<html>`): behaviour that differs is a named flag in `LAYOUTS` (where the model picker sits, phone bottom sheet, chip row, floating composer, send icon, reply icons, reasoning style, instant reveal, quick prompt space, incognito wording, cursor defaults). Components read it with `useLayout()`, `App.jsx` with `layoutOf(cfg.uiPreset)`, and `ModelPickerSlot` renders the picker (and the context ring beside it) only where the layout puts it. Styles live in `styles/layouts/<id>/`: `tokens.css` is one block of layout tokens (composer box and input metrics, control size and radius, menu radius and item metrics) that every layout declares in full and the shared sheets consume, and the other files, named for what they shape (`composer.css`, `topbar.css`, `greeting.css`, `menus.css`, ...), hold only the structural rules no token can express. `index.css` imports them in order. Every selector in a layout folder contains its own `data-layout`, nothing there uses `!important`, and a layout file never carries a colour that belongs to a palette.
4. **Everything else is shared and unscoped**: the feature stylesheets, `sidebar.css`, `library.css`, `skills.css` and `design.css` (the shared interaction layer: focus ring, hover layers, motion, modal and button sizing). Their overriding rules use the `:root:root` prefix, the same idiom as the theme builder, never a preset attribute.
5. `app.css` order matters: `base.css`, the palette files, the shared sheets, `sidebar.css`, `library.css`, `skills.css`, `design.css`, then each `layouts/<id>/index.css` **last** so equal-specificity ties go to them. Do not reorder. A new feature gets its own stylesheet imported before `design.css`; do not add a general "extras" or "polish" file.
6. Scrollbars are styled once in `base.css` with the standard properties: `scrollbar-color` on `html` (inherited) and `scrollbar-width: thin` on everything. Do not style them per element; use only `scrollbar-width: none`, to hide one. Chromium ignores `::-webkit-scrollbar` rules once the standard properties apply, so do not add them.
7. Components never fork and never test which preset is active, and no layout may make a user preference inert. Palettes are offered per preset (`PALETTES[].preset`), so palette family and layout are one admin choice today; separating them means loosening `paletteFor` and the theme's base choice, not touching any stylesheet. `test/layout.test.js` and `test/palettes.test.js` enforce all of the above.

**Theme builder** (`lib/theme/`, `components/builder/`) is a configuration layer *above* the two presets: `theme.basePreset` drives the preset and through it `data-layout`, so the rules above still hold. A theme is one JSON document (`schema.js`); `css.js` compiles it into a single `<style id="oq-theme-style">` appended last, and nothing else in the client knows a theme exists. Elements are found by CSS selector (`ELEMENTS` in `schema.js`), so styling a component never requires touching it; only reordering (`data-oq-item`), editable text (`useThemeText`) and inserted nodes (`ThemeSlot`) need a component to opt in. Generated rules carry a `:root:root:root` prefix to outweigh palette rules, `!important` is reserved for hiding, and every style value is whitelisted twice: `STYLE_PROPS` in `server/lib/theme.js` at the write boundary and `safeValue()` in `css.js` before it reaches a stylesheet. Tokens naming an existing app variable emit only when set, since emitting a default would flatten the preset.

**Breakpoints**: 768px is the phone/tablet line the sidebar and composer already key on, 480px the narrow-phone line where rows stack. Reach for those two before inventing a third; the admin panel's wider steps (1180/1040/1000/900/820) exist for its own multi-column tables. Every screen must survive 400px wide.

**Performance and CSS**: long threads use occlusion (`content-visibility`) rather than virtualization, gated by content size, never on `.msg` itself (it clips the avatar). Highlighting, KaTeX and locale chunks are lazy and local. Never `overflow-y: auto` alone, it makes the other axis `auto` too; use `overflow: hidden auto`. Sticky bars must be opaque. Wide content scrolls in its own container, never the page body.

**i18n**: `t()` translates at render, `tk()` marks a literal at definition for the extractor, so module-level tables need both. English is the source language and `t()` falls back to the key. Run `npm run i18n:check` after any user-facing string change; the key scanner and its force-add list for keys it cannot see are in `client/scripts/i18n-keys.mjs`. Never hand-edit a pack, use `npm run i18n:sync` so every pack stays byte-identical in format and key order. A pack with `_meta.partial` may be incomplete without failing the check. Adding `locales/<code>.json` is the whole job for a new language; nothing hardcodes the list. `_meta.dir` is honoured but the stylesheets are not RTL-ready.

## Tests

`server/test/http.test.js` spawns the real server against a throwaway database and drives it over `node:http` (not `fetch`) with the exact header shapes a browser sends, direct and behind a dev proxy. It exists because a CSRF-guard regression broke every write from the real UI while the unit suite passed. The other suites cover pure logic only, which is why logic is pulled out of components: `node --test` cannot parse JSX. Keep test discovery glob-based, or a new test file silently stops running in CI.

## Conventions

- ESLint: `react-hooks/exhaustive-deps` is a warning on purpose (hooks key on a narrower dependency and read the rest through refs, which is what keeps the socket from reconnecting on every render). React Compiler rules are off.
- Hooks must never sit below an early return. `Message.jsx` returns early for user messages, so assistant-only hooks still go above that branch.
- Hover text is never the native `title` attribute, because the browser draws its own popup that does not match the app. Put `data-tip="…"` on the element instead. The app-wide `TipLayer` (`components/ui/TipLayer.jsx`, mounted once in `main.jsx`) shows the same bubble for every element that has one, placed bottom-right of the cursor and following it, and `data-tip-keys="Esc"` adds a shortcut hint. Every tooltip waits the same `TIP_DELAY` from `lib/tip.js` before it shows, so change the delay there and never add one per element. An icon-only control also needs an `aria-label`, because the tooltip is not its accessible name. `<Tip label keys tone toggle>` is a thin wrapper that sets the same attributes on a `<span>`, for children that cannot take `data-tip` directly (a component, for example); `toggle` pins the bubble on click, as the docs info icons do. `react/forbid-dom-props` rejects `title` on DOM elements, so lint fails if one slips in. A `title` prop on a component is not a tooltip when the component renders a heading (`Card`, `Dialog`, `Empty`); a shared component that spreads props onto a DOM element forwards `data-tip` the same way `Btn` and `Input` do. Markdown link and image titles are mapped to `data-tip` in `components/chat/Markdown.jsx`.
- A release needs `release/<major>/` with `release.json` and `notes.md`, a matching `CHANGELOG.md` entry, and identical versions in the root, `server/` and `client/` `package.json` plus their lockfiles. `npm run check:release` verifies all of it; a PR into `main` also fails unless the version was bumped.

## Adding a feature

1. Build it plain, shared and unscoped, in a stylesheet of its own imported before `design.css`.
2. If the layouts must look different, prefer a layout token: read `var(--token)` in the shared rule and declare it in every `layouts/<id>/tokens.css`. Only a structural difference becomes a rule in `layouts/<id>/<area>.css`. If only colours differ, read a palette token with a fallback and set it in the palettes that differ.
3. If behaviour differs, add a flag to every entry of `LAYOUTS` in `lib/layout.js` and read it with `useLayout()`. Never compare the preset by name.
4. Verify every layout, light and dark; switch it live with "Use this" on a theme under Admin, Interface, Themes.
5. If an admin should be able to restyle the new UI, add a selector entry to `ELEMENTS` in `lib/theme/schema.js`. That is the whole job.

## Adding a preset, layout or palette

- **Palette**: an entry in `PALETTES` (id, preset, mode, optional `base`, label, boot background) and a `:root[data-palette~="<id>"]` token block in `styles/palettes/<preset>.css`, after the block of its base.
- **Layout**: an entry in `LAYOUTS` with every flag, and a `styles/layouts/<id>/` folder with `tokens.css` (every layout token), the structural files it needs and an `index.css`, imported from `app.css` after the other layouts.
- **Preset**: an entry in `lib/presets.js` (copy it to `server/lib/presets.js`), naming its layout and its dark and light palettes, plus those palettes. The admin control, the builtin theme, the setup swatch, the boot script and the server defaults all follow from the entry.