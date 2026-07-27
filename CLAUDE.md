# open-quill UI presets

open-quill ships two complete first-party skins, switchable per workspace by an admin. This document is the map for anyone or assistant touching theming.

## The one-attribute architecture

Everything hangs off a single attribute on `<html>`:

```
data-preset="anthropic" | "openai"
```

plus the ordinary theme attribute:

```
data-theme="light" | "anthropic" | "openai"   (oled is a legacy alias of the openai palette)
```

Rules:

1. **The Anthropic preset is the default codebase.** It must never require preset-specific CSS. If you write a rule for it, write it plain.
2. **Every OpenAI-preset rule lives in `client/src/styles/openai.css`** and is scoped `[data-preset="openai"]` (or `:root[data-theme="openai"]` / `:root[data-preset="openai"][data-theme="light"]` for palette tokens). Nothing OpenAI-flavored may leak into other stylesheets.
3. `openai.css` is imported **last** in `client/src/styles/app.css`, so equal-specificity ties go to the preset sheet by design. Don't reorder imports.
4. **Components are never forked.** Behavioral differences branch inline on `cfg.uiPreset === 'openai'` (React) or `document.documentElement.getAttribute('data-preset') === 'openai'` (non-React code paths). Keep the branch list short and auditable — it is enumerated below.

## Where the preset comes from

- Server setting `ui_preset` (SQLite key-value via `getSetting`/`setSetting` in `server/db.js`).
- Exposed in `GET /api/app-config` as `uiPreset` and `uiPresetChosen` (assembled in `server/lib/appconfig.js`, route in `server/routes/misc.js`).
- Changed via `PATCH /api/admin/app-config { uiPreset }` → also flips the default `app_font` (sans for openai, serif for anthropic) unless the same request sets a font, writes an audit log entry, and calls `broadcastConfig()` so every connected client re-themes live.
- First-run: when `uiPresetChosen === false`, admins see the chooser modal (`.preset-scrim` / `.preset-modal` in `App.jsx` + `modals.css`). Admins can change it later in Admin → Branding → Interface preset (`AdminPanel.jsx`).
- Pre-React boot: `client/index.html` reads `localStorage 'oq-preset'` and `'oq-theme'` and sets both attributes before paint (no flash). `applyCfg`/`applyPrefs` keep localStorage in sync afterwards.

## Theme mapping (prefs.js → applyPrefs)

- User theme prefs are only `system | light | dark` (stored `oled` reads as `dark`).
- Under preset `anthropic`: dark → `data-theme="anthropic"`.
- Under preset `openai`: dark → `data-theme="openai"` (the pitch-black palette).
- Cursor: while the preset is `openai`, the streaming cursor is **forced** circle+on for everyone; any other preset reverts to the user's stored cursor prefs (computed at apply time, never written to their prefs).

## The complete JS branch list (`cfg.uiPreset === 'openai'` or data-preset reads)

- `App.jsx` — chat topbar ModelDropdown; home-screen `.home-topbar` ModelDropdown; `hideModelPicker` for the composer; persistent per-message assistant icons (`showIcon`); floating chat composer wrapper class + 808px max width; incognito hero renders "Temporary Chat" + note; instant streaming (reveal loop `instant` flag); `QuickPrompts` keeps layout space when hidden (`qp-ghost`).
- `prefs.js` — theme mapping and forced circle cursor described above.
- `SettingsModal.jsx` — preset-aware cursor defaults when seeding the prefs object.
- `Composer.jsx` — none. The `.ml` multiline class is preset-agnostic; only `openai.css` styles it.
- `server/routes/models.js` — new-model defaults while `ui_preset === 'openai'`: `icon_size 28`, `show_name 1`, `icon_position 'left'`, `generating_anim/thinking_anim 'none'`, `dropdown_icon 0`.

## Layout invariants worth knowing before editing

- The OpenAI composer is a 52px pill: constant side padding (48px left / 96px right) in **both** single-line and `.ml` states; `.ml` only adds `padding-bottom: 52px`. Keeping the horizontal padding identical between states is what prevents wrap-point feedback loops (typing jitter). Don't reintroduce state-dependent horizontal padding.
- `.composer-bar` is absolutely pinned inside the pill (`z-index: 6`); the composer itself is `z-index: 3`, plus-menu `80 !important`, quick prompts `1`, floating chat wrapper `30`.
- The chat composer floats (`.composer-wrap.floating`) over the scroll area with a to-top gradient; `thread-pad` reserves 130px so content never hides beneath it.
- Widths: thread and composer wrapper are 808px containers with 20px side padding → 768px content, matching measured chatgpt.com.
- Measured palette (from screenshots at 1×): dark `#000` app/sidebar, `#212121` composer, `#2b2b2b` bubble, `#303030` menus, `#424242` menu hover, `#1a1a1a` active rows; light `#fcfcfc` app/sidebar, `#fff` composer with `#0000001f` border, `#e9e9e9` bubble, `#e2e2e2` active rows, black accent.
- Markdown math accepts `$…$`, `$$…$$`, and normalizes `\(…\)` / `\[…\]` (outside code) in `Markdown.jsx:normalizeMathDelims`; streaming holds unclosed math via `autoCloseMath`.

