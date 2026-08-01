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
- The thread rail, find bar and branch map add **no** entries to this list. Every preset difference for them is CSS-only, scoped in `openai.css`. Keep it that way.

## Thread performance: occlusion, not virtualization

Long threads are kept cheap with `content-visibility: auto` rather than windowing, because unmounting messages would fight the streaming reveal loop, the `stick`/`scrollHeight` autoscroll math in `App.jsx`, and the `nth-child` stagger animation in `polish.css`. `Message`, `Markdown` and `CodeBlock` are already memoized, so the remaining cost is layout and paint, which is exactly what occlusion removes.

Rules, all in `threadnav.css`:

1. `App.jsx` adds `.virt` to `.thread` above 24 messages. Nothing else toggles it, so removing that one class disables the whole feature.
2. Occlusion is applied to `.assistant-body` and `.bubble-user`, **never to `.msg`**. `content-visibility` implies paint containment, which would clip the negatively-positioned `.il-avatar` in the icon-left layout. `.msg.icon-left` is excluded from the assistant rule for the same reason.
3. The last 8 siblings are excluded via `:not(:nth-last-child(-n+8))` so the streaming message and its neighbours are never skipped.
4. `contain-intrinsic-size: auto <px>` lets the browser remember real sizes after first render; the literal is only the initial estimate. Browsers without support simply render everything as before.

## Navigation prefs

The rail, find and branch map are all opt-out, under **Settings > Chat > Navigation**. Four keys on `user.prefs`, every one defaulting to on and therefore read with `!== false` everywhere:

| Pref | Off means |
| --- | --- |
| `threadRail` | `ThreadRail` is not mounted at all, so its `IntersectionObserver` never runs |
| `threadFind` | no header button, and `Ctrl+F` is left alone so the browser's own find works again |
| `branchMap` | no header button, no `b` shortcut, and `BranchTree` is never imported |
| `msgKeys` | `j`/`k` and the `c`/`e`/`r`/`y` message actions are inert |

Two rules when adding to this area. Gate the *mount*, not just the visibility, so a disabled feature costs nothing. And set the pref key as the `pref` field on the matching `KEYBIND_ACTIONS` entry in `lib/keybinds.js` (or as a third element on a static `ShortcutsModal` `GROUPS` item) so the shortcut list and the keybinds panel hide what is turned off; empty groups drop out on their own.

## Keyboard model

`client/src/lib/keybinds.js` is the single source of truth. `KEYBIND_ACTIONS` is one flat list; every consumer derives from it, so adding a shortcut is one entry plus one `case` in the `App.jsx` handler. Nothing else needs touching: the shortcuts modal, the settings panel and the i18n extractor all read the list.

Each action carries:

| Field | Meaning |
| --- | --- |
| `id` | stable key, also the storage key inside `prefs.keybinds` |
| `group` | heading shared by `ShortcutsModal` and `KeybindsPanel` |
| `label` | English string, translated via `t()` and extracted by `i18n-check.mjs` |
| `def` | default combo |
| `pref` | optional navigation pref that must not be `false` for the action to fire or be listed |
| `typing` | may fire while focus is in an input or contenteditable |
| `overlay` | may fire while an `.overlay` is mounted |
| `fixed` | not rebindable (currently only `Escape` / clear focus) |

Defaults: `Ctrl+K` palette, `Ctrl+Shift+F` chat search, `Ctrl+Shift+O` new chat, `Ctrl+Shift+S` sidebar, `Ctrl+F` in-thread find (intercepted only when the open chat has messages), `?` shortcuts, `b` branch map, `j`/`k` message focus, and on the focused message `c` copies, `e` edits, `r` retries, `y` branches, `Escape` clears.

Combos are strings, `mod+alt+shift+key`, always in that order. `mod` is Ctrl or Cmd, deliberately not distinguished so one binding works on every platform. Matching is an exact string compare against a `Map` built once per prefs change by `keybindIndex`, not a chain of `if` tests. `comboKeys` renders a combo for display and swaps in ⌘/⌥/⇧ on Apple platforms.

`comboFromEvent` resolves the key in this order, and every step exists because of a real platform failure:

1. `e.key` when it is a single ASCII letter or digit. The normal path.
2. Otherwise `e.code`, mapped through `CODE_KEYS`. **This is what makes `Alt` bindings work on macOS**, where `Option+W` reports `e.key` as `∑`, and it fixes non-US layouts at the same time.
3. `Dead`, `Unidentified`, `Process` and `Compose` are *not* treated as modifiers. macOS reports `Option+I` as `Dead` because it is the circumflex dead key, so bailing on it would silently kill any binding using those keys. They fall through to the `e.code` lookup and only fail if that yields nothing.

