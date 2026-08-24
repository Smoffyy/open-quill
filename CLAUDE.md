# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# open-quill

Self-hosted chat interface for local and cloud LLMs. Express + SQLite server, React + Vite client, WebSocket streaming.

**Everything is served from this origin — no CDN, no Google Fonts, no phone-home.** Fonts, KaTeX and highlight.js are bundled npm deps. Three mechanisms enforce this, none may be weakened: `server/lib/egress.js` (wraps global `fetch`, blocks public addresses when "local only" is on), `server/lib/localonly.js` (CSP confining the browser to this origin), `client/scripts/check-local.mjs` (fails `npm run build` if the bundle would fetch off-origin).

## Commands

| Command | Does |
| --- | --- |
| `npm run install:all` | Install root, server, client deps |
| `npm run dev` | Server (`:3001`) + client (`:5173`) hot-reload together |
| `npm start` | Production server on `:3001`, serves `client/dist` |
| `npm run build` | `vite build`, then the off-origin check |
| `npm run test:client` | Client logic tests |
| `npm run lint` / `lint:fix` | ESLint, whole repo (flat config at root) |
| `npm run smoke` | Server-renders every admin section/modal (catches runtime-only prop bugs) |
| `npm run i18n:check` | Missing/orphan translation keys |
| `npm run check:release` | Version has a matching release folder + changelog entry |

`server/`: `npm test` = `node --test`, auto-discovers every `*.test.js`. `client/`: `npm run dead:css` is an *advisory* unused-class report — verify before deleting, a zero-hit class can still be emitted by a library.

**Version**: root `package.json` version is the single source of truth (`server/lib/appversion.js` reads it). Full release process (branches, tags, `npm version`) is in `RELEASING.md` — don't reconstruct it from scratch.

## Layout

```
server/
  index.js       express app, middleware order, route registration, initWs
  db.js          encrypted SQLite, JSON-blob tables, getSetting/setSetting
  auth.js        sessions, argon2, authMiddleware, adminOnly
  llm/           provider-agnostic completion streaming — import from llm/index.js only
  tools/         tool schemas, arg parsing, text-fallback parsing, name aliasing
  sandbox.js     barrel; impl in sandbox/ (paths, meta, ignore, files, shell, exec)
  lib/           shared server logic
  lib/ws/        broadcast, live (in-flight turns), turn (agentic loop), connection
  routes/        one register(app) per HTTP resource
  test/          http.test.js (real server) + logic.test.js (pure logic)

client/src/
  App.jsx        top-level state, WS wiring, routing
  lib/           pure logic and hooks
  components/    UI; admin/ and artifacts/ are subtrees
  styles/        app.css imports all; openai.css always last
  locales/       one JSON per language
```

**Dependency direction is routes → lib**; `lib/ws/` never imports from `routes/`. Other `server/lib/`: `appconfig`, `audit`, `budget`, `convo`, `history`, `memory`, `models`, `prompts`, `release`, `router`, `ctxwindow`, `sandboxguard`, `toolstats`, `uploads`. Other `client/src/lib/`: `appversion`, `keybinds`/`keyboard`, `anchor`, `palettes`, `reveal`, `reasoning`, `threadmeta`, `drafts`.

The logo (`lib/brand.js`) has a client and server copy that must agree; model rows store icon paths, so moving the files needs a `LEGACY` entry in the server copy.

## Server architecture

**Database** (`db.js`): one encrypted SQLite file (SQLCipher), key from `DB_ENCRYPTION_KEY` or generated `server/.dbkey`. Every table stores one JSON blob per row plus a few mirrored columns for indexing. Schema changes are numbered `user_version` migrations, run unconditionally at startup — add a new one, don't edit an old one. **Query in SQL, not JS**: `db.<table>.all()/filter()` parses every row; hot paths get a real prepared statement instead. `getSetting` returns the cached object itself — never mutate in place, build a new value and `setSetting`.

**Untrusted input**: a lookup table indexed from outside gets `__proto__: null` (fixed value sets are a `Set`, not an object). Coerce/cap once at the boundary (`SETTING_FIELDS` in `appconfig.js` is the pattern). `db.*.byId/update/remove*` return `undefined` for a non-primitive id rather than throwing — WS handlers must type-check themselves since they're outside Express's error handler. An id from a request body must be checked against the resource it's used on, not just parsed.

**Security invariants**:
- `lib/origin.js` (`sameOrigin`) is the single "did this really come from our UI" check, applied to HTTP writes and the WS handshake. Leads with `Sec-Fetch-Site`, not `Origin` vs `Host` — a naive Host comparison breaks the Vite dev proxy. Test both `npm run dev` (proxied) and `npm start` (direct) when touching it.
- `lib/egress.js`: with "local only" on (default), only loopback/private addresses are allowed; a hostname must resolve to *all*-private addresses (blocks DNS rebinding). Web search is exempt only via the explicit `unguardedFetch` import.
- Uploads require a session, return 404 (not 401) when signed out — existence is itself privileged.
- Login timing/response never reveals which half (email/password) was wrong.
- User-supplied regex runs in a killable worker; `sandboxguard.js` rejects catastrophic-backtracking shapes (`(a+)+`) before compiling.

