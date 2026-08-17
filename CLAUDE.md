# open-quill

Self-hosted chat interface for local and cloud LLMs. Express + SQLite server, React + Vite client, WebSocket streaming.

**Everything is served from this origin.** No CDN, no Google Fonts, no analytics, no phone-home. Fonts, KaTeX and highlight.js are npm dependencies bundled locally. Three mechanisms enforce it and none may be weakened: `server/lib/egress.js` wraps global `fetch` at boot, `server/lib/localonly.js` sends a Content-Security-Policy confining the browser to this origin, and `client/scripts/check-local.mjs` fails `npm run build` if anything in `dist/` would fetch off-origin.

## Scripts

Run from the repo root:

| Script | Does |
| --- | --- |
| `npm run install:all` | Install root, server and client dependencies |
| `npm run dev` | Hot-reload server (`:3001`) and client (`:5173`) together |
| `npm start` | Production server on `:3001`, serving `client/dist` |
| `npm run build` | Build the client, then verify nothing remote crept in |
| `npm run test:client` | Client logic tests |
| `npm run lint` / `lint:fix` | ESLint over client and server (flat config at the root) |
| `npm run smoke` | Server-render every admin section and modal |
| `npm run i18n:check` | Report missing/orphan translation keys |
| `npm run check:local` | Off-origin check on its own |
| `npm run check:release` | Verify this version has a release folder, notes and a changelog entry |
| `npm run check:deps` / `update:deps` | Dependency report / update |

In `server/`: `npm test` (`node --test`, discovers every `*.test.js`).
In `client/`: `npm run dead:css` (advisory unused-class report — verify before deleting; a zero-hit class can still be emitted by a library).

The root `package.json` version is the **single source of truth** for the app version; `server/lib/appversion.js` reads it and the release workflows check tags against it. That module is deliberately dependency-free so `check-release.mjs` can import the release logic without booting the database.

## Layout

```
server/
  index.js            express setup, route registration, initWs, startup tasks
  db.js               encrypted SQLite, JSON-blob tables, getSetting/setSetting
  auth.js             hashing, sessions, authMiddleware, adminOnly
  totp.js             2FA
  providers.js        provider registry     pricing.js   cost presets
  llm/                completion streaming — import from llm/index.js only
  tools/              tool schemas, arg parsing, text-call parsing, name aliases
  sandbox.js          barrel; implementation lives in sandbox/
  sandbox/            paths, meta, ignore, zip, files, hostenv, shell, args, exec
  websearch.js membank.js skillsys.js mcp.js projectfiles.js
  lib/                shared logic (see below)
  lib/ws/             broadcast, live (in-flight turns), turn (agentic loop), connection
  routes/             HTTP endpoints, one register(app) per module
  test/               http.test.js (real server) + logic.test.js (pure logic)

client/src/
  App.jsx             top-level state, streaming, routing between home/chat/spaces
  api.js prefs.js toast.js clipboard.js voice.js lightbox.js toolproto.js
  lib/                pure logic and hooks (see below)
  components/         UI; admin/ and artifacts/ are subtrees
  styles/             app.css imports all; openai.css always last
  locales/            one JSON per language
  scripts/            check-local, i18n-check, dead-css, smoke

client/public/
  brand/              the starburst logo, referenced at runtime
  pwa/                install icons, referenced only by index.html and the manifest
  fonts/              woff2, loaded by styles/fonts.css
```

**The logo is `lib/brand.js`, not a string.** `BRAND_ICON` and its two motion variants have a client copy and a server copy (`server/lib/brand.js`, which seeds them into new model rows); the two must agree and neither imports the other. Model rows *store* these paths, so moving the files means adding to `LEGACY` in the server copy — the boot migration in `db.js` rewrites exact matches once and leaves operator uploads alone.

