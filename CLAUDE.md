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
- Cursor: under preset `openai` the streaming cursor **defaults** to circle+on, under `anthropic` to block+off. These are defaults only — a user who has set `streamCursor`/`cursorStyle` keeps their choice in both presets, and the default is computed at apply time rather than written into their prefs.

**No preset may make a user pref inert.** `applyPrefs` writes every pref to a `data-*` attribute on `<html>` regardless of preset, and `openai.css` must not override those attribute-driven rules. A preset may change a pref's *default* (as the cursor does) but never its effect — a settings toggle that visibly does nothing in one skin is a bug, not a style choice.

### Motion and the typewriter reveal are two separate prefs

They used to be one key, and conflating them caused a genuinely expensive bug: `animations` defaulted off under `openai`, which silently disabled every CSS transition in that skin. The reasoning open/close animation was written, shipped, and appeared completely dead for exactly that reason, with nothing wrong in the CSS. They are now split:

| Pref | Drives | Default |
| --- | --- | --- |
| `animations` | `data-animations` on `<html>`, which every CSS transition and keyframe opt-out keys off | on in both presets |
| `typewriter` | the reveal loop (`animate` in `App.jsx`) | on under `anthropic`, **forced off under `openai`** |

`animate` is hard-coded false for `openai`, so `App.jsx` writes each chunk straight to state as it arrives and `finalize()` runs the moment `done` lands — tokens render exactly as the server sends them, matching chatgpt.com. That is the one place a preset overrides a pref rather than its default, so `SettingsModal` hides the "Typewriter reveal" toggle and the "Reveal speed" slider entirely under `openai` rather than leaving controls that visibly do nothing.

Reading `typewriter` always goes through `(prefs.typewriter ?? prefs.animations) !== false`, and `SettingsModal` seeds `typewriter` from a pre-split `animations` value on first open. Without that, anyone who had turned animations off would have the reveal switch itself back on the next time they touched any setting.

When something animates in one preset and not the other, **check `document.documentElement.dataset.animations` before touching a single CSS rule.**

## The complete JS branch list (`cfg.uiPreset === 'openai'` or data-preset reads)

- `App.jsx` — chat topbar ModelDropdown; home-screen `.home-topbar` ModelDropdown; `hideModelPicker` for the composer, and `CtxGauge` moves into the topbar `modelPicker` block with it (the gauge belongs beside the picker, and the OpenAI composer pill reserves only 96px on the right for the mic and send button, so anything left there is squeezed out of sight); persistent per-message assistant icons (`showIcon`); floating chat composer wrapper class + 808px max width; incognito hero renders "Temporary Chat" + note; `animate` is forced false so the reveal loop never runs and tokens render as they stream, with `SettingsModal` adapting the Animations control to match (see "`animations` gates two different things"); `QuickPrompts` keeps layout space when hidden (`qp-ghost`).
- `App.jsx` → `Message` → `ReasoningBlock` — a `preset` prop, because the two skins show reasoning differently (see "The reasoning block").
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

## The reasoning block

The two skins deliberately show reasoning in different shapes, so `ReasoningBlock` takes a `preset` prop (threaded `App.jsx` → `Message` → block) and sets a `.rolling` class for everything that is not `openai`. It never toggles itself; the user is always in control of `open`.

**OpenAI** — a bulb, a fixed label, and a live tail card:

| State | Looks like |
| --- | --- |
| thinking, closed (`.carded`) | a bordered card holding the bulb, "Thinking…", the chevron, and a live tail of the reasoning |
| thinking, open (`.carded`) | the same card, grown to hold the full thought timeline of hollow dots |
| finished | flat header, "Thought for 57 seconds", expanding to the timeline |

`openai.css` owns its open/close animation: the panel eases on `grid-template-rows` and the steps rise in on a short `nth-child` stagger, capped at the fifth so a hundred-step thought does not queue a two-second cascade.

Toggling dispatches **`oq-release-scroll`**, which `App.jsx` turns into `stick.current = false`. This is what keeps the header under the cursor when it is clicked mid-stream: during streaming the autoscroll pins the thread to the bottom, so a block growing by several hundred pixels drags the whole conversation up — the block was never moving, the scroll was. Releasing the pin is also the correct reading of intent, since someone who opens the reasoning wants to read it rather than keep chasing the tail.

**`.carded` is keyed on `live` alone, never on `open`.** The card is the block itself, holding the header in both the closed and open thinking states, and expanding simply grows it. That is what keeps the header still: it never crosses the card boundary, so its padding context never changes. Two earlier arrangements failed and are worth not repeating — a card present only when closed jumps the header ~17px sideways on every toggle, and cancelling that with negative margins on the card pushes it up and left of the content column, straight into the assistant name in the icon-left layout. The card must stay flush with the column (`margin: 2px 0 10px`).

The fade at the top of the live text is a `mask-image` on `.rb-peek-in`, the inner text element, and must not move up onto the card — a mask on the card fades its own top border out along with the text.