**Sandbox** (`server/sandbox/`, dispatch in `exec.js`): per-chat versioned virtual filesystem + bash tool. `lib/sandboxguard.js` (`normalizeRel`, `screenCommand`) is the enforced boundary — rejects absolute/UNC/home paths, `..` escapes, and a fixed list of host-admin commands (`sudo`, `docker`, `systemctl`, ...). Both are pure, tested functions; protect the false-positive set (ordinary build commands) as much as the false-negative one. Wrong tool/arg names are *resolved* via `tools/aliases.js`, not rejected outright — a small model shouldn't burn its turn budget on a typo. A truncated tool call is refused before dispatch, never partially written.

**Streaming/turns** (`lib/ws/`): a turn belongs to the chat, not the socket (`live.js` tracks by `chatId`) — reload mid-reply resumes; only incognito aborts on socket close. `stops` (a `Set`) is the durable "user asked to stop," checked at every point the loop in `turn.js` could continue — the per-step `AbortController` in `aborts` only cancels the current step. `done` and server-side `endTurn` must land in the same tick. Client: nothing appends to `messages` between `done` and `finalize()` committing. `lib/socket.js` (`useSocket`) owns the WebSocket/reconnect only; `lib/genmirror.js` mirrors in-flight turns in a ref-held `Map` so streamed tokens don't re-render the tree; `lib/threadscroll.js` owns scroll — `stick` means "at bottom, wants to stay," cleared by wheel-up/drag/the `oq-release-scroll` event.

**Context window** (`lib/ctxwindow.js`): prompt size is measured via the real tokenizer, never estimated. `slideToFit` binary-searches how many older messages to drop, always protecting the system prompt and newest user message. Oversized survivors get their middle cut, not dropped whole; images get their own eviction pass.

## Client architecture

**Two UI presets** — everything hangs off `data-preset="anthropic"|"openai"` on `<html>` (registry: `lib/palettes.js`):
1. Anthropic preset is the default codebase — write it plain, no preset-specific CSS.
2. Every OpenAI rule lives in `styles/openai.css`, scoped `[data-preset="openai"]`.
3. `openai.css` imports **last** on purpose (equal-specificity ties go to it) — don't reorder.
4. Components are never forked; branch inline on `cfg.uiPreset === 'openai'` only for *behavior*.
5. A palette must not introduce a new `data-theme` value (~40 rules are scoped to existing ones).
6. No preset may make a user pref inert — it can change a default, never the effect.

**Performance**: occlusion (`content-visibility`) not virtualization for long threads, gated by content size — never on `.msg` itself (clips the avatar). Code highlighting and KaTeX/highlight.js are lazy and local. Locale chunks are per-language and filtered from `modulePreload`.

**CSS**: never `overflow-y: auto` alone (makes the other axis `auto` too — use `overflow: hidden auto`). Menus that can leave their container portal through `lib/anchor.js`. Sticky bars must be opaque (`--code-bg` is translucent). Wide content scrolls in its own container, never the page body. Interactive elements need `:focus-visible` + real semantics.

**Menus**: `lib/submenu.js` (`useSubmenus`) holds one `open` id for a whole menu — that's what makes "only one submenu open" structural. Closing is delayed 160ms (`SUBMENU_CLOSE_DELAY`) so the pointer can travel into the panel; opening is immediate.

**i18n**: `t()` translates at render, `tk()` marks a literal at definition for the extractor — module-level tables need both. Run `npm run i18n:check` after any user-facing string change. No RTL support.

## Tests

`server/test/http.test.js` boots a real server, drives it over `node:http` (not `fetch`) — covers routing/middleware that pure-logic tests miss. `server/test/logic.test.js` and `client/test/logic.test.js` cover pure logic only — `node --test` can't parse JSX, so logic is pulled out of components to be testable. `npm run smoke` catches what `vite build` doesn't type-check.

## Keeping the tree clean

`npm run lint`, `dead:css` (advisory), `i18n:check` (has an `extra` force-add list in `appconfig.js` for keys the scanner can't see), `smoke`, `build`, `check:release` should all stay clean. ESLint: `react-hooks/exhaustive-deps` is a warning (deps arrays deliberately omit values in places); React Compiler rules are off (not adopted). Hooks must never sit below an early return — `Message.jsx` returns early for user messages, so assistant-only hooks still go above that branch.

## Adding a feature

1. Build it plain (Anthropic look) first.
2. Add `openai.css` rules only if the OpenAI skin needs different visuals.
3. Branch on `cfg.uiPreset` only for different behavior.
4. Verify both presets, light and dark — preset switching is live (Admin → Branding).