Key `server/lib/` modules: `appconfig`, `audit`, `origin` (same-origin guard), `budget`, `convo` (conversation assembly), `history`, `memory`, `models`, `prompts`, `release` (Settings → Version content), `sandboxguard` (path + command screening), `purge`, `queue`, `safety`, `spaces`, `tree` (message branching), `llamacpp`, `ctxwindow` (prompt fitting), `kwargs`, `router`, `toolstats`, `uploads`, `egress`, `localonly`.

Key `client/src/lib/` modules: `keybinds` + `keyboard` (shortcut model and listener), `threadscroll` + `genmirror` (see below), `submenu`, `focus`, `anchor` (portaled menu placement), `mathjs`, `hljs`, `reveal`, `reasoning`, `threadmeta`, `artifacts`, `drafts`, `attachments`, `dictation`, `palettes`, `status`.

**Dependency direction is routes → lib.** `lib/ws/` must never import from `routes/`.

## Architecture rules

### Two UI presets

Everything hangs off `data-preset="anthropic" | "openai"` on `<html>`, plus `data-theme` and an optional `data-palette`. `client/src/lib/palettes.js` is the registry and maps a palette id to a `{ theme, palette }` pair.

1. **The Anthropic preset is the default codebase.** Write its rules plain; it must never need preset-specific CSS.
2. **Every OpenAI rule lives in `client/src/styles/openai.css`**, scoped `[data-preset="openai"]`. Nothing OpenAI-flavoured may leak into another stylesheet.
3. `openai.css` is imported **last**, so equal-specificity ties go to it by design. Don't reorder imports.
4. **Components are never forked.** Behavioural differences branch inline on `cfg.uiPreset === 'openai'`.
5. **A palette must not introduce a new `data-theme` value** — around forty rules are scoped `:root[data-theme="anthropic"]` and a new theme value silently drops all of them. Add a token-override block instead.
6. **No preset may make a user pref inert.** A preset may change a pref's *default*, never its effect.

The preset comes from the `ui_preset` setting, is exposed by `GET /api/app-config`, and changes live via `broadcastConfig()`. `client/index.html` reads `localStorage` and sets the attributes before paint.

### Handling untrusted input

- **A lookup table indexed from outside gets `__proto__: null`.** `TABLE['constructor']` is otherwise truthy and inherits from `Object`. A fixed set of allowed values is a `Set`, not an object.
- **Coerce and cap at the boundary, once** — `String(x ?? '').slice(0, n)` at the route. `PATCH /api/admin/settings` does this from the `SETTING_FIELDS` table; adding a setting is one row there, never a hand-written `if`.
- **Never index the database with an unchecked value.** `db.*.byId`/`update`/`remove*` return `undefined` for non-primitives instead of throwing; WebSocket handlers must type-check themselves, being outside the express error handler.
- **An id from a request body must be checked against the resource it will be used on.**
- **`getSetting` returns the cached object, not a copy** — never mutate a setting in place; build a new value, then `setSetting` and invalidate derived caches.
- `req.body` is normalized to `{}` by middleware right after `express.json()`; Express 5 leaves it `undefined` otherwise.

### Security invariants

- **`lib/origin.js` is the single answer to "did this come from our own UI".** `Sec-Fetch-Site` is the primary signal — comparing `Origin` to `Host` is wrong the moment anything proxies. Applied to HTTP writes (before body parsing) and to the WebSocket handshake. Test both `npm run dev` (proxied) and `npm start` (direct); the failure mode is silent and total.
- **Egress**: loopback and private ranges allowed, public refused. Hostnames resolve with `dns.lookup(all: true)` and are allowed only if *every* address is private. Web search is exempt by construction via `unguardedFetch`, because it fetches public result pages; the exemption is reachable only by importing that symbol.
- **Uploads require a session** (404, not 401 — existence is itself privileged). Stored under a fresh uuid, served with `nosniff`, a strict CSP and `Content-Disposition: attachment` outside a small inline set. The app icon is the one public exception and follows the setting.
- **Login and registration are separate endpoints.** Login never reveals which half was wrong and always pays for one argon2 verify, so timing is not an oracle. The limiter keys on both address and account; registration counts under its own key.
- **A user-supplied regex runs in a killable worker** (`sandbox/regexsearch.js`, 5s). `compileSearchPattern` rejects the obvious catastrophic shapes first. Plain substring search stays in-process. `lib/router.js` screens rule patterns the same way.