`shift` is recorded only for named keys, letters and digits, because a single punctuation character already encodes it: `Shift+/` is stored as `?`, not `shift+/`. Do not "simplify" this to always recording shift; `?` would stop matching.

`typing` and `overlay` are properties of the *action*, not of the bound combo, so rebinding can never widen where a shortcut fires. That is why a rebound `msgCopy` still refuses to run while the composer has focus.

Overrides live on `user.prefs.keybinds` as a sparse `{ actionId: combo }` map holding only what differs from the default. `resolveKeybinds` merges and validates on read, so an unparseable or stale entry silently falls back rather than disabling a shortcut, and `fixed` actions ignore stored values entirely. Users edit them in **Settings > Keybinds** (`KeybindsPanel.jsx`), which records a live keypress with a capture-phase listener; capture plus `stopPropagation` is what stops the app's own handler from firing the shortcut being recorded. `keybindConflicts` flags duplicates in the UI, and if a duplicate is saved anyway, `keybindIndex` gives it to the action listed first in `KEYBIND_ACTIONS`.

`App.jsx` keeps the listener itself tiny: it resolves the combo, checks the gates, then calls `kbHandlers.current[act.id]`. That handler map is rebuilt every render, so handlers close over current state with no stale-closure risk and the listener never needs re-binding. A handler returning `false` means "not applicable right now" and suppresses the `preventDefault`, so an inert shortcut falls through to the browser instead of being swallowed.

`KEYBIND_PRESETS` holds named override sets (`default`, `vim`); `activePresetId` reports which one is in effect by comparing the stored overrides, and returns `''` for a custom mix. `exportKeybinds`/`importKeybinds` round-trip the override map through JSON, and both run everything through `sanitizeKeybinds`, so an untrusted file can never install a malformed binding.

The focus ring is applied by toggling `.kb-focus` on the `[data-mid]` element from an effect rather than by passing a prop, so moving focus re-renders nothing. Shortcuts that are not rebindable (composer `Enter`, version cycling, and so on) stay in `ShortcutsModal`'s `STATIC_GROUPS`; `GROUP_ORDER` there controls the column order of the merged list.

## Maths and code rendering

Both KaTeX and highlight.js are **lazy and local**. Nothing is fetched from a CDN; both are npm dependencies bundled into their own chunks, and KaTeX's fonts are emitted as assets by Vite. Together they were about 60% of the old startup payload.

The loading pattern is the same for both and is worth copying for anything else heavy:

- A module-level singleton holds the loaded library, a `version` counter and a `Set` of subscribers.
- Consumers call `useSyncExternalStore(subscribe, version)` and put that version in their `useMemo` deps, so the render upgrades itself the moment the library lands. No prop drilling, no loading spinner.
- `main.jsx` kicks both off on `requestIdleCallback`, so in practice they are ready before the first code block or formula appears and the upgrade is never visible.
- Failures resolve to `null` and reset the in-flight promise, so a transient failure retries rather than wedging.

highlight.js loads in **three** stages, because the full build is roughly seven times the common one (250 KB gzipped against 52 KB): `highlight.js/lib/common` covers the usual languages; the `EXTRA` map in `hljs.js` holds ~40 individually importable languages, each landing as its own 0.3-2.5 KB chunk via `registerLanguage`; and the full build is fetched only for something outside both. Every entry in `EXTRA` must be a real file under `highlight.js/lib/languages/` or the build fails to resolve it, which is how `purescript` was caught. Requested-but-unknown languages are remembered in `wanted`, so a language asked for before the common set arrives still triggers the upgrade afterwards.

Note that KaTeX is genuinely ~166 KB gzipped and does not tree-shake; `lib/katexbundle.js` exists to pull katex, mhchem and rehype-katex into **one** chunk rather than three, which saves round trips, not bytes. Do not split it back apart expecting a size win.

## Locales are per-language chunks

`i18n.jsx` eagerly imports only each pack's `_meta` (via `import.meta.glob(..., { import: '_meta' })`) so the language menu can be built without loading any translations, plus `en.json` in full because it is 65 bytes and contains no translations anyway, which lets `loadLang('en')` resolve without a request. Everything else is fetched on demand by `loadLang`, and `main.jsx` awaits it before the first render so a non-English user never sees a flash of English.

Two build-config pieces keep this honest, both in `vite.config.js`, and removing either silently undoes the whole optimization:

