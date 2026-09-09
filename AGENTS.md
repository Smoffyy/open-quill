## Open Quill

Self-hosted chat interface for local and cloud LLMs. Express 5 + encrypted SQLite server, React 19 + Vite client, WebSocket streaming, per-workspace file sandbox. Package name is `open-quill`; the repo folder may be named differently.

`dev` is the working branch, `stable` is release; PRs target `dev`.

## Commands

Run from the repo root unless noted.

| Command | Does |
| --- | --- |
| `npm run install:all` | Install root, `server/` and `client/` deps |
| `npm run dev` | Server `:3001` + Vite client `:5173` (proxied), both hot-reloading |
| `npm start` | Production server on `:3001`, serves `client/dist` |
| `npm run build` | `vite build` then `check-local.mjs` (fails on any off-origin URL in the bundle) |
| `npm run lint` / `lint:fix` | ESLint over the whole repo (flat config at root) |
| `npm run test:client` | `client/test/logic.test.js` |
| `npm run smoke` | SSR-renders every admin section and modal, catching runtime-only prop bugs |
| `npm run i18n:check` | Missing/orphaned translation keys (`-- --json` for machine output) |
| `npm run i18n:sync` | Prune orphans, merge a translation patch, scaffold a new language |
| `npm run check:release` | Version, release folder and changelog entry agree |
| `npm run check:deps` / `update:deps` | Dependency report / update |

Server tests: `cd server && npm test` runs `node --test`, which auto-discovers every `server/test/*.test.js`. A single file: `cd server && node --test test/logic.test.js`. A single case: `node --test --test-name-pattern "<name>" test/logic.test.js`.

Client-only extras live in `client/`: `npm run dead:css` is an **advisory** unused-class report (a zero-hit class can still be emitted by a library), `npm run check:local` re-runs the off-origin check against an existing `dist/`.

CI (`.github/workflows/ci.yml`, Node 24) runs, in order: server syntax check, `lint --quiet`, build, `i18n:check`, `smoke`, `check:release`, `test:client`, `cd server && npm test`. All must stay green.

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
  lib/            shared logic (appconfig, convo, ctxwindow, prompts, router, memory, tasks, theme, ...)
  lib/ws/         broadcast, live (in-flight turns), turn (agentic loop), connection
  routes/         one default-exported register(app) per resource
  test/           http.test.js (real server) + logic/mcp/schema/usage tests (pure)