### The sandbox

**Never let the model guess anything the server already knows.** The host environment is detected by scanning `PATH`, not assumed, and the same object feeds the tool description, the prompt section and the error hints so they cannot contradict each other.

- The boundary is **enforced, not requested**: `lib/sandboxguard.js` holds `normalizeRel` (forgiving where intent is unambiguous, strict where it is not) and `screenCommand`. Both are pure and tested. Protect the false-positive set — ordinary build commands must keep working.
- **Wrong tool names, argument names and near-miss edits are resolved, not rejected**, because a small model that spelled something wrong will otherwise burn its whole turn budget resending it. Resolution is scoped to the enabled tool set and an exact name always beats an alias.
- **A cut-off tool call is not a malformed one.** Truncated arguments are flagged via the `CUT_OFF` symbol and the call is refused *before dispatch*; nothing partial is written to disk.
- **Every failure teaches** — name the argument, show a correct example, list what is valid. `turn.js` stops early on a repeated step or three steps with no progress.
- On Windows: `cmd.exe` builtins reject forward slashes, so `winTranslate` flips them for a fixed set of commands; the file tools' `path` argument still always takes forward slashes.

### Streaming and turns

- **A turn belongs to the chat, not the socket** (`lib/ws/live.js`). Reloading mid-reply resumes; only incognito turns abort on socket close. One turn per chat, with `beginTurn`/`endTurn` paired in a `finally`.
- **`done` and `endTurn` must land in the same tick** server-side — nothing async may separate them, or the client's queued send is rejected.
- **Nothing may be appended to `messages` between `done` arriving and `finalize()` committing** client-side. `startNextTurn` is the single place a queued send is dispatched, and it runs after `finalize()`'s `setMessages`.
- **The socket itself is `lib/socket.js`** (`useSocket`), which owns the WebSocket, the exponential reconnect backoff and the teardown, and nothing else. It takes `onMessage` and `shouldReconnect` through refs so a re-render never re-opens the connection, and `send` returns `false` rather than throwing when the socket is down — `App.jsx` turns that `false` into the user-facing "connection lost" notice. **`handleWs` deliberately stays in `App.jsx`**: it is a dispatch over the reveal loop's own refs (`targetContent`, `pendingDone`, `dispLen`, `finalize`), and moving it out would mean threading thirty of them through a parameter object, which reads as modular while coupling more tightly.
- The client mirror of in-flight turns lives in **`lib/genmirror.js`** (`useGenMirror`). It holds the `Map` in a ref so a token never re-renders the tree, and derives `busyChats` only when membership actually changes. `App.jsx` never touches the Map: it goes through `queueRec`/`dropRec`/`recFor`/`resumeRec`/`peek`, which is what keeps the mirror from drifting. Adding a field to a turn record means editing `blankRecord` there, not spreading a literal at a call site.

**Thread scrolling is `lib/threadscroll.js`** (`useThreadScroll`), which owns every scroll ref and both loops: the rAF-coalesced `onScroll` read and the streaming autoscroll (`startFollow`/`stopFollow`). Two things to preserve. `stick` is the whole model — it means "the user is at the bottom and wants to stay there" — and is cleared by wheel-up, an upward drag, or the `oq-release-scroll` event the reasoning block dispatches. And `pinToBottom(smooth, delay)` replaces the `stick.current = true; setTimeout(scrollBottom, N)` idiom that was written out at seven call sites; use it rather than reaching for the refs.

### Context window