1. `rolldownOptions.output.manualChunks` names locale chunks `locale-<code>`. Without an explicit name they are emitted as `es-<hash>.js`, which is indistinguishable from an ordinary chunk.
2. `modulePreload.resolveDependencies` filters anything containing `/locale-`. Vite preloads dynamic imports reachable from the entry, so **without this filter every language is downloaded by everyone** and the split buys nothing. This was verified against the built `index.html`, not assumed.

Adding a language is just dropping a JSON file in `src/locales/`; both rules match on path, so nothing else needs touching.

## CSS splitting

`admin.css` is imported by `AdminPanel.jsx` and `playground.css` by `Playground.jsx`, both lazy, so neither ships to ordinary users. `app.css` no longer imports `admin.css`.

The catch worth knowing: `SettingsModal` reuses `.me-sections` / `.me-sec`, which lived in `admin.css`. Those five rules were moved to `modals.css`. Before moving any more admin styling, check for the same kind of cross-use; a settings tab quietly losing its underline is exactly the sort of regression this creates.

For maths, `hasMath` gates everything: a block with no `$`, `\(`, `\[`, `\begin{` or `\ce{` never loads KaTeX and never runs the rehype plugin at all. `wrapMathEnvironments` wraps bare LaTeX environments (`align`, `equation`, `cases`, the matrix family, and so on) in `$$` so they render whether or not the model delimited them, and it is careful about two things: it skips fenced and inline code, and it tracks `$` depth so an environment already inside math is left alone. Macros are **copied per block** (`{ ...BASE_MACROS }`) rather than shared. A shared object would let a `\gdef` in one message silently redefine a command in another; the cost of the copy is far cheaper than that class of bug.

## Context window (`lib/ctxwindow.js`, `lib/llamacpp.js`)

Prompt size is **measured, never estimated**, for any llama.cpp-backed model. The rules that keep it that way:

- **Every llama.cpp endpoint must carry the model name.** Router mode (`llama-server` with no `--model`) proxies to per-model child processes and returns 400 without it. `/props`, `/tokenize`, `/apply-template` and `/slots` all go through `getWithModel`/`postWithModel`, which send it as both a query param and a body field, then retry bare for single-model servers. Dropping this is what silently disabled all exact counting before.
- **Context length comes from the server**, in order: `/props` → `default_generation_settings.n_ctx`, then `/v1/models` → `meta.n_ctx`, then `/slots`. Note this is the **per-slot** value: `-np 4 -c 131072` gives each slot 32768, and that is the real limit. A manual `num_ctx` on the model overrides all of it, so a stale value there beats the truth.
- **`/apply-template` is passed `tools` and `add_generation_prompt`.** Without them the tool schemas and the assistant suffix are not counted, which is a few hundred tokens of silent undercount on tool-enabled models.
- **The estimator never decides anything.** `estimateTokens` is a character heuristic and is English-biased; it is used only to pick the first probe point in the slide search and as a fallback for providers with no tokenizer. Every candidate the slider returns has been verified by the real tokenizer.
- **An oversized request is free.** llama.cpp rejects it before prefill (`n_tokens = 0`) and reports `n_prompt_tokens` and `n_ctx` in the error. `parseOverflow` reads them, so the recovery path corrects itself against ground truth instead of guessing again. Do not remove that parser; it is the backstop that makes the guarantee hold when images or a template quirk throw the pre-flight off.
- **Images are the one thing the tokenizer cannot see.** `/tokenize` is text-only, so each image carries a reserve (1600 by default, deliberately above the 1024 Qwen-VL floor) that is corrected upward from real `usage.prompt_tokens` and never lowered.

`slideToFit` keeps the system prompt and the newest user message, drops the oldest turns first via a verified binary search (typically two to four tokenizer calls, one when it already fits), and only trims message bodies when dropping is not enough, cutting the middle and keeping both ends. Trimming the system prompt happens only when it alone exceeds the budget, because refusing to answer is worse. The budget is `ctx - output reserve - 1%`, and the generation cap is clamped to the leftover room so a reply cannot overflow mid-stream.

## Render smoke test (`npm run smoke`)

`client/scripts/smoke.jsx` server-renders every admin `ModelEditor` section plus the standalone modals and asserts none of them throw. It exists because `vite build` type-checks nothing: passing wrong props to a component compiles perfectly and then blanks the whole panel at runtime. That is exactly how the Routing tab shipped broken once — `Toggle` takes `{ m, set, k }` and reads `m[k]` internally, while `Switch` is the one that takes `{ on, onToggle }`. Passing `on`/`onToggle` to `Toggle` left `m` undefined and killed the admin app.

Run it after touching any admin section or modal. Adding a component to the list is two lines and worth it for anything reachable behind a tab, since a crash there is invisible until someone clicks. Components needing React context (the `useAdmin` sections) are not covered; wrapping them in a provider is the obvious extension if that class of bug shows up.