**Anthropic** — no card and no fixed label. The header is a rolling one-line summary: `lastSentence` pulls the most recent *complete* sentence out of the raw reasoning, so while the model writes sentence N+1 the header shows sentence N, and each new one cross-fades over the last (`.rb-line` in, `.rb-line.out` absolutely positioned over it, cleared by a 420ms timer). Before the first sentence closes it falls back to the shimmering "Thinking…", and the last sentence stays as the collapsed header once thinking ends. Expanding shows the same timeline with clock nodes and a terminal "Done" row.

The line is **throttled to one change per `LINE_HOLD_MS` (3s)**, and this is the point of the feature rather than a detail: a fast local model closes a sentence every few hundred milliseconds, which flickers unreadably. `nextLine` always holds the newest sentence and the timer promotes whatever is newest when it fires, so what you get is a glimpse of where the model *is* every three seconds, not a queue of every sentence it wrote. `lineAt` is seeded on the first sentence rather than left at `0` — left at `0`, `Date.now() - 0` is a twelve-digit number, `wait` is hugely negative, and the first line fires instantly instead of holding. `live` going false bypasses the throttle so the block always settles on the final sentence.

`lastSentence` must not use a regex lookbehind. It is a *parse-time* error on Safari below 16.4, which would take down the entire bundle rather than just this component; the lookahead form (`[^.!?]+[.!?]+(?=\s|$)`) is equivalent here and safe everywhere. It also has to tolerate decimals — `0.5` must not read as a sentence end — which the lookahead gives for free.

The timeline is what `parseSteps` builds: the text is split on blank lines into **steps**, each getting a node dot and a connecting rail, and single newlines inside a step become plain paragraphs under the same node. So a model that separates every thought with `\n\n` gets one node per thought, and one that uses single newlines gets grouped paragraphs — both read correctly without any model-specific handling.

Details that are load-bearing:

- **The duration is measured on the server, not the client.** `turn.js` accumulates `reasonMs` across every thinking phase of the turn (`closeReasoning()` is called when content starts and again after the loop, so a turn that ends mid-thought is still counted), stores it as `reasoning_ms`, and `routes/chats/messages.js` exposes it as `reasoningMs`. A client-side timer would be wrong after a reload and would disagree between two tabs watching the same turn. With no duration the label falls back to "Thought process", which is what every message written before this field existed shows.
- **The live tail is `.rb-peek`, capped at 190px with a top mask** — it is deliberately *not* the same element as the expanded body. The block sits outside `.assistant-body`, so it is never occluded by `.thread.virt`, and an uncapped live view would push the streaming reply down the page while the `stick`/`scrollHeight` autoscroll chases it.
- **The follow-scroll is coalesced through one `requestAnimationFrame`.** Reading `scrollHeight` on every reasoning token forces a synchronous reflow per token; the rAF collapses a burst into a single write after layout, and the cleanup cancels a pending frame so only the newest survives.

### Opening and closing

The expand/collapse is the grid-rows trick in `polish.css`, which needs a single child to size against — that is what `.rb-inner` is for. Adding a second child directly under `.reasoning-collapse` creates an implicit second row and silently breaks the animation.

The motion is **asymmetric on purpose**: opening runs 440ms on a long ease-out (`cubic-bezier(.16,1,.3,1)`) while closing runs 280ms on a standard ease-in-out, because a slow collapse feels unresponsive where a slow reveal feels considered. Both timings live in the base sheet and apply to both presets; `openai.css` must not override `.reasoning-collapse`'s transition, since the open and closed rules tie on specificity and the preset sheet loads last, which would silently drop the open-state timing.

Three pieces move together, and all three are needed for the card to morph rather than jump:

1. `.reasoning-collapse` animates its row from `0fr` to `1fr`.
2. `.rb-steps` slides from `translateY(-10px)`, so the timeline arrives with the panel instead of appearing fully formed inside it.
3. `.rb-peek` runs the **same grid collapse in reverse** (`.shown` when closed). Without this the live tail unmounts instantly on click, the card snaps ~170px shorter, and only then grows — the single ugliest frame in the whole interaction.

Each preset then adds its own reveal over the same skeleton: the step rises in, its node scales up, and its rail segment draws down with a `scaleY`. Anthropic animates `.rb-node` (the clock SVG), OpenAI animates `.rb-step::before` (the hollow dot); both animate `.rb-step::after` for the rail.

The stagger is one **`--rb-d` custom property set on `.rb-step` in the base sheet**, not a per-preset pile of `nth-child` + `animation-delay` rules. Pseudo-elements inherit custom properties from their originating element, so `::before` and `::after` pick up the same delay as the step without repeating a single selector — which is the only reason adding node and rail animations to both presets did not triple the rule count. It is capped at the fifth child so a hundred-step thought does not queue a multi-second cascade.

**Watch specificity when opting these out of `[data-animations="off"]`.** The animation selectors are deep (`.reasoning.rolling .reasoning-collapse.open .rb-node` is four classes), so a naive `[data-animations="off"] .reasoning .rb-node` loses and the pref silently does nothing. The opt-outs must repeat the full selector, and preset-specific ones must carry both attributes (`[data-preset="openai"][data-animations="off"]`) to beat the preset sheet's later position.

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