**Prompt size is measured, never estimated**, for any llama.cpp-backed model. Every endpoint carries the model name (router mode 400s without it). Context length comes from `/props` → `/v1/models` → `/slots`, and is the **per-slot** value; `n_ctx_train` is not the window. The estimator only picks the first probe point. `slideToFit` keeps the system prompt and newest user message and verifies every candidate with the real tokenizer. Images carry a reserve, corrected upward from real usage and never lowered.

### Performance patterns

- **Occlusion, not virtualization**, for long threads: `content-visibility` on message bodies, gated by content size rather than message count. Never on `.msg` itself — paint containment clips the icon-left avatar.
- **Code blocks highlight lazily**, off the render path, one job per idle slot.
- **KaTeX and highlight.js are lazy and local**, loaded through a module-level singleton plus `useSyncExternalStore`. highlight.js loads common → individual languages → full build.
- **Locales are per-language chunks.** `manualChunks` names them `locale-<code>` and `modulePreload.resolveDependencies` filters them; without that filter every language is downloaded by everyone.
- **Query in SQL, not in JavaScript.** `db.<table>.all/filter/find` parse the entire table — fine for small tables, wrong on any hot path.
- Scroll handlers are rAF-coalesced and set state only when a derived boolean actually flips.

### CSS

- **Never write `overflow-y: auto` on its own.** Per spec it makes the other axis `auto` too, silently creating a horizontal scroll container. Always `overflow: hidden auto`.
- **A menu that can leave its container must be portaled** through `lib/anchor.js`. Clamp conditionally — an unconditional inline `left` is a feedback loop waiting for its trigger to resize.
- **A `position: sticky` bar must be opaque.** `--code-bg` is translucent in most palettes, so `.code-bar` reproduces the whole stack the wrap composites against.
- Wide content scrolls inside its own container (`table`, `pre`, `.katex-display`); the page body never scrolls horizontally.
- Anything interactive needs a visible `:focus-visible` ring and, if it is not a real button, a role, `tabIndex` and key handling. Use the shared `Switch` rather than writing switch markup by hand.

### i18n

`t()` translates at render, `tk()` marks a literal at definition so the extractor can see it — module-level tables need both. Run `npm run i18n:check` after touching any user-facing string; every locale is expected to report `complete`. **There is no RTL support**; the stylesheets use physical properties throughout.

## Tests

`server/npm test` discovers every `*.test.js` — do not replace discovery with a named list.

- **`test/http.test.js`** boots the real server as a child process and drives it over `node:http` (not `fetch`, which may refuse to set `Origin`/`Sec-Fetch-Site`). It exists because 128 unit tests passed while every button in the app was dead. Adding an endpoint or middleware means a case here, not just in `logic.test.js`.
- **`test/logic.test.js`** covers pure logic: kwargs, text tool-calls, compaction, overflow detection, Windows command translation, the sandbox guards, alias resolution, `preferredChild`. The sandbox tool tests deliberately touch a real temp workspace, because importing a module does not resolve identifiers a handler only references at call time.
- **`client/test/logic.test.js`** covers the keybind model, reasoning parsing, reveal resolution, maths preprocessing, thread/branch helpers and the artifacts diff logic. **Only import-free modules are testable** — `node --test` cannot parse JSX, which is why pure logic is pulled out of components.
- **`npm run smoke`** server-renders every admin section and modal. `vite build` type-checks nothing, so passing wrong props compiles perfectly and blanks the panel at runtime.

## Branching and releases

Step-by-step commands live in [RELEASING.md](RELEASING.md); this section is the shape of it.

Two branches: **`dev`** is where work lands, **`stable`** is what is released. Channels live in the version string, not in branch names.

**A tag is the version string exactly** — `27.2.0-beta.3`, no `v` prefix. `.npmrc` sets `tag-version-prefix=` so `npm version` agrees, and both release workflows match the bare form.