## Router models (`lib/router.js`)

A model row with `kind: 'router'` has no backend of its own. `lib/ws/connection.js` resolves it *before* `applyKwargs`, so kwargs apply to the model that actually runs, not to the hub. `resolveRouted` returns `{ model, routed }`; `model` is `null` when routing fails, and the caller must surface `routed.error` and stop rather than falling back to a default, because silently answering with the wrong model is worse than refusing.

Rules are ordered and the first match wins. Matchers live in `ROUTE_MATCHERS`; adding one means a case in `ruleMatches` plus an entry in `MATCHERS` in `ModelEditor.jsx`. Two invariants worth keeping:

- **Cycle safety.** Routers may target other routers. `resolveRouted` walks with a `seen` set and refuses on revisit. Without it a two-router cycle is an infinite loop inside a request.
- **Regex is user input.** `new RegExp` is wrapped in try/catch and a broken pattern returns `false`, never throws. There is a test for this; an admin typing `([` must not break every turn.

Matching only ever looks at the *latest* user message. For `regenerate` there is no incoming content, so `connection.js` pulls the last user message from the chat, otherwise a regenerate would route on an empty string and always hit the fallback.

`shapePublic` exposes `kind` and `routerTargets` so the client can tell a hub from a model. Rules are sanitized on write in `routes/models.js` (unknown matcher becomes `keyword`, entries without a `modelId` are dropped, capped at 40).

## The prompt ledger

`GET /api/chats/:id/prompt` returns the assembled prompt broken into named sections plus the message list. It reuses `buildMessages`, so it cannot drift from what actually gets sent — do not reimplement the assembly here. The `sections` array is derived by re-deriving each contributing piece and reporting its own token count; `present` records whether the piece was actually found in the final system string, which catches the case where a source is configured but something upstream dropped it.

This is deliberately read-only. Editing and re-running the raw prompt belongs in the Playground, which already exists for that.

## Cherry-picking across branches

`POST /api/chats/:id/cherrypick` copies a message onto the current `active_leaf` as a new message with a `copied_from` pointer. It is a copy, not a move: the source branch is untouched. Two guards, both tested end to end: a message already on the active path is refused (it would create a duplicate), and an unknown or foreign message id 404s. The client refreshes via `refreshMessages` afterwards, since the append happens server-side.

## Chord shortcuts

A binding containing a space is a chord (`'space l'`), validated as exactly two valid combos. `keybindIndex` returns the usual flat map plus `index.chords`, a `Map` of head to a `Map` of tail to action. `App.jsx` holds a `pending` head with a `CHORD_TIMEOUT` timer and shows the hint overlay listing what is bound under that head. The head only arms when focus is not in an input and no overlay is mounted, so `space` remains a normal space everywhere it should be. Escape cancels.

## Everything is served from this origin

The app is fully self-hosted: no CDN, no Google Fonts, no analytics, no phone-home. Fonts live in `client/public/fonts/`, KaTeX's 59 font files are emitted into `assets/` by Vite, and every heavy library is an npm dependency bundled locally. The lazy loading described above changes *when* things load, never *where from* — every dynamic `import()` is a relative path Vite resolves into a local chunk.

Three mechanisms keep it that way, and they are deliberately different in kind:

0. **Outbound**: `server/lib/egress.js` wraps the global `fetch` at boot (`installEgressGuard()` in `index.js`, before the app is built). Every outbound call in the server goes through global `fetch`, so this one wrapper is a complete chokepoint: providers, MCP, web search, TTS/STT, model discovery. Setting `egress_local_only` defaults to `'1'`.


1. **Build-time**: `client/scripts/check-local.mjs` runs as part of `npm run build`. It parses `dist/` for anything that would *fetch* off-origin (`src`/`href` attributes, CSS `url()`, dynamic `import()`) and exits non-zero naming the file. It also prints external hosts that merely appear as strings, which is informational: React and highlight.js embed documentation URLs in error messages, and `w3.org` appears as XML namespaces. Those are in `ALLOWED_HOSTS`; extend that list only for strings that are genuinely never fetched.
2. **Runtime**: `server/lib/localonly.js` sends a Content-Security-Policy confining the browser to this origin. Build-time catches our own mistakes; CSP also covers anything injected at runtime, including admin-configured content.

The CSP is applied only to app HTML, never to `/api` (JSON needs no policy) or `/uploads` (which keeps its own stricter `script-src 'none'`). Details that matter if you edit it:

- `connect-src` is built per request as `'self'` plus the exact `ws://` or `wss://` origin from the `Host` header, because `'self'` does not reliably cover WebSocket in every browser. The scheme follows `x-forwarded-proto` so it is correct behind a reverse proxy. The host is rejected if it contains anything outside `[a-zA-Z0-9.:_-]`, so a spoofed `Host` cannot inject directives.
- `'unsafe-inline'` is required in `script-src` for the pre-paint theme script in `index.html`, and in `style-src` for React's inline `style` attributes. This does not weaken *locality*: inline code still cannot load remote resources.
- `'wasm-unsafe-eval'` is needed by the WASM tokenizer, and `blob:` in `worker-src`/`child-src`/`img-src` by artifact previews, file attachments and the keybind export.

### The egress guard

Policy: loopback and private ranges are allowed, public addresses are not. `isPrivateAddress` covers IPv4 (`0/8`, `10/8`, `127/8`, `169.254/16`, `172.16-31`, `192.168/16`, CGNAT `100.64/10`, multicast) and IPv6 (`::1`, `fc00::/7`, `fe80::/10`, multicast, and IPv4-mapped `::ffff:` which is unwrapped and re-checked). The boundary cases are covered by tests: `172.15`/`172.32` are public while `172.16`-`172.31` are private, and `100.128` is public while `100.64` is not.

A hostname is resolved with `dns.lookup(all: true)` and allowed only if **every** returned address is private, so a name with one private and one public record is refused. Note the honest limitation: this is resolve-then-connect, so a DNS rebinding attack could in principle return a private address to the check and a public one to the connection. Closing that needs a custom connect-time `lookup`, which Node does not expose without adding `undici` as a dependency. The guard is built to stop accidental egress and misconfiguration, not a hostile admin who already controls the server.

**Web search is exempt, and this is deliberate.** A local SearXNG is reachable under the normal rule because it resolves to a private address, but that is only half of what web search does: `ingestPage` then fetches each *result page*, which is on the public internet regardless of where the engine runs. Without an exemption, search would appear to work while silently returning snippet-only results, because `ingestPage` swallows fetch errors and returns empty text. So `websearch.js` routes its requests through `unguardedFetch` (the original `fetch`, captured by `installEgressGuard` before wrapping) when `egress_allow_websearch` is `'1'`, the default. The exemption is scoped to that one module by construction: it is reached by importing a specific symbol, not by a flag that widens the global guard, so no other call site can pick it up. Turn the setting off and `websearch.js` falls back to the guarded `fetch` like everything else.

`egress_allowlist` is the opt-in escape hatch. Matching is exact or `*.suffix`, and `*.anthropic.com` deliberately matches `anthropic.com` itself. It is **not** a substring match, because `anthropic.com.evil.com` must not pass; there is a test for exactly that. Entries are sanitized on write (scheme and path stripped, charset restricted, deduped, capped at 100).

The setting is `local_only`, default `'1'`. It is a toggle rather than hardcoded because two legitimate features cross origins: an admin can point the app icon or background at a remote image URL, and artifact previews are `srcdoc` iframes that inherit the parent CSP, so an artifact loading a CDN library breaks under it. Both are documented in the admin UI. Do not silently widen the policy to accommodate these — that would remove the guarantee for everyone who does not need it.

## Authentication and the sign-in screen

Three endpoints, and the split between the first two is the important part:

- `POST /api/auth/login` — **signs in only**. It used to create an account when the email was unknown, which meant a typo silently registered a second account. It now returns "Incorrect email or password" without saying which was wrong, so it is not an account-existence oracle.
- `POST /api/auth/register` — **creates only**. Returns 409 on a duplicate, requires 8+ characters, and honours the `allow_signups` setting. The first account ever created is always allowed through regardless of that setting and becomes owner+admin, which is the bootstrap path.
- `GET /api/auth/context` — the one **public** endpoint (no `authMiddleware`). Returns `firstRun`, `allowSignups`, `appName`, `appIcon`, `appFont` and `uiPreset`.

`/api/auth/context` exists because `/api/app-config` is auth-gated, so before signing in the client knew nothing about the server. That is why the login screen used to render in the wrong preset on a first visit: the pre-paint boot script in `index.html` reads `localStorage 'oq-preset'`, which is empty on a new device, so it fell back to Anthropic. `App.jsx` now fetches the context on the `/api/me` failure path and applies preset, font and icon before rendering `Login`. Keep this endpoint free of anything an anonymous caller should not see — it is deliberately limited to branding and the two booleans the screen needs.

`POST /api/auth/check-email` was removed. Nothing used it after the flow split, and it answered "does this account exist" to anonymous callers.