## Adding a feature checklist

1. Build it plain (Anthropic look) first.
2. If the OpenAI skin needs different visuals, add scoped rules to `openai.css` only.
3. If it needs different *behavior*, branch on `cfg.uiPreset` and add the branch to the list above.
4. Verify both presets and both light/dark before shipping. Preset switching is live — test by toggling in Admin → Branding with a second window open.

---

# Project map

Full layout of the repository so any change lands in the right file. The server was refactored from a single `server/index.js` monolith into `lib/` (shared logic) and `routes/` (HTTP endpoints); the old monolith no longer exists. Keep it that way: new endpoints go in an existing route module (or a new one registered in `index.js`), new shared logic goes in `lib/`.

## Root

- `package.json` — workspace scripts and the **single source of truth for the app version** (`server/lib/appconfig.js` reads it as `APP_VERSION`; release workflows verify tags against it).
  - `npm run install:all` — installs root, server, and client deps.
  - `npm run build` — builds the client into `client/dist`.
  - `npm run dev` — hot-reload server + client concurrently.
  - `npm start` — production server, serves `client/dist` at `http://localhost:3001`.
  - `npm run update:deps` / `check:deps` — dependency updater (`update-deps.mjs`; `update-deps-major.mjs` for majors).
- `CLAUDE.md` — this document. `README.md`, `CREDITS.md`, `LICENSE` — served by `GET /api/docs/:name`.
- `.github/workflows/` — CI and release automation (see "Branching & releases" below).
- `assets/` — repo/README imagery only, not served by the app.

## Server (`server/`)

Entry point is `index.js` (~60 lines): express setup, cookie parsing, `/uploads` static hosting, route registration, static `client/dist` serving, websocket init via `initWs(server)`, and startup tasks (custom pricing presets, audit pruning). Route order matters only in that the static-client catch-all is registered last.

### Core modules (pre-existing)

- `db.js` — encrypted SQLite (better-sqlite3-multiple-ciphers) with JSON-blob tables; exports `db.<table>` accessors plus `uid`, `now`, `getSetting`, `setSetting`. Data lives in `server/data/` (gitignored).
- `auth.js` — password hashing, JWT-style token signing, cookie parsing, sessions, `authMiddleware`, `adminOnly`, `sessionFromRequest`.
- `llm/` — provider-agnostic completion streaming, re-exported from `llm/index.js` (import that, never the leaf files): `provider.js` (endpoint/auth/prompt vars), `prompt.js` (`buildMessages`), `sampling.js`, `emitter.js` (think-tag splitting plus the text tool-call filter), `wire.js` (`normalizeMessages`, `requestKwargs`), `stream.js` (`streamCompletion`), `oneshot.js` (`oneShot`), `summarize.js` (`stripThink`, `generateTitle`, `summarizeConversation`).
- `providers.js` — provider registry (`PROVIDER_TYPES`, `getProviders`, `resolveProvider`, `providerSpec`).
- `pricing.js` — per-model cost presets (`matchPreset`, custom presets).
- `tools/` — re-exported from `tools/index.js`: `schemas.js` (`buildTools` and the per-capability schemas), `args.js` (`parseArgs`, `toCall`), `textcalls.js` (`parseTextToolCalls`, for models that emit tool calls as text instead of structured calls), `preview.js` (`livePreview`). No custom/live tools: that feature was removed.
- `toolproto.js` — inline tool-call syntax scanner shared conceptually with `client/src/toolproto.js`.
- `sandbox.js` — per-chat file sandbox (versioned files, bash, zip). `skills/sandbox.md` is the base sandbox system prompt.
- `websearch.js`, `membank.js`, `skillsys.js`, `mcp.js`, `projectfiles.js` — self-contained tool backends (each exports `execTool`/`promptFor`/`resultPayload`/`formatResult` variants).
- `totp.js` — 2FA secrets, verification, recovery codes.

### Shared logic (`server/lib/`)