Shipping languages are `es`, `zh`, `fr` and `pt`, each complete at 1641 keys, plus `en` which is 65 bytes of `_meta`. Adding a language is just dropping a JSON file in `src/locales/`; both rules match on path, so nothing else needs touching. `_meta` carries `code`, `name` and `dir`; **the `code` must be the two-letter prefix** `detect()` compares against `navigator.language.slice(0, 2)`, which is why Brazilian Portuguese ships as `pt` rather than `pt-BR`. Keys are sorted with `localeCompare` in every pack so diffs across languages line up. **There is no RTL support** — no `[dir="rtl"]` rules exist and the stylesheets use physical `left`/`right` properties throughout, so a `dir: 'rtl'` pack would flip the text and leave the layout wrong. Converting to logical properties is a prerequisite for Arabic, Hebrew, Farsi or Urdu.

### `t()` translates, `tk()` marks

`client/scripts/i18n-check.mjs` finds keys by scanning for `t('…')` and `tk('…')` literals. That means a string only reaches the dictionary if the literal is *visible to the scanner* — and a great many strings live in module-level tables (`NAV_GROUPS`, `ME_SECTIONS`, `FIELD_INDEX`, `MATCHERS`, `VERBS`, `CAP_ICONS`, `STYLE_PRESETS`, the sampling grid) where calling `t()` at definition time would freeze English in before any language pack has loaded.

`tk` is the answer: an identity function exported from `i18n.jsx` that does nothing at runtime and exists purely so the extractor can see the literal. **Mark at definition with `tk()`, translate at render with `t()`.** Both are required — `tk` alone renders English, `t` alone leaves the key out of every dictionary.

This replaced a hand-maintained list of special cases in the extractor (a regex for `nav.jsx`, another for `keybinds.js` and `ShortcutsModal.jsx`, plus a ~100-entry hardcoded `extra` array). The `keybinds`/`ShortcutsModal` regexes remain because those files' shapes are load-bearing elsewhere; the `nav.jsx` one was deleted once `tk()` covered it, verified by the key count not moving. Prefer `tk()` over adding another special case.

Two failure modes this design does not catch, both of which were real bugs found while wiring it up: a table whose labels are `tk()`-marked but rendered bare (English for everyone, extractor happy), and the same table translated in one render site and not another. `ModelDropdown`'s capability labels had exactly the second problem.

**Run `node scripts/i18n-check.mjs` from `client/` after touching any user-facing string.** It exits non-zero on missing keys and lists orphans. It is not part of `npm run build`, so nothing forces it — but every locale is expected to report `complete`.

## CSS splitting

`admin.css` is imported by `AdminPanel.jsx` and `playground.css` by `Playground.jsx`, both lazy, so neither ships to ordinary users. `app.css` no longer imports `admin.css`.

The catch worth knowing: `SettingsModal` reuses `.me-sections` / `.me-sec`, which lived in `admin.css`. Those five rules were moved to `modals.css`. Before moving any more admin styling, check for the same kind of cross-use; a settings tab quietly losing its underline is exactly the sort of regression this creates.

For maths, `hasMath` gates everything: a block with no `$`, `\(`, `\[`, `\begin{` or `\ce{` never loads KaTeX and never runs the rehype plugin at all. `wrapMathEnvironments` wraps bare LaTeX environments (`align`, `equation`, `cases`, the matrix family, and so on) in `$$` so they render whether or not the model delimited them, and it is careful about two things: it skips fenced and inline code, and it tracks `$` depth so an environment already inside math is left alone. Macros are **copied per block** (`{ ...BASE_MACROS }`) rather than shared. A shared object would let a `\gdef` in one message silently redefine a command in another; the cost of the copy is far cheaper than that class of bug.

## Context window (`lib/ctxwindow.js`, `lib/llamacpp.js`)

Prompt size is **measured, never estimated**, for any llama.cpp-backed model. The rules that keep it that way:

- **Every llama.cpp endpoint must carry the model name.** Router mode (`llama-server` with no `--model`) proxies to per-model child processes and returns 400 without it. `/props`, `/tokenize`, `/apply-template` and `/slots` all go through `getWithModel`/`postWithModel`, which send it as both a query param and a body field, then retry bare for single-model servers. Dropping this is what silently disabled all exact counting before.
- **Context length comes from the server**, in order: `/props` → `default_generation_settings.n_ctx`, then `/v1/models` → `meta.n_ctx`, then `/slots`. Note this is the **per-slot** value: `-np 4 -c 131072` gives each slot 32768, and that is the real limit. A manual `num_ctx` on the model overrides all of it, so a stale value there beats the truth. **`n_ctx_train` is not the window** — it is the model's architectural ceiling, often 16× what was actually loaded, and it is only ever a last resort. `detectContextLength` in `lib/models.js` preferring it over `n_ctx` (while also calling `/props` without the model name, so router mode 400'd straight past it) is exactly how the budget silently overstated itself. Same rule as everywhere else here: never guess a row from `/v1/models` when the name does not match and more than one model is listed.
- **`/apply-template` is passed `tools` and `add_generation_prompt`.** Without them the tool schemas and the assistant suffix are not counted, which is a few hundred tokens of silent undercount on tool-enabled models.
- **The estimator never decides anything.** `estimateTokens` is a character heuristic and is English-biased; it is used only to pick the first probe point in the slide search and as a fallback for providers with no tokenizer. Every candidate the slider returns has been verified by the real tokenizer.
- **An oversized request is free.** llama.cpp rejects it before prefill (`n_tokens = 0`) and reports `n_prompt_tokens` and `n_ctx` in the error. `parseOverflow` reads them, so the recovery path corrects itself against ground truth instead of guessing again. Do not remove that parser; it is the backstop that makes the guarantee hold when images or a template quirk throw the pre-flight off.
- **Images are the one thing the tokenizer cannot see.** `/tokenize` is text-only, so each image carries a reserve (1600 by default, deliberately above the 1024 Qwen-VL floor) that is corrected upward from real `usage.prompt_tokens` and never lowered.

`slideToFit` keeps the system prompt and the newest user message, drops the oldest turns first via a verified binary search (typically two to four tokenizer calls, one when it already fits), and only trims message bodies when dropping is not enough, cutting the middle and keeping both ends. Trimming the system prompt happens only when it alone exceeds the budget, because refusing to answer is worse. The budget is `ctx - output reserve - 1%`, and the generation cap is clamped to the leftover room so a reply cannot overflow mid-stream.

### Trim mode, and why it quantises removals rather than the remainder

`slideToFit` is a thin wrapper over `slideWithCounter(count, msgs, budget, opts)`; the counter is injected purely so the search is testable without a live tokenizer. `opts.mode` comes from the model's `ctx_trim_mode`, `'retain'` (default) or `'cache'`.

**Retain** is the original behaviour: find the smallest drop that fits, then `reclaim` text back until the prompt nearly touches the ceiling. Maximum history, and the prompt prefix therefore changes on every single turn. llama.cpp reuses KV cache only up to the longest common prefix, and dropping from the front leaves nothing in common but the system block, so a conversation past its window re-prefills itself in full on every message.

**Cache** buys prefix stability by dropping further than needed and skipping `reclaim`. The subtlety is *what* gets quantised, and getting it wrong looks like it works while doing nothing:

- Quantising the **remaining** tokens ("drop until we are under 75% of budget") does not work. Every turn appends to the tail, so the same 75% target lands on a different message each time and the boundary still moves every turn. This was written that way first and the test caught it.
- Quantising the **removed** tokens does work. `needRemoved = ceil((total - budget) / step) * step` with `step = 25%` of budget, and candidates are accepted at `count(cand) <= total - needRemoved`. That condition is `removed(D) >= needRemoved`, in which `total` cancels out entirely — and `removed(D)`, the size of the first D messages, cannot change when you append to the end. So the boundary holds still until `needRemoved` crosses a step, roughly every `0.25 × budget` tokens of new conversation.

The reduced target is a preference, never a constraint: `budget` remains the hard ceiling in both modes, and if no drop count reaches the quantised target the search falls back to the smallest candidate that merely fits. Refusing to answer is worse than dropping less than intended. Because `needRemoved >= over`, the target is naturally bounded at 75% of budget, so cache mode discards at most a quarter of the window more than it had to.

`enable_summaries` compaction rewrites the prefix too. It fires far less often, so it is left alone.

## The four engine readouts

Four separate surfaces report on the running model. They exist separately because they answer different questions at different times, and collapsing any two of them loses one of the answers:

| Surface | When | Answers |
| --- | --- | --- |
| `StreamStatus` (`Message.jsx`) | before the first token | is it prefilling, how far, how much was reused from KV cache, roughly how long left |
| `EngineStrip` | during the reply, plus 5s after | current tok/s with a sparkline, prompt tok/s, ctx fill for this turn |
| `SpeedChip` (`Message.jsx`) | forever, on hover | what tok/s that specific reply ran at |
| `EngineFacts` (`ProvidersSection.jsx`) | on Test connection | what the llama.cpp server itself is running |
| `CtxGauge` | always, between turns | how full the window is *right now*, before you send anything |

Details that are load-bearing:

- **`StreamStatus` also owns the `waiting` phase.** `turn.js` starts a `SILENT_MS` (2500ms) interval next to the opening `sendStatus({ phase: 'prefill' })` and cancels it on the first event of any kind from `streamCompletion`. In router mode a llama-server loads the model before answering, which is otherwise indistinguishable from a hang. The label must stay honest: the server knows only that nothing has come back, not why, so it says exactly that and shows elapsed seconds rather than claiming a model is loading.
- **`StreamStatus` shows immediately when it has real numbers** and only waits 1.2s when it does not. It used to wait a flat 5 seconds, which is precisely the window you are staring at nothing during a long local prefill. It leads with cache reuse when there is any, because "94% reused" is the number that tells you the KV cache is working; the generic label does not.
- **Speed is persisted on the message row** (`speed: { tps, promptTps, exact }`, written in `turn.js`, exposed by `routes/chats/messages.js`). It is recorded *before* the telemetry throttle, so the final tick of a turn is never the one that gets dropped. `exact` is false when the numbers were estimated from streamed text rather than reported by llama.cpp `timings`, and the UI marks that with a `~`.
- **Only speed is exposed to the client, never the cost** that sits beside it in `m.usage`.
- **`llamaEngine(provider)` is the provider-level sibling of `llamaInfo(model)`**, behind `GET /api/admin/providers/:id/engine` and folded into the existing Test connection button rather than polled. `/slots` returns 501 when the server ran with `--no-slots`; that is a normal configuration, so `slotsHidden` says so instead of the panel reporting a failure.
- Both `ctxGauge` and `msgSpeed` are **opt-in** prefs (default off) under **Settings > Chat > Tools**, next to `engineStrip`. They are extra numbers on screen that mostly matter when you are running the model yourself.

## Client tests (`npm test` in `client/`, `npm run test:client` from the root)

`client/test/logic.test.js` runs on `node --test` with no extra dependencies, mirroring the server suite, and runs in CI as **Client logic tests**. It covers the pure logic that build tooling cannot check: the keybind model (`comboFromEvent` including the macOS Option-symbol and dead-key paths, combo validation, sanitize/resolve/index, chords, presets, import/export), reasoning parsing (`lastSentence`, `parseSteps`), `hasMath`/`wrapMathEnvironments`, `previewOf`/`buildTree`/`collapseRuns`, and `scanTools`.

Two rules make this possible and are worth preserving. **Only modules with no imports are testable** — `node --test` cannot parse JSX, so anything importing a `.jsx` file is off limits. That is why `lastSentence`/`parseSteps` live in `lib/reasoning.js` rather than inside `ReasoningBlock.jsx`; pull pure logic out of components rather than reaching for a JSX-aware runner. And there is a test asserting `lib/reasoning.js` contains **no regex lookbehind**, because that is a parse-time error on Safari below 16.4 and would take down the whole bundle rather than one component.

Writing these immediately found a real bug: `isValidCombo` only validated the modifier half, so junk like `'(((('` passed and was stored, which *disabled* that shortcut instead of falling back to its default — the opposite of what the keyboard section promises. `isValidKey` now requires a single character or a real DOM key name.

## Dead CSS report (`npm run dead:css`)

`client/scripts/dead-css.mjs` lists class names in `src/styles/` that no `.js`/`.jsx`/`.html` under `src/` references, accounting for dynamically composed names (`'r-' + role`) by also testing every hyphen prefix. It is **advisory and never fails the build**, because a zero-hit class can still be emitted by a library — `katex-display` is the obvious case, and `EXTERNAL` at the top of the script is where those go. Verify before deleting; the report is a starting point, not a verdict.

## Render smoke test (`npm run smoke`)

`client/scripts/smoke.jsx` server-renders every admin `ModelEditor` section plus the standalone modals and asserts none of them throw. It exists because `vite build` type-checks nothing: passing wrong props to a component compiles perfectly and then blanks the whole panel at runtime. That is exactly how the Routing tab shipped broken once — `Toggle` takes `{ m, set, k }` and reads `m[k]` internally, while `Switch` is the one that takes `{ on, onToggle }`. Passing `on`/`onToggle` to `Toggle` left `m` undefined and killed the admin app.

It runs in CI as **Components render without crashing**. Run it locally after touching any admin section or modal. Adding a component to the list is two lines and worth it for anything reachable behind a tab, since a crash there is invisible until someone clicks.

All 19 `useAdmin` sections are now covered by wrapping each in `AdminProvider`; `renderToString` never runs effects, so the provider's API calls do not fire. That took coverage from 14 components to 33.

## Router models (`lib/router.js`)

A model row with `kind: 'router'` has no backend of its own. `lib/ws/connection.js` resolves it *before* `applyKwargs`, so kwargs apply to the model that actually runs, not to the hub. `resolveRouted` returns `{ model, routed }`; `model` is `null` when routing fails, and the caller must surface `routed.error` and stop rather than falling back to a default, because silently answering with the wrong model is worse than refusing.

Rules are ordered and the first match wins. Matchers live in `ROUTE_MATCHERS`; adding one means a case in `ruleMatches` plus an entry in `MATCHERS` in `ModelEditor.jsx`. Two invariants worth keeping:

- **Cycle safety.** Routers may target other routers. `resolveRouted` walks with a `seen` set and refuses on revisit. Without it a two-router cycle is an infinite loop inside a request.
- **Regex is user input.** `new RegExp` is wrapped in try/catch and a broken pattern returns `false`, never throws. There is a test for this; an admin typing `([` must not break every turn.

Matching only ever looks at the *latest* user message. For `regenerate` there is no incoming content, so `connection.js` pulls the last user message from the chat, otherwise a regenerate would route on an empty string and always hit the fallback.