**The login screen must use theme variables.** It was originally written with literal hex values from the light Anthropic palette (`#f0efe7`, `#faf9f5`, `#d6d4c8`), so it rendered cream in dark mode and under the OpenAI preset no matter what. Every rule in `.login` now goes through `--bg`, `--text`, `--surface`, `--border`, `--input-bg`, `--card-bg` and `--accent`; preset-specific styling lives in `openai.css` under `[data-preset="openai"]`, per the preset architecture above. When logged out, `applyPrefs(null, preset)` resolves the theme from the OS preference since there are no user prefs yet.

## Popover placement (model dropdown)

`ModelDropdown` measures rather than guesses, and the rules below exist because the old "pick a side, then clamp it" logic produced a scrollbar on a menu that had 800px of free space above it:

- Natural height is measured with the clamp temporarily lifted (`fullHeight`). Measuring an element that is already `max-height`-ed makes the result depend on its own output, which oscillates.
- Clamping is decided against the **viewport budget** (`innerHeight - 20`), never against the space on one side. If the menu does not fit below or above, it is *shifted* to sit inside the viewport at its full height; a scrollbar only appears when the content genuinely exceeds the screen.
- Anything that scrolls uses `overflow: hidden auto`, never `overflow-y: auto`. Per spec a `visible` axis paired with a non-`visible` one computes to `auto`, so `overflow-y: auto` alone silently creates a **horizontal** scroll container too. That is what used to hide the "More models" submenu behind a sideways scrollbar.
- The submenu renders through a portal on `document.body` with viewport-fixed coordinates, so no scrolling ancestor can ever clip it. Two consequences: the outside-click handler must also ignore `.model-submenu` (or clicking a model in it would unmount the menu before the click landed), and any descendant-scoped styling for it needs a `body:has(...)` counterpart — see `.model-submenu.pinned` in `chat.css` and `extras.css`.
- Below 768px the menu is a CSS bottom sheet driven by `!important` rules; the component detects that with `matchMedia` and writes no inline geometry at all.

## Composer drafts

Unsent composer text is kept in `localStorage` under `oq-draft-<chatId|new>`, debounced 200ms and flushed on `pagehide`, on `visibilitychange` to hidden, on unmount, and before any chat switch. Do not add a `beforeunload` listener for this; it costs back/forward-cache eligibility and the two events above already cover reloads. Restoration is explicit at every entry point — `openChat`, `newChat`, `openFromUrl`'s non-chat branch (this is the one that made a reload of `/` lose the draft), and on leaving incognito. Incognito never writes: `saveDraft` bails on `incognitoRef`, which `toggleIncognito` sets eagerly rather than waiting for the state effect, so the first keystroke after the toggle cannot leak into the home draft.

## Layout invariants worth knowing before editing

- The OpenAI composer is a 52px pill: constant side padding (48px left / 96px right) in **both** single-line and `.ml` states; `.ml` only adds `padding-bottom: 52px`. Keeping the horizontal padding identical between states is what prevents wrap-point feedback loops (typing jitter). Don't reintroduce state-dependent horizontal padding.
- `.composer-bar` is absolutely pinned inside the pill (`z-index: 6`); the composer itself is `z-index: 3`, plus-menu `80 !important`, quick prompts `1`, floating chat wrapper `30`.
- The chat composer floats (`.composer-wrap.floating`) over the scroll area with a to-top gradient; `thread-pad` reserves 130px so content never hides beneath it.
- Widths: thread and composer wrapper are 808px containers with 20px side padding → 768px content, matching measured chatgpt.com.
- Measured palette (from screenshots at 1×): dark `#000` app/sidebar, `#212121` composer, `#2b2b2b` bubble, `#303030` menus, `#424242` menu hover, `#1a1a1a` active rows; light `#fcfcfc` app/sidebar, `#fff` composer with `#0000001f` border, `#e9e9e9` bubble, `#e2e2e2` active rows, black accent.
- Markdown math accepts `$…$`, `$$…$$`, and normalizes `\(…\)` / `\[…\]` (outside code) in `Markdown.jsx:normalizeMathDelims`; streaming holds unclosed math via `autoCloseMath`.
- The thread rail is `position: absolute` inside `.main` (which is `position: relative`), as a sibling of `.scroll-area`, same as `.to-bottom`.
- `client/index.html` carries the PWA metadata: `manifest.webmanifest`, the `starburst.svg` favicon, `icon-{180,192,512}.png` plus a maskable 512, and paired `theme-color` meta tags. The pre-paint boot script also writes a media-less `theme-color` so the installed shell matches the resolved theme rather than the OS preference.

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
- `tree.js` — message branching tree: `activePath`, `ensureChain`, `childrenOf`, `leafUnder`, `sortedMsgs`. All of these share one per-chat graph (`graphOf`) cached against `db.messages.version()`, so a chat's messages are loaded and parsed once per mutation rather than once per call. Do not go back to loading messages directly in these helpers. `leafUnder` descends via `preferredChild(kids, onPath)`, which follows the **currently active branch** when a node has several children and only falls back to the newest sibling when none of them is on the active path. Without that preference, selecting any ancestor silently moved the conversation onto whichever sibling happened to be created last, which is why the branch map must never be wired straight to a plain last-child walk.
- `llamacpp.js` — llama-server integration: `/props` and `/slots` for exact `n_ctx`, `/apply-template` plus `/tokenize` for exact prompt token counts (`llamaTokenCount`), and `isContextOverflowError` for recovering from context overflow. Results are cached; llama.cpp is the default provider type.
- `uploads.js` — `UPLOADS` dir, multer `diskStore`, attachment readers (`readUploadText`, `readImageDataUri`, `isTextLike`), `purgeUploads`.
- `ws/` — the websocket engine, re-exported from `ws/index.js`: `broadcast.js` (the `clients` map, `broadcastConfig`, `broadcastAdminConfig`, `broadcastToUser`, `killSessionSockets`, `requestedKwargs`), `live.js` (the in-flight turn registry), `turn.js` (`runCompletion`, the agentic tool-call loop, plus `maybeCompact`), `connection.js` (`initWs(server)` and the `chat`/`regenerate`/`edit`/`incognito`/`stop` handlers). `runCompletion` is module-scope and takes `(ws, state, safeSend, chat, model, ...)` rather than closing over the socket. **`lib/ws/` must never import from `routes/`** — dependency direction is routes → lib.