- `appconfig.js` — `APP_VERSION` + `appConfig()` (the `GET /api/app-config` payload).
- `audit.js` — `logAudit`, `pruneAudit`, `clientIp`.
- `budget.js` — monthly spend math: `budgetStatus`, `budgetFor`, `monthStartMs`.
- `convo.js` — conversation assembly: `chatHistory`, token estimation + per-chat calibration (`estimateTokens`, `calibratedTokens`, `tokenCalib`), rolling-context truncation, auto-summarization (`compactStep`, `compactThreshold`), `promptVars`, `instrFor`, `styleTextFor`.
- `history.js` — `stripToolSyntax` / `historyText` (turn stored tool blocks into compact markers), `decodeOqr`.
- `memory.js` — per-user long-term memory (`updateUserMemory`, `maybeUpdateMemory`, `DEFAULT_MEMORY_PROMPT`).
- `models.js` — model shaping/resolution: `shapePublic`, `draftModels`, `publicModels`, `resolveModel(OrDefault)`, `applyEffort`, `roleLimit`, context-length detection (`modelCtx`, `detectContextLength`).
- `prompts.js` — system-prompt builders and tool formatting: `sandboxPromptFor`, `cleanCall`, `resultPayload`, `formatToolResult`, chat-search tools, `endChatPromptFor`, `longConvoReminderFor`, `pinnedFilesPrompt`.
- `queue.js` — optional one-model-at-a-time request queue (`runQueued`).
- `safety.js` — safety filter prompt + verdict parsing.
- `spaces.js` — space membership helpers, `broadcastSpace`, `removeUserFromSpaces`, `spaceAssistantRespond`.
- `tree.js` — message branching tree: `activePath`, `ensureChain`, `childrenOf`, `leafUnder`, `sortedMsgs`. All of these share one per-chat graph (`graphOf`) cached against `db.messages.version()`, so a chat's messages are loaded and parsed once per mutation rather than once per call. Do not go back to loading messages directly in these helpers.
- `llamacpp.js` — llama-server integration: `/props` and `/slots` for exact `n_ctx`, `/apply-template` plus `/tokenize` for exact prompt token counts (`llamaTokenCount`), and `isContextOverflowError` for recovering from context overflow. Results are cached; llama.cpp is the default provider type.
- `uploads.js` — `UPLOADS` dir, multer `diskStore`, attachment readers (`readUploadText`, `readImageDataUri`, `isTextLike`), `purgeUploads`.
- `ws/` — the websocket engine, re-exported from `ws/index.js`: `broadcast.js` (the `clients` map, `broadcastConfig`, `broadcastAdminConfig`, `broadcastToUser`, `killSessionSockets`, `requestedKwargs`), `turn.js` (`runCompletion`, the agentic tool-call loop, plus `maybeCompact`), `connection.js` (`initWs(server)` and the `chat`/`regenerate`/`edit`/`incognito`/`stop` handlers). `runCompletion` is module-scope and takes `(ws, state, safeSend, chat, model, ...)` rather than closing over the socket. **`lib/ws/` must never import from `routes/`** — dependency direction is routes → lib.

### HTTP routes (`server/routes/`)

Each exports `default function register(app)` and is wired in `index.js`.

- `auth.js` — login/logout, `/api/me` (profile, styles, memory, personas, saved prompts, usage, sessions, budget, password, 2FA, delete-account), message feedback, improve-prompt, style generation, user search.
- `chats/` — split by concern and wired together by `chats/index.js`: `browse.js` (list, overview, search), `folders.js`, `crud.js` (create, delete, pins), `messages.js` (chat fetch, branching), `inspect.js` (context, summary), `transfer.js` (export/import).
- `projects.js` — project CRUD + project file uploads.
- `artifacts.js` — sandbox file viewing, versions, downloads, restore, zip.
- `models.js` — public `/api/models`, admin model CRUD, discovery, reorder, publish/publish-state (draft vs published snapshot), pricing presets, context detection.
- `settings.js` — `/api/safety-check`, `GET/PATCH /api/admin/settings`, provider CRUD.
- `admin.js` — users, skills, MCP servers, feedback, safety log, audit log (+ CSV export), admin usage analytics, per-user budgets.
- `media.js` — general + admin uploads, voice transcribe/speak proxies, memory bank files.
- `spaces.js` — shared group-chat spaces (invite/respond/leave/members/messages/typing).
- `misc.js` — `/api/app-config`, `PATCH /api/admin/app-config` (branding, greetings, quick prompts, UI preset), `/api/docs/:name`.

## Client (`client/`)

Vite + React. `vite.config.js` proxies `/api`, `/uploads`, and the websocket to `:3001` in dev.