```

Dependency direction is **routes to lib**; `lib/ws/` never imports from `routes/`.

**Security invariants**:
- `lib/origin.js` (`sameOrigin`) is the single "did this come from our own UI" check, used by HTTP writes and the WS handshake. It leads with `Sec-Fetch-Site`, not `Origin` vs `Host`, because a naive host comparison breaks behind the Vite dev proxy and any reverse proxy. Test both `npm run dev` and `npm start` when touching it.
- Uploads return 404, not 401, when signed out: existence is itself privileged.
- Login timing and responses never reveal which half was wrong.
- Untrusted keys index lookup tables declared with `__proto__: null` (`SETTING_FIELDS` in `routes/settings.js` is the pattern: coerce and cap once at the boundary). WS handlers sit outside Express's error handler, so they type-check ids themselves.
- User-supplied regex runs in a killable worker (`sandbox/regexsearch.worker.js`); `lib/sandboxguard.js` rejects catastrophic-backtracking shapes before compiling.

**Sandbox** (`server/sandbox/`, dispatch table in `exec.js`): a versioned virtual filesystem plus a bash tool. Every sandbox function takes a workspace key, not a chat id: `wsKey(chatRow)` in `sandbox/paths.js` returns the project's shared workspace when the chat belongs to one and the chat's own otherwise, so a project's chats share one directory and its attached files are ordinary files in it. `bash` runs with an explicit environment allowlist, never this process's own. `lib/sandboxguard.js` (`normalizeRel`, `screenCommand`) is the enforced boundary, rejecting absolute/UNC/home paths, `..` escapes and a fixed list of host-admin commands. Both are pure and tested; the false-positive set (ordinary build commands must keep working) matters as much as the false-negative one. Wrong tool and argument names are *resolved* through `tools/aliases.js` rather than rejected, so a small model does not burn its turn budget on a typo; a truncated tool call is refused before dispatch, never partially applied.

**Turns and streaming** (`lib/ws/`): a turn belongs to the chat, not the socket, so `live.js` tracks by `chatId` and a mid-reply reload resumes. `stops` (a `Set`) is the durable "user asked to stop", checked everywhere the agentic loop in `turn.js` could continue; the per-step `AbortController` in `aborts` only cancels the current step.

**Context window** (`lib/ctxwindow.js` with `lib/convo.js`): prompt size is measured with the model's real tokenizer, never estimated. `slideToFit` binary-searches how many older messages to drop while always protecting the system prompt and the newest user message; oversized survivors get their middle cut rather than being dropped whole, and images get their own eviction pass.

## Client

`client/src/App.jsx` holds top-level state, WS wiring and routing. Its state lives in `client/src/lib/`, one hook per concern; App wires them together and owns the ordering between them, nothing more:

- `turnstream`: the assistant message being written (received text, revealed text, reveal timer); `revealChunk`/`revealPeriod` are pure and tested.
- `turnmeta`: telemetry, prompt size, backend status, steers, routing. `route` sits deliberately outside `reset()` because the `routed` frame arrives before `start`.
- `livetools`: the file being written and the tool rows of the current step; `mergeCall` keeps simultaneous calls on their own rows by index.
- `genmirror`: per-chat records for turns not on screen, held in a ref'd `Map` so streamed tokens do not re-render the tree.
- `wsmessages`: one handler per server frame, `dispatchWs(m, ctx)`. Two protocol rules live here: a frame for a background chat updates the mirror, and only a frame for `activeKey()` touches the view. It cannot import `i18n.jsx` (`node --test` cannot parse JSX), so translated strings arrive through `ctx.text` and `ctx.actions`.
- `socket`/`wsclient`: socket lifecycle apart from React. A `close()` must stay closed; letting `onclose` schedule a retry leaks a live socket on every remount, and App is keyed by language.
- `threadscroll` owns scroll, where `stick` means "at bottom, wants to stay".
- `dismiss` (`useDismiss`) is the one outside-click/Escape implementation, `submenu` (`useSubmenus`) holds one open id per menu so "only one submenu open" is structural, `anchor` portals menus that can leave their container, `route` has the pure `parseRoute` and path builders, `lru` the bounded chat cache.

`lib/brand.js` exists in both a client and a server copy and they must agree; model rows store icon paths, so moving files needs a `LEGACY` entry in the server copy.

**Two UI presets**, everything hanging off `data-preset="anthropic"|"openai"` on `<html>` (registry `lib/palettes.js`):
1. Anthropic is the default codebase, written plain with no preset-specific CSS.
2. Every OpenAI rule lives in `styles/openai.css`, scoped `[data-preset="openai"]`.
3. `app.css` imports `openai.css` **last** on purpose so equal-specificity ties go to it. Do not reorder.
4. Components are never forked; branch inline on `cfg.uiPreset === 'openai'` for *behavior* only.
5. A palette must not introduce a new `data-theme` value, and no preset may make a user preference inert.

**Theme builder** (`lib/theme/`, `components/builder/`) is a configuration layer *above* the two presets: `theme.basePreset` drives `data-preset`, so the rules above still hold. A theme is one JSON document (`schema.js`); `css.js` compiles it into a single `<style id="oq-theme-style">` appended last, and nothing else in the client knows a theme exists. Elements are found by CSS selector (`ELEMENTS` in `schema.js`), so styling a component never requires touching it; only reordering (`data-oq-item`), editable text (`useThemeText`) and inserted nodes (`ThemeSlot`) need a component to opt in. Generated rules carry a `:root:root:root` prefix to outweigh palette rules, `!important` is reserved for hiding, and every style value is whitelisted twice: `STYLE_PROPS` in `server/lib/theme.js` at the write boundary and `safeValue()` in `css.js` before it reaches a stylesheet. Tokens naming an existing app variable emit only when set, since emitting a default would flatten the preset.

**Performance and CSS**: long threads use occlusion (`content-visibility`) rather than virtualization, gated by content size, never on `.msg` itself (it clips the avatar). Highlighting, KaTeX and locale chunks are lazy and local. Never `overflow-y: auto` alone, it makes the other axis `auto` too; use `overflow: hidden auto`. Sticky bars must be opaque. Wide content scrolls in its own container, never the page body.

**i18n**: `t()` translates at render, `tk()` marks a literal at definition for the extractor, so module-level tables need both. English is the source language and `t()` falls back to the key. Run `npm run i18n:check` after any user-facing string change; the key scanner and its force-add list for keys it cannot see are in `client/scripts/i18n-keys.mjs`. Never hand-edit a pack, use `npm run i18n:sync` so every pack stays byte-identical in format and key order. A pack with `_meta.partial` may be incomplete without failing the check. Adding `locales/<code>.json` is the whole job for a new language; nothing hardcodes the list. `_meta.dir` is honoured but the stylesheets are not RTL-ready.

## Tests

`server/test/http.test.js` spawns the real server against a throwaway database and drives it over `node:http` (not `fetch`) with the exact header shapes a browser sends, direct and behind a dev proxy. It exists because a CSRF-guard regression broke every write from the real UI while the unit suite passed. The other suites cover pure logic only, which is why logic is pulled out of components: `node --test` cannot parse JSX. Keep test discovery glob-based, or a new test file silently stops running in CI.

## Conventions

- ESLint: `react-hooks/exhaustive-deps` is a warning on purpose (hooks key on a narrower dependency and read the rest through refs, which is what keeps the socket from reconnecting on every render). React Compiler rules are off.
- Hooks must never sit below an early return. `Message.jsx` returns early for user messages, so assistant-only hooks still go above that branch.
- A release needs `release/<major>/` with `release.json`, `notes.md` and an icon under 500 KB, a matching `CHANGELOG.md` entry, and identical versions in the root, `server/` and `client/` `package.json` plus their lockfiles. `npm run check:release` verifies all of it; a PR into `stable` also fails unless the version was bumped.

## Adding a feature

1. Build it plain, in the Anthropic look, first.
2. Add `openai.css` rules only if the OpenAI skin needs different visuals.
3. Branch on `cfg.uiPreset` only for different behavior.
4. Verify both presets, light and dark; preset switching is live under Admin, Interface.
5. If an admin should be able to restyle the new UI, add a selector entry to `ELEMENTS` in `lib/theme/schema.js`. That is the whole job.