### Turns outlive sockets (`lib/ws/live.js`)

A generation belongs to the *chat*, not to the socket that started it. `live.js` keeps one record per in-flight chat turn (accumulated content, reasoning, phase, tool preview, steer notes, prefill status) plus the global `aborts`/`steers` maps keyed by chat id, and `sendLive` fans every event out to **all** of that user's sockets while folding it into the record. Consequences to preserve when editing this area:

1. `connection.js` passes `liveWs`/`liveState`/`liveSend` into `runCompletion` instead of the raw socket, so a reload, a dropped connection, or a second tab never truncates a reply.
2. Socket close aborts **only** incognito turns (they are per-socket by definition and are never persisted). Saved chats keep generating and land in the DB as normal.
3. Every new socket is handed `{ type: 'resume', turns: [...] }` before anything else. `App.jsx` seeds its `gen` map from that and calls `syncView()`, which is what makes a mid-stream refresh pick the response back up rather than waiting for `done`.
4. Because `aborts` is keyed by chat rather than by socket, Stop and steering work from a freshly loaded page — both paths ownership-check the chat against the session user first.
5. One turn per chat: a second `chat`/`regenerate`/`edit` for a chat that already has a live turn is rejected. `beginTurn` is paired with `endTurn` in a `finally`, and records older than 45 minutes are treated as stale, so a crashed turn can never wedge a chat permanently.

### HTTP routes (`server/routes/`)

Each exports `default function register(app)` and is wired in `index.js`.

- `auth.js` — login/logout, `/api/me` (profile, styles, memory, personas, saved prompts, usage, sessions, budget, password, 2FA, delete-account), message feedback, improve-prompt, style generation, user search.
- `chats/` — split by concern and wired together by `chats/index.js`: `browse.js` (list, overview, search), `folders.js`, `crud.js` (create, delete, pins), `messages.js` (chat fetch, branching, `GET /api/chats/:id/tree`), `inspect.js` (context, summary), `transfer.js` (export/import). The tree endpoint is read-only and returns node shape plus short previews, never full bodies; it reuses the cached graph via `sortedMsgs`/`activePath` rather than loading messages itself.
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
- `src/lib/focus.js`: `useFocusTrap(ref, onClose, opts)` (Tab cycling, Escape, focus restore on unmount), `useRovingFocus` for menus, and `focusablesIn`/`focusFirstIn`. Focusables are re-queried on every keypress so traps keep working as contents change. Applied to `CommandPalette`, `ShortcutsModal`, `SearchModal`, `BranchTree`; use it for any new modal.
- `src/lib/keybinds.js`: the keybind model (`KEYBIND_ACTIONS`, `comboFromEvent`, `resolveKeybinds`, `keybindIndex`, `comboKeys`, `keybindConflicts`, presets, import/export). See "Keyboard model" above.
- `src/lib/mathjs.js`: everything KaTeX. `hasMath` (cheap pre-check), `wrapMathEnvironments`, `BASE_MACROS`, `KATEX_OPTIONS`, and the lazy loader (`ensureKatex`, `katexPlugin`, `subscribeKatex`, `katexVersion`). See "Maths and code rendering" below.
- `src/lib/hljs.js`: the syntax-highlighting facade and its two-stage lazy loader (`ensureCommon`, `ensureFull`, `ensureLanguage`, `highlight`, `rawHighlight`, `subscribeHljs`, `hljsVersion`).
- `src/lib/threadmeta.js`: `railItems` (rail model derived from the message list), `previewOf`, `hasToolCall`, plus `buildTree`/`collapseRuns` shared by the branch map.
- `src/styles/` — `app.css` imports everything; `openai.css` is the OpenAI preset (always last). Others: `base`, `layout`, `chrome`, `chat`, `composer` styles live across `polish`, `extras`, `modals`, `admin`, `artifacts`, `fonts`, `threadnav`.
- `src/styles/threadnav.css`: thread rail, find bar, branch map, `.skip-link`, `.sr-only`, the `.kb-focus` ring, and the thread occlusion rules. Imported second-to-last, immediately before `openai.css`.