- `src/main.jsx` — entry, mounts `App`.
- `src/App.jsx` — top-level state: auth, chat list, streaming websocket handling, composer props, keyboard shortcuts, modals, routing between home/chat/spaces.
- `src/api.js` — fetch wrapper for every REST call (`api.get/post/patch/put/del`, uploads).
- `src/prefs.js` — theme/preset application (see preset doc above). `src/toast.js`, `src/clipboard.js`, `src/lightbox.js`, `src/voice.js` — small utilities. `src/toolproto.js` — client-side tool-syntax scanner. `src/qpIcons.jsx` — quick-prompt icon set.
- `src/styles/` — `app.css` imports everything; `openai.css` is the OpenAI preset (always last). Others: `base`, `layout`, `chrome`, `chat`, `composer` styles live across `polish`, `extras`, `modals`, `admin`, `artifacts`, `fonts`.

### Components (`src/components/`)

- `AdminPanel.jsx` — admin shell: tab navigation, models list/publish flow, branding, members, settings tabs. Tab ids: `overview, models, providers, branding, home, members, websearch, membank, voice, safety, memory, skills, mcp, feedback, limits, audit, analytics`.
- `admin/widgets.jsx` — shared admin primitives: `Card`, `Toggle`, `IconSlot`, `IconCropModal`, `SystemPromptEditor`, `QpIconPicker`, `AutosaveNote`, `CopyBtn`, `StatusChips`, `Grip`, `bgPreviewStyle`.
- `admin/ModelEditor.jsx` — the per-model editor (sections: General, Intelligence, Abilities, Style, Tuning; `ME_SECTIONS`).
- `Composer.jsx` — the input: attachments, dictation, slash commands, style menu, sandbox/web-search toggles, saved prompts.
- `Message.jsx`, `Markdown.jsx`, `CodeBlock.jsx`, `ReasoningBlock.jsx`, `StreamingText.jsx`, `ToolCard.jsx` — message rendering pipeline.
- `Sidebar.jsx`, `ChatMenu.jsx`, `ChatsOverview.jsx`, `SearchModal.jsx`, `BranchCompare.jsx` — navigation and history.
- `ArtifactsPanel.jsx` — sandbox file browser/preview. `ProjectsPanel.jsx`, `SpacesPanel.jsx` — projects and spaces UIs.
- `SettingsModal.jsx`, `PersonasModal.jsx`, `StyleMenu.jsx`, `ShortcutsModal.jsx`, `DocModal.jsx`, `Login.jsx`, `CallPanel.jsx`, `ModelDropdown.jsx`, `ChatControls.jsx`, `AppBackground.jsx`, `Toaster.jsx`, `Lightbox.jsx`, `icons.jsx`.

## Removed features (do not resurrect)

- **Custom Functions** (admin-defined browser-side buttons): `server/functions.js`, `FunctionsBar.jsx`, `/api/admin/functions`, `cfg.functions` — all deleted.
- **Live Tools** (admin-defined server-side JS tools): `server/customtools.js`, `/api/admin/tools`, `customToolSchemas` in `tools.js`, model fields `tools_allowed`/`tools_auto` — all deleted. Stale `tools_allowed`/`tools_auto` keys may linger in old model rows in the DB; they are ignored everywhere.

## Branching & releases

Permanent branches: `dev` → `beta` → `stable`. Versions live in tags, not branch names.

- Pre-release: merge `dev` into `beta`, bump root `package.json` version, tag `vX.Y.Z-beta.N` → `.github/workflows/prerelease.yml` builds and publishes a GitHub pre-release named "X.Y.Z Beta N".
- Stable: merge `beta` into `stable`, tag `vX.Y.Z` → `.github/workflows/release.yml` publishes the release and marks it latest.
- `ci.yml` runs build + server smoke test on every push/PR to the three branches. `version-guard.yml` blocks PRs into `beta`/`stable` unless the root `package.json` version was bumped.
- Releases only fire on tags, never on branch pushes, so an accidental push to `beta` publishes nothing.

## Tests

`server/test/logic.test.js` runs on `node --test` with no extra dependencies: `npm test` from the repo root, or `cd server && npm test`. CI runs it after the build and smoke test.

It covers the pure logic that is easy to break silently: kwarg resolution and pairing chains, text tool-call parsing (including the negative cases where prose or an unknown tool name must NOT become a call), compaction thresholds and in-turn tool trimming, llama.cpp overflow detection, and the Windows command translation in `sandbox.js`. Add cases here when touching any of those; they are cheap and they have already caught a real regression.

CI syntax-checks every `.js` file under `server/` via `find`, so new files and folders are covered automatically. Do not replace that with a hand-written file list.