`dev` carries a prerelease tail (`27.2.0-beta.3`) and tagging it publishes a GitHub pre-release. Dropping the tail and merging to `stable` is what makes something a release — tag `27.2.0` and `release.yml` marks it latest. The last commit before a release PR is the bump to the final version, and the first commit after merging opens the next cycle (`27.3.0-beta.1`), so `dev` is never equal to `stable`.

`ci.yml` runs on push/PR to both branches. `version-guard.yml` blocks a PR into `stable` that does not raise the version, comparing with `check-version-bump.mjs` — **`sort -V` is not usable here**, as it ranks `27.2.0-beta.5` above `27.2.0` and would reject the exact PR that ships a release.

### What Settings → Version shows

`release/<line>/` holds it — `release.json` (codename, released, icon),
`notes.md`, and the badge. Cutting a release is a new folder plus a version bump.

`server/lib/release.js` picks the folder from the root `package.json` version,
most specific first: `27.1.0`, then `27.1`, then `27` — so one folder per major
line is normal, and per-patch detail stays in `CHANGELOG.md`. A missing folder is
legitimate and degrades quietly, which is why a bump with no folder looks blank.

**Release notes must not go back into `/api/app-config`.** They are fetched
lazily from `GET /api/release` because that config payload rides every page load
and every `broadcastConfig()`.


## Keeping the tree clean

These checks find dead weight, and all should stay at zero:

| Check | Finds |
| --- | --- |
| `npm run lint` | unused vars and imports, hook-rule violations, unreachable code |
| `npm run dead:css` | class names in `styles/` no `.js`/`.jsx`/`.html` references |
| `npm run i18n:check` | missing **and** orphaned translation keys |
| `npm run smoke` | components that crash when rendered |
| `npm run build` | anything that would fetch off-origin |
| `npm run check:release` | a version bump with no release folder, notes or changelog entry |

Two traps when acting on them. **`dead:css` is advisory** — a zero-hit class can still be emitted by a library (`katex-error`, `hljs`), which is what `EXTERNAL` at the top of the script is for; verify before deleting. And **`i18n:check` force-adds keys its scanner cannot see** (the `extra` array), mostly the quick-prompt defaults that live in `server/lib/appconfig.js` rather than in client source. An entry there suppresses orphan detection for that key, so when you delete a string, check that array too or its translations quietly survive forever.

`import React` is not needed — the JSX transform is automatic. Components import only the hooks they use.

**ESLint runs in CI and must stay at zero errors.** `eslint.config.js` is flat config at the repo root covering both workspaces. Two calibration decisions to know before "fixing" the config: `react-hooks/exhaustive-deps` is a **warning**, because several deps arrays here deliberately omit values, and the React Compiler rules that ship in `eslint-plugin-react-hooks` 7 (`set-state-in-effect`, `immutability`, `purity`, `refs`, `static-components`) are **off**, because this codebase does not opt into the compiler and they flag ~90 working patterns. Turn them on only alongside actually adopting it.

**Hooks must never sit below an early return.** `Message.jsx` renders user and assistant messages from one component and returns early for `msg.role === 'user'`; every hook belongs above that branch, even the ones only the assistant path uses.

## Menus

`client/src/lib/submenu.js` (`useSubmenus`) owns every hover-opened submenu in a menu. It holds **one** `open` id rather than a boolean per submenu, which is what makes "only one open at a time" structural instead of something each handler has to remember — the previous four-boolean version had each opener closing only some of its siblings, so they overlapped. Opening is immediate; only closing is delayed, by `SUBMENU_CLOSE_DELAY` (160ms), and that delay is load-bearing — the pointer leaves the parent row before it reaches the submenu panel, so closing on `mouseleave` with no grace period makes a submenu impossible to move into. Use this hook for any new submenu rather than adding another timer.

## Adding a feature

1. Build it plain (Anthropic look) first.
2. Scoped rules in `openai.css` only if the OpenAI skin needs different visuals.
3. Branch on `cfg.uiPreset` only if it needs different *behaviour*.
4. Verify both presets, light and dark. Preset switching is live — toggle in Admin → Branding with a second window open.