### Components (`src/components/`)

- `AdminPanel.jsx` — admin shell: tab navigation, models list/publish flow, branding, members, settings tabs. Tab ids: `overview, models, providers, branding, home, members, websearch, membank, voice, safety, memory, skills, mcp, feedback, limits, audit, analytics`.
- `admin/widgets.jsx` — shared admin primitives: `Card`, `Toggle`, `IconSlot`, `IconCropModal`, `SystemPromptEditor`, `QpIconPicker`, `AutosaveNote`, `CopyBtn`, `StatusChips`, `Grip`, `bgPreviewStyle`.
- `admin/ModelEditor.jsx` — the per-model editor (sections: General, Intelligence, Abilities, Style, Tuning; `ME_SECTIONS`).
- `Composer.jsx` — the input: attachments, dictation, slash commands, style menu, sandbox/web-search toggles, saved prompts.
- `Message.jsx`, `Markdown.jsx`, `CodeBlock.jsx`, `ReasoningBlock.jsx`, `StreamingText.jsx`, `ToolCard.jsx` — message rendering pipeline.
- `Sidebar.jsx`, `ChatMenu.jsx`, `ChatsOverview.jsx`, `SearchModal.jsx`, `BranchCompare.jsx` — navigation and history.
- `ThreadRail.jsx`: the conversation minimap pinned to the right edge of `.main`. One `IntersectionObserver` rooted on `.scroll-area` tracks which turns are on screen (there is deliberately no pixel measurement, so it survives streaming and reflow); one `ResizeObserver` compresses the tick gap to fit. Hidden below 4 messages and under 900px.
- `ThreadFind.jsx`: in-thread find. Flattens thread text nodes into a single string plus an offset index, so matches spanning inline elements are found, then paints via the CSS Custom Highlight API (`CSS.highlights`, styled by `::highlight(oq-find)` / `::highlight(oq-find-active)` in `threadnav.css`). Where the API is missing it still navigates by message. Recomputes on a `revision` prop rather than watching the DOM.
- `BranchTree.jsx`: the branch map modal (lazy-loaded, own chunk). Renders the whole message graph: linear runs collapse into a single column and fold above 6 nodes, fork points split into parallel branch columns, the active path is highlighted. Clicking a node already on the active path jumps to it in the thread (`onJump`); clicking anything else switches branches via `selectBranch`. Keep that split: making every click switch branches means clicking a shared ancestor mutates the conversation the user was only trying to look at.
- `ArtifactsPanel.jsx` — sandbox file browser/preview. `ProjectsPanel.jsx`, `SpacesPanel.jsx` — projects and spaces UIs.
- `KeybindsPanel.jsx` — the **Settings > Keybinds** tab. Pure view over `lib/keybinds.js`; it writes only the `keybinds` pref.
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

It covers the pure logic that is easy to break silently: kwarg resolution and pairing chains, text tool-call parsing (including the negative cases where prose or an unknown tool name must NOT become a call), compaction thresholds and in-turn tool trimming, llama.cpp overflow detection, the Windows command translation in `sandbox.js`, and `preferredChild` from `lib/tree.js` (branch descent preference). Add cases here when touching any of those; they are cheap and they have already caught a real regression.

CI syntax-checks every `.js` file under `server/` via `find`, so new files and folders are covered automatically. Do not replace that with a hand-written file list.