Names in the `routed` payload go through `modelLabel`, which reads `display_name` first: model rows have no `name` field, and reading one is what made the EngineStrip "via" chip render blank.

`shapePublic` exposes `kind` and `routerTargets` so the client can tell a hub from a model. Rules are sanitized on write in `routes/models.js` (unknown matcher becomes `keyword`, entries without a `modelId` are dropped, capped at 40).

## The sandbox harness

The sandbox is a harness for models of every size, so the rule throughout is **never let the model guess anything the server already knows.**

**The host is detected, not assumed.** `hostEnvInfo()` in `sandbox.js` scans `PATH` (honouring `PATHEXT` on Windows) and version-probes only the binaries it actually finds, so a missing program costs no spawn. The result feeds three places: the `bash` tool description, the "Host environment" prompt section, and the hint appended to a not-found shell error. All three are generated from the same object, so they cannot contradict each other — which they did, claiming `grep` and `sed` were absent on a Windows box where Git ships them. Detection is cached per process and warmed from `index.js` after `listen`, off the request path.

Three details there are load-bearing. `PATH_EXTS` must not include `''` on Windows: an extensionless `npm` shell script resolves first, Node cannot execute it, and npm is then reported as missing on a machine that has it. `.cmd`/`.bat` shims must be probed through `cmd.exe /d /s /c ""<path>" <args>"` with `windowsVerbatimArguments`, or Node's own quoting breaks them. And any version string containing a path separator is discarded in favour of `available`, because `pip --version` prints an absolute host path and the prompt must never leak host layout to a model we are telling to use relative paths only.

The same quoting rule applies to `bash` itself: `spawn(cmd.exe, ['/d','/s','/v:on','/c', '"'+wrapped+'"'], { windowsVerbatimArguments: true })`. Without it Node escapes the inner quotes as `\"`, the wrapper's `cd /d "<base>"` fails, and every single command on Windows prefixes its output with "The filename, directory name, or volume label syntax is incorrect." It still *worked*, because `spawn` sets `cwd` anyway — which is exactly why it went unnoticed.

**cmd.exe's own builtins reject forward slashes as path separators**, and this is the single most common way a model's first `bash` command fails on Windows. `mkdir a/b`, `del x/y`, `copy`, `move`, `ren`, `rmdir`, `dir` and `type` all parse a bare `/` inside a path argument as the start of a switch — `mkdir a/b` is read as `mkdir a` plus a bogus `/b` flag and fails with "The syntax of the command is incorrect." `cd` is the one exception: it hands the path straight to `SetCurrentDirectoryW`, which accepts either separator. Every real interpreter, this app's own file tools, and even the URL bar take forward slashes fine, so a model has no reason to expect this and every reason to write `/` out of habit — its training data is overwhelmingly Unix-flavoured. `winTranslate` in `sandbox/shell.js` auto-corrects this: for the fixed `SLASH_SENSITIVE` set of builtins, every token that doesn't itself start with `/` (a token starting with `/` is a real switch like `/s` or `/q` and is left alone) gets its slashes flipped to backslashes before the command runs. The host-environment prompt section and the `bash` tool's own schema description both warn about this explicitly and scope the warning to shell commands only — the file tools' `path` argument still always takes forward slashes, on every OS, and must not be confused with this. If a path token happens to start with `/` (so the auto-fix skips it) and the command still fails, `bash`'s failure path pattern-matches "Invalid switch" / "the syntax of the command is incorrect" on Windows and appends a targeted hint rather than the generic not-found one.

**The boundary is enforced, not requested.** `lib/sandboxguard.js` holds both halves and is pure so it can be tested without a filesystem:

- `normalizeRel` is forgiving where intent is unambiguous and strict where it is not. `\` becomes `/`, `.` and `..` inside the path collapse, surrounding quotes are stripped, and a leading `/` is dropped — `/notes.md` plainly means the workspace root. But `/etc/passwd`, `C:\...`, `\\server\share`, `~/x` and `..` above the root are refused, each with an error naming the correct form. Every relative path is normalized **once** in `execTool`, so the version metadata key, the path echoed back, and the file on disk can never disagree.
- `screenCommand` refuses a shell command before it runs: absolute or system paths in any token, `..` that escapes given the current depth, `cd` out of the workspace, and host administration (`sudo`, `systemctl`, `reg`, `apt`, `docker`, `ssh`, `shutdown`, …). Project-local installs (`npm install`, `pip install`, `cargo build`) stay allowed. Tokenizing respects quotes, `/dev/null` is allowed, and single-segment `/x` is not treated as a path so cmd flags like `/d` and `/s` survive. The false-positive set is the thing to protect: there is a test listing ordinary build commands, and it should grow whenever the screen does.

**Wrong tool names are resolved, not rejected.** `tools/aliases.js` maps what models actually emit (`write_file`, `str_replace_editor`, `run_terminal_cmd`, …) onto the canonical names. Two tiers, and conflating them is a bug: `STRICT_ALIASES` holds unambiguous compound names, `LOOSE_ALIASES` holds bare words like `read`, `list` and `copy`. Only the strict tier reaches the streaming text-call path, because `nameFromHint` scans identifiers in the preceding prose and a loose tier there would turn the word "list" in a sentence into a tool call. The loose tier is used only by `execTool`, where the model has explicitly named a tool.

Resolution is always **scoped to the enabled tool set** (`makeToolResolver`), and an exact name always beats an alias, so an MCP server exposing its own `write_file` is never hijacked by the sandbox tool. `turn.js` canonicalizes a call only after the non-sandbox dispatchers have declined it, for the same reason.

**Wrong argument names and near-miss edits are resolved too.** Three mechanisms, all aimed at the same failure: a small model that clearly meant something valid and spelled it wrong, which would otherwise burn its whole turn budget resending the identical call.

- **`argBody` is the reader for anything that is a file body** (`create_file` content, `str_replace` new_str, `insert_lines` content). It differs from `argText` in exactly two ways, and both are load-bearing. It treats `""` as a *value*, not as absent — `first()` in `args.js` skips empty strings, which is right for a path and wrong for a body, and was silently making `create_file` with an empty file and `str_replace` with an empty `new_str` (the documented way to *delete* text) both fail as "missing argument". And when no known key is present it makes one salvage pass over the unrecognized keys, taking the longest string that is body-shaped (contains a newline or is 80+ characters) and reporting which key it came from in `note`. The exclusion set `NOT_CONTENT` in `exec.js` is what stops a `description` or a `reason` from being written to disk as the file; the length/newline floor is the second guard. Widen the explicit `CONTENT_KEYS` list before loosening either.
- **`str_replace` falls back through three matchers**: exact, then line-ending-normalized (a model that retypes a snippet emits `\n` into a CRLF file), then indentation-insensitive by comparing trimmed lines. The fuzzy window is accepted **only when exactly one region matches** — ambiguity stays an error rather than a guess — and `new_str` is re-indented to the file's own indentation on the way in, so a flat retype does not flatten the file. Success carries a `note` saying it did not match exactly, because a model that is never told keeps retyping.
- **A failed `str_replace` shows the file's actual text.** `nearestRegion` scores every line against the first line of `old_str` by character-bigram Dice coefficient and prints the best region with real line numbers. Token-overlap scoring was tried first and is not enough: `"version": "9.9.9"` against `"version": "1.0.0"` shares one token out of four and scores below any usable threshold, while the strings are obviously the same line.

`formatToolResult` must keep surfacing `note` for `create_file` and `str_replace` — a salvage or a fuzzy match that the model is not told about is a silent behaviour change it will repeat.

**Every failure teaches.** A missing argument names the argument, says what it is for, and shows a complete example call; an unknown tool suggests the nearest real name (edit distance) and lists the valid ones; a blocked path explains the boundary and gives a correct example; a not-found command lists what *is* installed. `turn.js` already appends a "this identical call failed N times" note. The goal is that a small model's second attempt succeeds, so when adding a tool or a guard, write the error for the model that just got it wrong.

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

`POST /api/auth/check-email` was removed. Nothing used it after the flow split, and it answered "does this account exist" to anonymous callers. CI used to probe it as its liveness check; that is now `GET /api/auth/context`, so if you remove another endpoint, check `.github/workflows/ci.yml` before assuming nothing depends on it.

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
- The chat composer floats (`.composer-wrap.floating`) over the scroll area with a to-top gradient; `thread-pad` reserves 130px so content never hides beneath it. **The gradient must stay full-bleed** (`max-width: none`, and no inline `maxWidth` from `App.jsx` under this preset). Capping it at the 808px content width leaves a straight vertical edge that becomes visible the moment anything scrolls past it outside that band — which the icon-left avatar does, since `Message.jsx` positions `.il-avatar` at `left: -(gutter + 14)`, outside the thread's own 808px. Keep the fade as wide as `.main` and let each child centre itself instead.
- Consequently every direct child of `.composer-wrap.floating` must constrain its own width. The wrapper is `pointer-events: none` with `> * { pointer-events: auto }`, so a full-width child silently swallows clicks across the whole bottom strip; `.disclaimer` carries `max-width: 768px` for exactly that reason, and `.composer-stack` and `.engine-strip` already self-centre.
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
- `tools/` — re-exported from `tools/index.js`: `schemas.js` (`buildTools` and the per-capability schemas), `args.js` (`parseArgs`, `toCall`), `textcalls.js` (`parseTextToolCalls`, for models that emit tool calls as text instead of structured calls), `preview.js` (`livePreview`), `aliases.js` (canonical sandbox tool names and the alias table — see "The sandbox harness" below). No custom/live tools: that feature was removed.
- `toolproto.js` — inline tool-call syntax scanner shared conceptually with `client/src/toolproto.js`.
- `sandbox.js` — the **barrel** for the per-chat file sandbox. It contains no logic; every consumer imports `* as sandbox` from here and the implementation lives in `sandbox/` (below). `skills/sandbox.md` is the base sandbox system prompt.
- `sandbox/` — one module per job, in dependency order so there are no cycles:
  - `paths.js` — `SANDBOX_ROOT`, `dirFor`, `resolveSafe` (the escape guard), `relOf`.
  - `meta.js` — per-file version numbers, history snapshots, the persisted shell cwd, and the bounded meta cache.
  - `ignore.js` — `extOf`/`isText` plus dependency, build and `.gitignore` filtering. Owns the gitignore cache; `files.js` drops entries through `gitignoreCacheDrop` rather than reaching into the `Map`.
  - `zip.js` — the zip codec (`zipBuffer`, `unzipBuffer`). Pure: no filesystem, no chat id.
  - `files.js` — the versioned workspace filesystem: list, read, write, edit, tree, search, find, and the zip wrappers that touch disk.
  - `hostenv.js` — `pickShell` and the PATH-scanning host detection described under "The sandbox harness".
  - `shell.js` — `bash`, the cmd.exe/POSIX wrapper and `winTranslate`.
  - `args.js` — the argument readers (`argText`, `argPath`, `argBool`, …) that absorb the many spellings models use for the same argument.
  - `exec.js` — `execTool`, a **dispatch table** keyed by canonical tool name. Adding a tool is one entry plus one schema in `tools/schemas.js`; handlers receive an already-normalized relative path and never re-validate one.
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
- `sandboxguard.js` — the workspace boundary: `normalizeRel` (path validation) and `screenCommand` (shell screening). Pure functions, no fs access, covered by tests.
- `purge.js` — `purgeUserChats(userId)`: the single implementation of "remove every chat this user owns" (sandboxes, uploads, messages and chat rows, in one transaction). `routes/auth.js` and `routes/admin.js` both call it; do not re-inline it.
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
6. The client mirror of this is `App.jsx`'s `gen` map, which is a **ref** so a token never re-renders the tree. `busyChats` state is the one thing derived from it, refreshed only by `syncBusy()` and only when membership actually changes; `Sidebar` turns that into the pulsing `.row-busy` dot and a Stop entry on rows generating out of view. Every mutation of `gen` goes through `queueRec`/`dropRec`/`recFor` so the mirror cannot drift — do not call `gen.current.set/delete` directly.

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
- `CtxGauge.jsx`: the persistent context fill beside the model picker, behind the `ctxGauge` pref (default off). It follows the picker: composer under the Anthropic preset, topbar under OpenAI. Rendered from one `ctxGaugeEl` in `App.jsx` so the two sites cannot drift. Reads `GET /api/chats/:id/context`, which counts with the real tokenizer when the backend has one. It measures against the **budget** (window minus the reply reserve), not the raw window, because the raw window reads empty right up to a truncation. Deliberately not recomputed on keystrokes: each refresh is a live `/tokenize` round trip, so it is keyed on chat, model and the last message id, debounced 350ms, and skipped entirely while streaming.
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

It covers the pure logic that is easy to break silently: kwarg resolution and pairing chains, text tool-call parsing (including the negative cases where prose or an unknown tool name must NOT become a call), compaction thresholds and in-turn tool trimming, llama.cpp overflow detection, the Windows command translation, the sandbox path/command guards, tool-name alias resolution, and `preferredChild` from `lib/tree.js`. Add cases here when touching any of those; they are cheap and they have already caught real regressions.

The **sandbox tool tests deliberately touch a real temporary workspace** (`oq-test-sandbox`, removed before and after each case). That is not laziness about mocking: `node --check` and even importing a module both pass while a handler references an identifier it never imported, because the reference is only resolved when the handler runs. Splitting `sandbox.js` produced exactly that bug — `list()` called `readMeta` without importing it, and every static check was green. Only running the tool caught it.

CI syntax-checks every `.js` file under `server/` via `find`, so new files and folders are covered automatically. Do not replace that with a hand-written file list.

## Scrolling containers

Never write `overflow-y: auto` on its own. Per spec a `visible` axis paired with a non-`visible` one computes to `auto`, so it silently creates a **horizontal** scroll container too — that is what once hid the "More models" submenu behind a sideways scrollbar. Always `overflow: hidden auto`. All 41 pre-existing instances were converted; `.katex-display` is the one intentional exception, since it pairs `overflow-x: auto` with `overflow-y: hidden` on purpose.

This is safe across the app because wide content already scrolls inside its own container: `table` is `display: block; width: max-content; overflow-x: auto` in `chat.css`, `pre` carries `overflow-x: auto` in both `.code-wrap` and `.art-md`, and `.katex-display` handles wide formulae. Anything new that can exceed its column needs the same treatment rather than relying on an ancestor to scroll sideways.

The sidebar chat list adds stepper arrows at each end of its scrollbar via `::-webkit-scrollbar-button`. Firefox has no equivalent, so `.chats-arrow` DOM buttons are rendered behind `@supports not selector(::-webkit-scrollbar-button)` — they appear only in engines lacking the pseudo-element, which keeps Chrome and Safari on the native-looking steppers and avoids double arrows anywhere.
