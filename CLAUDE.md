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

and, for a *palette variant* of a theme, an optional third:

```
data-palette="2026q3"
```

### Palettes are token overrides, never a new theme value

A palette is a colour scheme and nothing else. `client/src/lib/palettes.js` is the registry — pure and import-free, so it is unit-tested — and every entry maps an id to a `{ theme, palette }` pair:

| Id | `data-theme` | `data-palette` |
| --- | --- | --- |
| `anthropic-light` | `light` | — |
| `anthropic-legacy` | `anthropic` | `legacy` |
| `anthropic-2025q2` | `anthropic` | — |
| `anthropic-2026q3` | `anthropic` | `2026q3` |
| `openai-light` | `light` | — |
| `openai-2024q1` | `openai` | — |

**A new palette must not introduce a new `data-theme` value.** Around forty rules across `base.css`, `chat.css` and `extras.css` are scoped `:root[data-theme="anthropic"] .foo` to give the Anthropic preset its shape; a palette that changed the theme attribute would silently drop every one of them. So `anthropic-2026q3` keeps `data-theme="anthropic"` and adds a single token-override block, `:root[data-theme="anthropic"][data-palette="2026q3"]`, plus the handful of rules that hardcode a colour the tokens cannot reach (the composer ring, the active chat row, the greeting weight).

`anthropic-2026q3` is the default dark for the Anthropic preset and is measured 1:1 against claude.ai. Its surface ladder is `#151515` app and sidebar, `#1a1a19` cards and modals, `#20201f` composer and popovers, over `#0b0b0b`; text runs `#ffffff` / `#c3c2b7` / `#898781`; and — the thing that makes it read as one system — **every hover, active and selected state is a white overlay**, `rgba(255,255,255,.05)` for a field or a segmented track and `rgba(255,255,255,.1)` for a hover, a menu item or a pressed control. The one exception is the active chat row, which is a solid `#111111`. `anthropic-2025q2` is the older warmer scheme (`#1a1a19` / `#383835`) and `anthropic-legacy` is older still — the palette from before the first claude.ai matching pass, with a lighter `#1f1f1e` app over a separate `#1d1d1c` sidebar, a near-black `#121212` user bubble, a plain bordered composer with no ring glow, and the softer `rgba(255,255,255,.8)` greeting. All three are kept because each is a genuinely different look, not a deprecated one.

Because a palette block is a *diff* on the theme block it extends, anything a palette does not restate is inherited from `:root[data-theme="anthropic"]`. That is what makes them cheap, and it is also the thing to watch: `legacy` has to restate `--pop-shadow` and `--pop-ring` explicitly, since 2025 Q2 introduced an inset hairline that never existed in the palette legacy is reproducing.

`paletteFor(themePref, preset, prefersDark)` resolves the stored pref, and it must keep tolerating three things: `system`, the legacy `dark`/`oled`/`anthropic`/`openai` values written before palettes existed, and **an id belonging to the other preset** — switching the workspace preset must land on that preset's equivalent light or dark rather than leaving a dead value. `themeValue` is the inverse, guaranteeing the picker never shows a value it cannot select; there is a test asserting that for every preset and every legacy input.

The pre-paint script in `index.html` reads `oq-palette` beside `oq-theme` and has to know the new background literal, or the first frame flashes the old one.

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

## Settings rows

The Appearance panel uses three primitives, all in `SettingsModal.jsx` and styled in `modals.css`, copied from claude.ai's settings because a row of labels with the control hard right reads far better than a wall of segmented groups:

- **`SetRow`** — `flex; justify-content: space-between; padding: 15px 0` with a hairline under it. Title 14px, note 13px in `--text-faint`, control `flex-shrink: 0`.
- **`SelectRow`** — the dropdown. A 32px transparent trigger that fills with `--hover-mid` on hover or while open, and a 224px menu on `--pop-bg` with 32px items. An option may carry a `font`, which is what renders each Chat font choice in the face it selects.
- **`SegSlide`** — the segmented control with the sliding thumb (Motion, Message density, Reveal speed, Cursor style, the keybind preset, the usage window). The track is `--hover-soft` at `padding: 1px`, the thumb is an absolutely-positioned `--hover-mid` pill that animates `transform` **and** `width` over 200ms on `cubic-bezier(.32, .72, 0, 1)`.

The thumb geometry is **measured, not computed from a fraction**: options have different widths, so the effect reads on `offsetLeft`/`offsetWidth` of the selected button through a `ResizeObserver`. A percentage-based thumb drifts the moment a label is translated, which is exactly the case that matters here. The old `Seg` is still used elsewhere (the usage window tabs) and is deliberately left alone.

All four live in `components/settingsui.jsx` rather than inside `SettingsModal`, because `KeybindsPanel` is a separate lazy component and its preset picker needs the same control — a second copy is how the two drift. `SwitchRow` and `Toggle` both render through `SetRow`, so every switch in Settings is one row shape; `.field.row` in `modals.css` is styled to match it exactly, which is why the panels that still use it (Security's session list, the danger zone) are visually indistinguishable. Descriptions are one line — the longest was 189 characters before this pass and nothing should reach that again.

## The settings sidebar is measured against claude.ai, not approximated

`.modal-side` is a 1:1 reproduction of claude.ai's settings nav, and the numbers below were read off the live DOM rather than eyeballed. Keep them if you touch it: **192px** wide on `--modal-side` with a **0.8px** right hairline; a 12px outer inset; rows **32px** tall, `padding: 0 8px`, `border-radius: 8px`, **14px** label, **20px** icon, **12px** icon-to-label gap, **1px** between rows, active `rgba(255,255,255,.1)` at weight 500 and inactive `--text-muted`; group labels **12px** in `--text-faint`, `padding: 12px 8px 0` and then a **12px** gap before the first row of the group (which is why `.ms-group` carries `margin-bottom: 11px` beside the list's 1px gap — the two add up to claude's 12).

`NAV_GROUPS` is the single source of truth for the nav; the old hand-written JSX let a page exist in one place and not the other. There is no visible "Settings" heading — claude's is `sr-only` and ours matches, which is also what keeps the accessible name.

### The search box and its results

The field is `--hover-soft` with `box-shadow: inset 0 0 0 1px var(--field-ring)`, going to `--field-ring-hover` on hover **only when not focused within**, and to claude's focus ring — `inset 0 0 0 1px var(--modal-side), 0 0 0 1px var(--pop-blue), 0 0 6px 1px rgba(24,79,149,.6)` — on `:has(:focus-visible)`. `:focus-visible`, not `:focus`, is deliberate and is what claude does: clicking the field gives no blue ring, tabbing to it does.

Results are a **280px popover portaled to `document.body`**, because `.modal-side` is `overflow: hidden` and clipped it. It uses `useAnchoredMenu` with `align: 'left'` and the new `gap: 4` option (claude's gap is 4; the shared `MENU_GAP` is 6, and every other menu keeps it).

Three details that were wrong on the first pass and are easy to get wrong again:

- **`--pop-ring` is a colour, not a shadow.** Writing `box-shadow: var(--pop-ring), …` makes the whole declaration invalid and the popover renders with no shadow at all. `--pop-shadow` is already exactly claude's popover shadow under the 2026q3 palette — use it.
- **Rows are `padding: 0 4px`, not `0 8px`.** The panel's own 4px padding plus 4px puts the icon 8px from the panel edge and the label at the same x claude uses; 8px pushes everything 4px right.
- **A flex row with `gap` splits a highlighted label into separate flex items**, inserting 12px around every matched substring. The label must be one child (`.ms-res-name`), not bare text plus a `<span>`.

Result shapes follow claude exactly: a page whose own name matches is a single row; a page with one matching setting shows the page row plus a 13px `--text-faint` sub-line; a page with several shows the page row then one 14px row per setting, all indented to the label column. `SETTINGS_INDEX` holds the searchable setting names per page and must be kept in step with the panels — a renamed control that is not renamed here is silently unfindable.

## A menu that can leave its container must be portaled

`client/src/lib/anchor.js` is the single implementation: `useAnchoredMenu(open, setOpen, btnRef, menuRef, opts)` returns `{ top, left, maxH }` in viewport coordinates and `menuStyleOf(pos)` turns that into the inline style. It flips above the anchor when there is more room there, clamps to an 8px margin on every edge, caps the height and turns on scrolling when even the better side is too short, and closes on scroll or resize rather than trying to follow.

Use it for **any** menu whose anchor sits inside a scrolling or clipping ancestor. Three menus were clipped for exactly that reason and now share this: `MoreMenu` and the "Retry with another model" menu (inside `.thread`, which scrolls), and the settings dropdowns (inside `.modal-main`, which is `overflow: hidden auto` — the accent list is ten items and simply disappeared past the modal's bottom edge).

**The related trap is the opposite one: writing `left` when you did not need to.** `.model-menu` is `position: absolute; right: 0`, so CSS already right-aligns it to its wrap. `ModelDropdown` used to compute `left = wrap.width - menuWidth` on every measure, which re-derives the same position from a width that *changes when the trigger's label changes* — and toggling Extended reasoning changes exactly that. Combined with a `ResizeObserver` on the wrap, each toggle produced a visible left/right jitter. Placement now leaves the horizontal position to CSS and writes `left` **only** when the menu would actually cross a viewport edge (`place.left` is `null` otherwise, and `right: auto` is only applied alongside it). If you add clamping to a popover, clamp conditionally — an unconditional inline `left` is a feedback loop waiting for its trigger to resize.

## Theme mapping (prefs.js → applyPrefs)

- A user's theme pref is a palette id (or `system`); the pre-palette values `light | dark | oled` are still accepted and resolve to the active preset's default.
- Under preset `anthropic`: dark → `data-theme="anthropic"` plus `data-palette="2026q3"` by default.
- Under preset `openai`: dark → `data-theme="openai"` (the pitch-black palette).
- Cursor: under preset `openai` the streaming cursor **defaults** to circle+on, under `anthropic` to block+off. These are defaults only — a user who has set `streamCursor`/`cursorStyle` keeps their choice in both presets, and the default is computed at apply time rather than written into their prefs.

**No preset may make a user pref inert.** `applyPrefs` writes every pref to a `data-*` attribute on `<html>` regardless of preset, and `openai.css` must not override those attribute-driven rules. A preset may change a pref's *default* (as the cursor does) but never its effect — a settings toggle that visibly does nothing in one skin is a bug, not a style choice.

### Motion and the text reveal are two separate prefs

They used to be one key, and conflating them caused a genuinely expensive bug: `animations` defaulted off under `openai`, which silently disabled every CSS transition in that skin. The reasoning open/close animation was written, shipped, and appeared completely dead for exactly that reason, with nothing wrong in the CSS. They are now split:

| Pref | Drives | Default |
| --- | --- | --- |
| `animations` | `data-animations` on `<html>`, which every CSS transition and keyframe opt-out keys off | on in both presets |
| `revealStyle` | how a reply appears — `instant` or `typewriter` | `typewriter` under `anthropic`, **forced `instant` under `openai`** |
| `revealMs` | the reveal loop's interval between slices | 40 |

**`client/src/lib/reveal.js` is the only place the resolution lives.** It is pure and import-free, so `App.jsx` and `SettingsModal` cannot disagree and so it is unit-tested. Everything reads `resolveReveal(prefs, preset)`; nothing reads `prefs.revealStyle` directly, and nothing should go back to reading the raw booleans.

`revealStyle` is a named string rather than a boolean for one reason: it makes the set of reveals **open**. Two rules keep it that way, and both are pinned by tests:

- **Adding a style** is one entry in `REVEAL_STYLES` plus one in `REVEAL_STYLE_OPTS` (`SettingsModal.jsx`) plus one branch wherever it is consumed. Nothing else needs a migration, because a value that is not yet known already resolves safely.
- **Removing one is safe on its own.** `resolveReveal` falls anything unrecognised through to the legacy read, so a pref still holding a retired style resolves to the *default reveal* rather than silently to `instant`. Three word-based styles (`fade`, `glide`, `blur`) shipped briefly and were removed for being more maintenance than they were worth; a user left holding one of those values sees the typewriter, not a dead setting. There is a test naming them.

`resolveReveal` must also keep tolerating the pre-split booleans: `typewriter` (and before it `animations`) was a boolean, so `false` resolves to `instant`. `SettingsModal` seeds `revealStyle` from that on first open, or anyone who had the typewriter off would have it switch itself back on the next time they touched any setting.

The typewriter itself is the JS reveal loop in `App.jsx` (`animate`), which holds back arrived text and releases it a slice at a time; `instant` writes each chunk straight to state as it arrives and `finalize()` runs the moment `done` lands. `instant` under `openai` is the one place a preset overrides a pref rather than its default, so `SettingsModal` hides the Text reveal row and the Reveal speed control entirely there rather than leaving controls that visibly do nothing.

**Reveal speed has no zero stop.** "No reveal at all" is the `instant` *style*, so offering it as a speed too would be one state reachable two ways. A pref already stored as `0` still works — the loop treats `<= 0` as instant — and the control surfaces it as its own chip rather than pretending it is off-grid.

When something animates in one preset and not the other, **check `document.documentElement.dataset.animations` before touching a single CSS rule.**

## The complete JS branch list (`cfg.uiPreset === 'openai'` or data-preset reads)

- `App.jsx` — chat topbar ModelDropdown; home-screen `.home-topbar` ModelDropdown; `hideModelPicker` for the composer, and `CtxGauge` moves into the topbar `modelPicker` block with it (the gauge belongs beside the picker, and the OpenAI composer pill reserves only 96px on the right for the mic and send button, so anything left there is squeezed out of sight); persistent per-message assistant icons (`showIcon`); floating chat composer wrapper class + 808px max width; incognito hero renders "Temporary Chat" + note; `revealStyle` resolves to `instant` so neither the reveal loop nor the word spans ever run and tokens render as they stream, with `SettingsModal` hiding the Text reveal controls to match (see "Motion and the text reveal are two separate prefs"); `QuickPrompts` keeps layout space when hidden (`qp-ghost`).
- `App.jsx` → `Message` → `ReasoningBlock` — a `preset` prop, because the two skins show reasoning differently (see "The reasoning block").
- `prefs.js` — theme mapping and forced circle cursor described above.
- `SettingsModal.jsx` — preset-aware cursor defaults when seeding the prefs object.
- `Composer.jsx` — none. The `.ml` multiline class is preset-agnostic; only `openai.css` styles it.
- `server/routes/models.js` — new-model defaults while `ui_preset === 'openai'`: `icon_size 28`, `show_name 1`, `icon_position 'left'`, `dropdown_icon 0`. `generating_anim`/`thinking_anim` default to `'none'` regardless of preset — the starburst icon set is self-animating (SMIL inside the SVGs), so the CSS `spin`/`pulse` classes would double up on it.
- The thread rail, find bar and branch map add **no** entries to this list. Every preset difference for them is CSS-only, scoped in `openai.css`. Keep it that way.

## The live tool line shimmers what is happening, not just that something is

A tool call with no result yet carries `.pending`, and the shimmer runs on the **verb and its target together** — `.tl-verb` plus `.tl-name` for a file step, `.tb-label` plus `.tb-peek` for the terminal. Only the verb used to shimmer, which told you something was happening but not what; the file name and the command are the part worth reading, and they stream in character by character from `livePreview`, so they are literally the live edge of the model's output.

Two details are load-bearing:

- **The gradient band is sized in px (`260px`), not in `%`.** With a percentage the band scales to each element, so a three-letter verb and a forty-character path sweep at wildly different speeds and read as two unrelated animations sitting next to each other. A fixed band makes one pace across the whole line.
- **The shimmer is per element, not on `.tool-line` itself.** A single parent gradient would give one continuous sweep and is tempting, but `background-clip: text` on the parent would also clip `.tool-line.clickable:hover`'s background to the text — a pending file step *is* clickable, so its hover fill would vanish.

`BashCard` and `WebSearchCard` set `pending` on `.tool-bash` themselves; `FileCard` and `ChipCard` already had it. The opt-out has to name all four selectors under both `[data-animations="off"]` and `[data-microfx="off"]`, since the base rule is two classes deep and a shorter opt-out loses on specificity.

## Thread performance: occlusion, not virtualization

Long threads are kept cheap with `content-visibility: auto` rather than windowing, because unmounting messages would fight the streaming reveal loop, the `stick`/`scrollHeight` autoscroll math in `App.jsx`, and the `nth-child` stagger animation in `polish.css`. `Message`, `Markdown` and `CodeBlock` are already memoized, so the remaining cost is layout and paint, which is exactly what occlusion removes.

Rules, all in `threadnav.css`:

1. `App.jsx` adds `.virt` to `.thread` when `heavyThread` is true. Nothing else toggles it, so removing that one class disables the whole feature.
2. Occlusion is applied to `.assistant-body`, `.bubble-user`, `.msg-attachments` and `.reasoning-collapse`, **never to `.msg`**. `content-visibility` implies paint containment, which would clip the negatively-positioned `.il-avatar` in the icon-left layout. `.msg.icon-left` is excluded from the assistant rule for the same reason.
3. The last 8 siblings are excluded via `:not(:nth-last-child(-n+8))` so the streaming message and its neighbours are never skipped.
4. `contain-intrinsic-size: auto <px>` lets the browser remember real sizes after first render; the literal is only the initial estimate. Browsers without support simply render everything as before.

### The gate is content size, not message count

`.virt` used to key on `messages.length > 24`, which measures the wrong thing. The worst real thread in the wild is **ten** messages: one of them is a pasted 3,464-line script and another a 4,541-line reply, and it rendered 14,085 nodes into a 235,293px-tall thread with **no occlusion at all** because ten is fewer than twenty-four. Scrolling it froze the renderer for over 45 seconds.

`heavyThread` (`App.jsx`) is therefore `messages.length > 24 || total content+reasoning chars > HEAVY_THREAD_CHARS` (40,000), short-circuiting as soon as it crosses. Occlusion now also applies to `.code-wrap` **inside** `.virt`, because per-message occlusion can do nothing for a single 100,000px message while any part of it is on screen — each block has to carry its own containment.

### Code blocks highlight lazily, off the render path

`highlight()` used to run synchronously inside `CodeBlock`'s render, for every block in the thread whether or not it would ever be painted — occlusion skips layout and paint, never React work. That one script produced **557 blocks of which 551 had no language tag**, so all of them took `highlightAuto`, the most expensive path hljs has.

`CodeBlock` (now memoized) renders escaped plain text immediately and upgrades to highlighted output only when an `IntersectionObserver` says the block is within 900px of the viewport. Three things make that safe:

- **The escaped text is correct output**, not a placeholder — a block that never scrolls into view is still readable and copyable, just uncoloured.
- **`scheduleHighlight` in `hljs.js` runs one job per idle slot** and stops as soon as `deadline.timeRemaining()` drops below 4ms. Without it a screenful of blocks arriving together was a single 189ms long task.
- **`bump()` is debounced by 120ms and clears the result cache.** It fires once per lazily-registered `EXTRA` language, and every `CodeBlock` has the version in its dependencies, so an undebounced burst meant one full-thread re-highlight per language.

`maxAuto` is 4,000 chars (was 12,000): beyond that `highlightAuto` costs more than the colour is worth.

**`.code-bar` is `position: sticky`, so it has to be opaque.** It was `background: transparent`, which meant that the moment a code block was tall enough to scroll, the language label and the Copy button sat on top of moving code and became unreadable. Only the OpenAI preset looked right, because `openai.css` happened to give the bar a solid fill of its own. The catch is that `--code-bg` is a *translucent* overlay in most palettes (`rgba(195, 194, 183, .05)` under 2026q3), so painting it on the bar changes nothing — the bar reproduces the whole stack the wrap composites against: `background-color: var(--bg)` plus the overlay as a gradient layer, with an extra `--user-bubble` layer for a block inside a user bubble. Any palette that gives `.code-wrap` an opaque background of its own (light, oled, openai) must give `.code-bar` the same one. The copy flash animates an inset `box-shadow` rather than `background` for the same reason — animating the background to `transparent` punched a hole straight through the header.

Measured on that thread, before → after: 14,085 → 6,205 DOM nodes, and a 36,000px programmatic scroll from a >45s renderer freeze to 138fps with zero long tasks.

### Scroll handlers are rAF-coalesced

`onScroll` read `scrollHeight` and called `setShowJump` on **every** scroll event. It now schedules one `readScroll` per frame and `setShowJump` fires only when the boolean actually flips (`jumpRef`), so the steady state costs nothing. `onTouchMove` sets a flag and goes through the same frame-coalesced read instead of forcing its own reflow per drag frame.

`ThreadRail` is memoized and each tick is its own memoized `Tick`, so an IntersectionObserver callback re-renders only the ticks whose visibility changed rather than all N. Hover and click are delegated to the list, which keeps the per-tick props stable; the aria-labels are built once in a `useMemo` keyed on `items` rather than per tick per render.

The stagger selector is `.msg:nth-last-child(-n+12)`, not `.msg`. Only the tail is on screen when a chat opens, and starting N concurrent animations was what made a long thread jank for the whole 700ms the class is applied.

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

### The four ways math used to fail to typeset

The preprocessing order is `transformTools` → `normalizeMathDelims` → `wrapMathEnvironments` → `isolateDisplayMath` → (`neutralizeOpenMath` while streaming) → `blockify`. Each of the four fixes below sits at a different stage, and all four are pinned by tests in `client/test/logic.test.js`.

- **`\\[4pt]` is row spacing, not a display delimiter.** `normalizeMathDelims` matched `/\\\[/g`, which also matches the *second* backslash of `\\[`, so every `align`/`cases`/`pmatrix` using LaTeX row spacing had its formula cut in half. The replacement alternation now consumes `\\\\` **first** and returns it untouched. A lookbehind would have been the obvious fix and is forbidden here — it is a parse-time error on Safari below 16.4 and would take down the whole bundle.
- **A lone `$` is not an open math delimiter.** `wrapMathEnvironments` tracked depth with a latch, so one price or `$PATH` set it to 1 for the rest of the segment and every later `\begin{align}` went unwrapped. It now enters math only when a matching closer actually exists ahead.
- **A blank line inside display math is not a paragraph break.** `blockify` splits on blank lines and ran *after* wrapping, handing remark-math two halves with an unbalanced `$$`. `wrapMathEnvironments` now collapses blank lines inside the body it wraps, and `blockify` tracks `inMath` and refuses to split inside a `$$` block, exactly as it already refused inside a fence.
- **`$$x$$` on one line is inline math to remark-math**, which is why KaTeX answered `align` with "can be used only in display mode" — the environment was being typeset in inline mode. `isolateDisplayMath` gives a standalone display block its own blank lines *and* breaks it over three lines, which is what makes it flow math. `remarkBreaks` is why the blank lines are needed: single newlines keep the block inside a paragraph.

`splitCode` and `normalizeMathDelims` share `CODE_SPLIT`, which knows ``` fences, `~~~` fences, double-backtick spans and single-backtick spans. `isFenceLine` already accepted `~~~`, so LaTeX inside one used to be rewritten and typeset instead of shown as code.

`.katex-error` had no stylesheet rule at all, so a formula KaTeX rejected was indistinguishable from red prose. It now renders as a bordered monospace chip that scrolls rather than overflowing the bubble. `--danger` is never defined anywhere in the codebase, which is why every use is `var(--danger, #e5635b)`.

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
- **When `StreamStatus` appears is the `statusDelay` pref**, not a constant. `lib/status.js` owns the whole of it: `STATUS_DELAY_DEFAULT` (3s), `STATUS_DELAY_MAX` (10s) and `statusDelaySecs`/`statusDelayMs`, which clamp to a whole number of seconds in range and fall back to the default for anything unreadable. It is a pure, import-free module so `App.jsx`, `SettingsModal` and the block itself cannot disagree about the bounds, and so the clamp is unit-tested. `0` means instant, and it must stay distinguishable from absent — a nullish check, never a falsy one. The block fades in via `msFade` in `extras.css` whenever it lands. Earlier versions hard-coded this: a flat 5s, then 1.2s unless real numbers had arrived. Both were wrong for somebody, which is why it is a slider under **Settings > Chat > Tools and context**. The label still leads with cache reuse when there is any, because "94% reused" is the number that tells you the KV cache is working; the generic label does not.
- **Speed is persisted on the message row** (`speed: { tps, promptTps, exact }`, written in `turn.js`, exposed by `routes/chats/messages.js`). It is recorded *before* the telemetry throttle, so the final tick of a turn is never the one that gets dropped. `exact` is false when the numbers were estimated from streamed text rather than reported by llama.cpp `timings`, and the UI marks that with a `~`.
- **Only speed is exposed to the client, never the cost** that sits beside it in `m.usage`.
- **`llamaEngine(provider)` is the provider-level sibling of `llamaInfo(model)`**, behind `GET /api/admin/providers/:id/engine` and folded into the existing Test connection button rather than polled. `/slots` returns 501 when the server ran with `--no-slots`; that is a normal configuration, so `slotsHidden` says so instead of the panel reporting a failure.
- Both `ctxGauge` and `msgSpeed` are **opt-in** prefs (default off) under **Settings > Chat > Tools**, next to `engineStrip`. They are extra numbers on screen that mostly matter when you are running the model yourself.
- **`EngineStrip` must never change the height of anything.** It used to `return null` when idle, and because it is an ordinary in-flow block inside `.composer-wrap` — which sits above a `flex: 1` `.scroll-area` — removing its ~35px resized the thread viewport in a single frame and jumped the whole conversation. That happened twice per turn, plus instantly whenever `telemetry` went null on a chat switch. The `.es-slot` wrapper now stays mounted and eases its own `grid-template-rows` between `0fr` and `1fr`, the same grid collapse the reasoning panel uses, so the space is reclaimed smoothly instead of vanishing. The component keeps the last telemetry in state purely so the strip still has content to show while it collapses. Reserving a fixed height instead would have pushed the composer down for everyone who never sees telemetry at all. Measured layout-shift score across a full turn is 0.0003.

## The context ledger counts live, and never estimates

`LedgerBar` shows two different numbers depending on whether a turn is running, and **both are measurements** — there is no character heuristic anywhere in this path, deliberately. A ledger that guesses is worse than one that stands still.

- **Between turns** it is `GET /api/chats/:id/ledger`, which counts through `countExact` → `/apply-template` + `/tokenize`. That call carries the model name, so it is correct in router mode.
- **During a turn** it is `livePrompt + telemetry.genTokens`. `turn.js` emits a **`prompt_size`** event once per agentic step, immediately before `streamCompletion`, carrying `lastFitTokens` (already verified by the slider) or a fresh `countExact`. `genTokens` is llama.cpp's own `timings.predicted_n`, which arrives per token because the request sets `timings_per_token`. Nothing here is inferred from the streamed text.

Three traps, each of which produced a visibly wrong number before it was fixed:

- **`timings.prompt_n` is not the prompt size.** It is the count of tokens *evaluated* during prefill, so it ramps from a partial value and is reduced by KV cache reuse. Reading it made the ledger fall by thousands mid-stream. The prompt half must come from `prompt_size`.
- **`usage` is synthesized from `timings` on every chunk**, not just the final one (`stream.js` falls back to `timings` when a chunk has no `usage`), so correcting `prompt_size` from `usage` re-introduced the same ramp. Do not send a per-chunk correction.
- **`predicted_n` is stale during prefill**, carrying the previous request's value on that slot for the first few frames. `turn.js` reports `genTokens: 0` (and `tps: 0`) until `genStart || reasonStart`, so a new turn never opens with the last turn's output count.

The live reading and the settled one differ by a handful of tokens at the moment a turn ends: the live figure is what is in the context window now, while the settled one re-measures the prompt the *next* turn will send, which adds the assistant message's closing tokens and the following generation-prompt header. That difference is **not** a constant — retokenizing the stored reply does not always agree with the tokens the model emitted — so do not try to cancel it with a learned offset. That was tried, and a learned offset is exactly the estimate this design refuses.

The ledger is **not re-fetched while streaming** (the effect bails when `streamingRef.current` and a ledger is already loaded). Its tokenizer calls compete with the running generation and fall back to `calibratedTokens`, which is an estimate; the live path already covers that window. `live.js` keeps `promptTokens` on the turn record and ships it in the `resume` payload, so a mid-stream reload picks the live count straight back up.

## Client tests (`npm test` in `client/`, `npm run test:client` from the root)

`client/test/logic.test.js` runs on `node --test` with no extra dependencies, mirroring the server suite, and runs in CI as **Client logic tests**. It covers the pure logic that build tooling cannot check: the keybind model (`comboFromEvent` including the macOS Option-symbol and dead-key paths, combo validation, sanitize/resolve/index, chords, presets, import/export), reasoning parsing (`lastSentence`, `parseSteps`), reveal-style resolution (`resolveReveal` including the legacy booleans, the OpenAI override and the retired-style fallback, plus `revealSpeedMs`), `hasMath`/`wrapMathEnvironments`, `previewOf`/`buildTree`/`collapseRuns`, `scanTools`, and the artifacts panel's diff and highlight logic (`diffLines`, `stableLineDiff`, `collapseRuns`, `splitHighlightedLines`, `markLine`, `findMatches`, `buildTree`).

Two rules make this possible and are worth preserving. **Only modules with no imports are testable** — `node --test` cannot parse JSX, so anything importing a `.jsx` file is off limits. That is why `lastSentence`/`parseSteps` live in `lib/reasoning.js` rather than inside `ReasoningBlock.jsx`; pull pure logic out of components rather than reaching for a JSX-aware runner. And there is a test asserting `lib/reasoning.js` contains **no regex lookbehind**, because that is a parse-time error on Safari below 16.4 and would take down the whole bundle rather than one component.

Writing these immediately found a real bug: `isValidCombo` only validated the modifier half, so junk like `'(((('` passed and was stored, which *disabled* that shortcut instead of falling back to its default — the opposite of what the keyboard section promises. `isValidKey` now requires a single character or a real DOM key name.

## Dead CSS report (`npm run dead:css`)

`client/scripts/dead-css.mjs` lists class names in `src/styles/` that no `.js`/`.jsx`/`.html` under `src/` references, accounting for dynamically composed names (`'r-' + role`) by also testing every hyphen prefix. It is **advisory and never fails the build**, because a zero-hit class can still be emitted by a library — `katex-display` is the obvious case, and `EXTERNAL` at the top of the script is where those go. Verify before deleting; the report is a starting point, not a verdict.

## Render smoke test (`npm run smoke`)

`client/scripts/smoke.jsx` server-renders every admin `ModelEditor` section plus the standalone modals and asserts none of them throw. It exists because `vite build` type-checks nothing: passing wrong props to a component compiles perfectly and then blanks the whole panel at runtime. That is exactly how the Routing tab shipped broken once — `Toggle` takes `{ m, set, k }` and reads `m[k]` internally, while `Switch` is the one that takes `{ on, onToggle }`. Passing `on`/`onToggle` to `Toggle` left `m` undefined and killed the admin app.

It runs in CI as **Components render without crashing**. Run it locally after touching any admin section or modal. Adding a component to the list is two lines and worth it for anything reachable behind a tab, since a crash there is invisible until someone clicks.

All 19 `useAdmin` sections are covered by wrapping each in `AdminProvider`; `renderToString` never runs effects, so the provider's API calls do not fire. That took coverage from 14 components to 33, and `Composer`, `ArtifactsPanel` and the artifacts `Viewer` bring it to 41.

Two things had to change for a component to be renderable here at all, and both are worth knowing before adding another:

- **The harness shims `localStorage` and `window`.** Node has neither, and a component that reads either one *during render* (both of these read stored width and `window.innerWidth`) crashes on the environment rather than on anything the test is meant to catch. The shim is deliberately minimal — enough geometry to render, no DOM.
- **`useSyncExternalStore` needs its third argument.** Without a `getServerSnapshot`, React throws outright when server-rendering. All four call sites (the hljs and KaTeX lazy loaders, `useI18n`) now pass the same snapshot function twice. This costs nothing in the browser: the app renders client-side only and never hydrates, so React ignores the server snapshot entirely — it exists so this test can reach the components that consume a lazily-loaded library.

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

### The shell's working directory is the other thing small models get stuck on

`bash` keeps a per-chat cwd (`getCwd`/`setCwd` in `sandbox/meta.js`) so `cd sub` carries to the next call. That is genuinely useful and stays — but combined with a model that reflexively prefixes `cd <project>` to every command it is an infinite loop, and it produced one in the wild: `cd proj && …` moves the shell into `proj`, the next `cd proj && …` resolves to `proj/proj`, cmd.exe answers with a bare "The system cannot find the path specified.", and every retry reproduces it. Three rules now hold it together, and all three are needed:

1. **The shell only moves when the command succeeded.** `parseTail` reads the cwd marker but `bash` commits it only on exit 0 (or a benign mkdir collision, below). A failed `cd proj && <broken>` used to relocate the shell anyway, so the *retry* ran somewhere else than the original — the failure was not even reproducible, which is what made it unrecoverable. A failed command now leaves the shell exactly where it was, so retrying does the same thing and the existing `callFails` note can see it.
2. **A `cd` the shell has already made is refused before it runs.** `staleCdError` fires only in the unambiguous case: the target does not exist relative to the cwd *and* does exist relative to the workspace root. It names the path that was actually looked for, says the shell is already there, and points at `workdir`. A genuine nested `cd`, and a target that exists nowhere, both fall through to ordinary behaviour.
3. **`workdir` is the stateless way to do this**, and both the tool schema and the host-environment prompt now say to prefer it over `cd`. It is resolved from the workspace root on every call, so it is safe to repeat.

**A directory that already exists is the state the model asked for.** `mkdir build` twice returned exit 1 and "A subdirectory or file build already exists.", which reads as a failure worth retrying — and the retry reproduces it forever. `bash` now reports it as success with a `note`, but only when the **last** segment is a mkdir and **every** output line is an already-exists error: with `&&` or `&` a trailing mkdir means nothing after it was skipped, and any other command that also failed would put a non-matching line in the output. `mkdir build && <something that fails>` is still a failure.

**Windows `find`/`sort`/`more` are not the Unix ones.** They exist, so the not-installed hint never fired; they just reject Unix flags with "FIND: Parameter format not correct". That now gets its own hint pointing at the `find`, `search` and `list_files` tools.

**cmd.exe's own builtins reject forward slashes as path separators**, and this is the single most common way a model's first `bash` command fails on Windows. `mkdir a/b`, `del x/y`, `copy`, `move`, `ren`, `rmdir`, `dir` and `type` all parse a bare `/` inside a path argument as the start of a switch — `mkdir a/b` is read as `mkdir a` plus a bogus `/b` flag and fails with "The syntax of the command is incorrect." `cd` is the one exception: it hands the path straight to `SetCurrentDirectoryW`, which accepts either separator. Every real interpreter, this app's own file tools, and even the URL bar take forward slashes fine, so a model has no reason to expect this and every reason to write `/` out of habit — its training data is overwhelmingly Unix-flavoured. `winTranslate` in `sandbox/shell.js` auto-corrects this: for the fixed `SLASH_SENSITIVE` set of builtins, every token that doesn't itself start with `/` (a token starting with `/` is a real switch like `/s` or `/q` and is left alone) gets its slashes flipped to backslashes before the command runs. The host-environment prompt section and the `bash` tool's own schema description both warn about this explicitly and scope the warning to shell commands only — the file tools' `path` argument still always takes forward slashes, on every OS, and must not be confused with this. If a path token happens to start with `/` (so the auto-fix skips it) and the command still fails, `bash`'s failure path pattern-matches "Invalid switch" / "the syntax of the command is incorrect" on Windows and appends a targeted hint rather than the generic not-found one.

**The boundary is enforced, not requested.** `lib/sandboxguard.js` holds both halves and is pure so it can be tested without a filesystem:

- `normalizeRel` is forgiving where intent is unambiguous and strict where it is not. `\` becomes `/`, `.` and `..` inside the path collapse, surrounding quotes are stripped, and a leading `/` is dropped — `/notes.md` plainly means the workspace root. But `/etc/passwd`, `C:\...`, `\\server\share`, `~/x` and `..` above the root are refused, each with an error naming the correct form. Every relative path is normalized **once** in `execTool`, so the version metadata key, the path echoed back, and the file on disk can never disagree.
- `screenCommand` refuses a shell command before it runs: absolute or system paths in any token, `..` that escapes given the current depth, `cd` out of the workspace, and host administration (`sudo`, `systemctl`, `reg`, `apt`, `docker`, `ssh`, `shutdown`, …). Project-local installs (`npm install`, `pip install`, `cargo build`) stay allowed. Tokenizing respects quotes, `/dev/null` is allowed, and single-segment `/x` is not treated as a path so cmd flags like `/d` and `/s` survive. The false-positive set is the thing to protect: there is a test listing ordinary build commands, and it should grow whenever the screen does.

  The host-command half is only as good as `SEGMENT_SPLIT`, because it reads the *first word of each segment*. It splits on `&&`, `||`, `;`, `|`, a bare `&`, a backtick and `$(` — every position where a new command can begin. It deliberately does **not** split on plain `(`/`)`: a conventional-commit message like `git commit -m "fix(net): retry"` would then present `net` as a segment's base command and be refused, and breaking real commands is worse than missing a subshell the path screen already covers. `foo & sudo rm -rf x` used to pass for exactly this reason.

**Wrong tool names are resolved, not rejected.** `tools/aliases.js` maps what models actually emit (`write_file`, `str_replace_editor`, `run_terminal_cmd`, …) onto the canonical names. Two tiers, and conflating them is a bug: `STRICT_ALIASES` holds unambiguous compound names, `LOOSE_ALIASES` holds bare words like `read`, `list` and `copy`. Only the strict tier reaches the streaming text-call path, because `nameFromHint` scans identifiers in the preceding prose and a loose tier there would turn the word "list" in a sentence into a tool call. The loose tier is used only by `execTool`, where the model has explicitly named a tool.

Resolution is always **scoped to the enabled tool set** (`makeToolResolver`), and an exact name always beats an alias, so an MCP server exposing its own `write_file` is never hijacked by the sandbox tool. `turn.js` canonicalizes a call only after the non-sandbox dispatchers have declined it, for the same reason.

**Wrong argument names and near-miss edits are resolved too.** Three mechanisms, all aimed at the same failure: a small model that clearly meant something valid and spelled it wrong, which would otherwise burn its whole turn budget resending the identical call.

- **`argBody` is the reader for anything that is a file body** (`create_file` content, `str_replace` new_str, `insert_lines` content). It differs from `argText` in exactly two ways, and both are load-bearing. It treats `""` as a *value*, not as absent — `first()` in `args.js` skips empty strings, which is right for a path and wrong for a body, and was silently making `create_file` with an empty file and `str_replace` with an empty `new_str` (the documented way to *delete* text) both fail as "missing argument". And when no known key is present it makes one salvage pass over the unrecognized keys, taking the longest string that is body-shaped (contains a newline or is 80+ characters) and reporting which key it came from in `note`. The exclusion set `NOT_CONTENT` in `exec.js` is what stops a `description` or a `reason` from being written to disk as the file; the length/newline floor is the second guard. Widen the explicit `CONTENT_KEYS` list before loosening either.
- **`str_replace` falls back through three matchers**: exact, then line-ending-normalized (a model that retypes a snippet emits `\n` into a CRLF file), then indentation-insensitive by comparing trimmed lines. The fuzzy window is accepted **only when exactly one region matches** — ambiguity stays an error rather than a guess — and `new_str` is re-indented to the file's own indentation on the way in, so a flat retype does not flatten the file. Success carries a `note` saying it did not match exactly, because a model that is never told keeps retyping.
- **A failed `str_replace` shows the file's actual text.** `nearestRegion` scores every line against the first line of `old_str` by character-bigram Dice coefficient and prints the best region with real line numbers. Token-overlap scoring was tried first and is not enough: `"version": "9.9.9"` against `"version": "1.0.0"` shares one token out of four and scores below any usable threshold, while the strings are obviously the same line.

`formatToolResult` must keep surfacing `note` for `create_file` and `str_replace` — a salvage or a fuzzy match that the model is not told about is a silent behaviour change it will repeat.

**Every failure teaches.** A missing argument names the argument, says what it is for, and shows a complete example call; an unknown tool suggests the nearest real name (edit distance) and lists the valid ones; a blocked path explains the boundary and gives a correct example; a not-found command lists what *is* installed. `turn.js` already appends a "this identical call failed N times" note. The goal is that a small model's second attempt succeeds, so when adding a tool or a guard, write the error for the model that just got it wrong.

**And when it never succeeds, stop early.** `turn.js` breaks out of the agentic loop on two signals, not one. The old one is the identical step twice over (`stepSig === prevStepSig`). That misses the common shape, because a stuck model rarely repeats itself *byte for byte* — it quotes the path, adds a `cd`, drops a flag — so the signature never matched and it burned the whole step budget. The second signal is `noProgress`: a step with zero successful calls whose failures classify to the same `tool:kind` set as the previous step, three in a row. `stepOk === 0` is what keeps it safe; a step that got anything done resets the counter.

## A cut-off tool call is not a malformed one

When a model's output stops mid-call — its own token cap, a provider cutting the stream — the arguments arrive as unterminated JSON. `parseArgs` falls through to `extractPartial`, which used to keep only the *closed* keys and silently drop the rest. A `create_file` truncated inside its `content` string therefore arrived as `{path}` alone and was answered with "create_file needs content", which is false: the model did send content, and being told otherwise it resends the identical oversized file and is cut off in the identical place. That is the mechanism behind a small model looping on the same call until its turn budget is gone.

`parseArgs` now attaches the unclosed key to the result under the exported `CUT_OFF` **symbol** — read it with `cutOffOf(call)`. A symbol is what makes this safe: object spread carries it through `toCall` and `canonicalize`, while `JSON.stringify` ignores it, so it can never leak into `cleanCall`, a tool payload or the database.

`turn.js` checks it **before dispatching** and refuses the call, because running a handler with half its arguments is what produced the misleading error. `cutOffError` names the argument, says how many characters arrived, states plainly that nothing was written, and — for the tools that take a file body — tells the model to split the write (`create_file` for the first part, `insert_lines` to append) instead of resending. Deliberately, the partial body is **not** written to disk: a file that is silently half-written but reported as created is worse than an error, since the model moves on and the user gets corrupt output.

`finish_reason` (OpenAI-shape) and `done_reason` (ollama) were previously read by nothing at all. `stream.js` now emits them as a `finish` event, which sharpens the message when the cause really was the output cap and makes the `done` payload's `truncated` flag — the one driving the client's Continue affordance — honest. The old heuristic (`completion >= max_tokens - 2`) is kept as a fallback but cannot fire at all when a model has no `max_tokens` set, which is the common case for local models and exactly when truncation matters most.

## Reasoning arrives on two channels, and only one of them has tags

`makeEmitter` in `llm/emitter.js` splits thinking from the answer, and it has to cope with providers doing this two completely different ways:

- **Inline**, where `<think>…</think>` (or the model's configured `think_open`/`think_close`) arrives in the ordinary content stream. `inThink` tracks the state machine and both tags are consumed.
- **Structured**, where the thought arrives on its own field (`reasoning_content` / `reasoning`) and `emitReasoning` forwards it directly. **`inThink` never becomes true on this path**, because there was never an opening tag to see.

That asymmetry is a real trap. When llama.cpp is given a thinking budget and the budget runs out, it forces the thought shut by emitting the **closing tag on the content channel** — a close with no matching open, which nothing was tracking, so it was printed as the literal first line of the answer.

`orphanClose()` handles it: a closing tag in the content stream is swallowed only when thinking has actually been seen this turn **and** no non-whitespace content has been emitted yet. Both halves matter. Without the first, any model could have a stray tag eaten; without the second, an answer that legitimately *mentions* `</think>` mid-sentence would lose it. Partial tags split across chunks are held back the same way opening tags already were. Providers that only ever send structured reasoning and never a stray tag are untouched, which is the whole point — this must not change behaviour for Anthropic or OpenAI.

**What this does not fix, because it cannot:** once the budget forces the thought closed, everything the model generates afterwards *is* content by definition. A model cut off mid-sentence carries on writing its plan, and that plan lands in the answer. There is no signal left to distinguish it from a real reply, and guessing would eat genuine answers. The fix is a budget large enough for the model to finish a thought — which is an argument for setting a sane **minimum** on a thinking-budget range kwarg rather than letting it reach values no model can complete in.

## Model kwargs, and the two shapes a value can take

`lib/kwargs.js` (server) and `src/kwargs.js` (client) are **parallel implementations of the same rules**, and they must agree: the client renders the control and previews the payload, the server decides what is actually sent. A divergence shows up as an admin editor that promises one request body and a backend that sends another. There is a client test asserting the two match on detection, clamping and defaults — extend it when you touch either file.

A kwarg carries its value in one of two ways, and `isRange(def)` is the only thing that distinguishes them:

- **A value list** (`values: ['low','medium','high']`). `controlOf` picks a toggle for a true/false pair, a dropdown above five entries, and the segmented `slider` otherwise. A request is honoured only if it is *in the list*.
- **A number range** (`min`, `max`, `step`), which is what makes something like `thinking_budget_tokens: 300` expressible — enumerating 0…4096 never was. `controlOf` returns `range` and the user gets a real draggable `<input type="range">`.

Rules that hold the range design together:

- **A range clears `values` in `normalizeKwarg`.** Two sources of truth for "what may be sent" is how you get an editor showing a list next to a slider that ignores it. The editor's two link buttons (*use a slider instead* / *use a fixed list instead*) are the only way to move between the shapes, and each clears the other's fields.
- **The bounds are enforced server-side, in `resolveKwargValues`.** The slider is a convenience; `clampToRange` is the guarantee. A hand-edited socket message asking for `99999` gets the admin's maximum, not an error and not the raw number — refusing outright would break a turn over a value we can obviously correct.
- **Both ends stay reachable even when they are off the step grid.** Snapping alone rounds a max of 2048 with a step of 100 down to 2000, so the number under the thumb could never equal the maximum printed at the end of its own track. `clampToRange` returns `min`/`max` verbatim outside the interior, matching what a native range input does at the end of its travel; everything strictly between them still snaps.
- **Steps are measured from `min`, not from zero**, so a range of 5–100 in tens gives 5, 15, 25 … and not 0, 10, 20. `stepDecimals` then rounds off float dust, or `0.1` steps produce values like `0.30000000000000004` in the request body.
- Hiding is orthogonal and already existed: `visible: false` removes the control while `sendWhenHidden` still sends the default, and `adminOnly` greys it out for users. Both work for ranges — that is the "no slider at all" case.
- A range parent has no enumerated values for a paired child to match on, so `KwargsEditor` offers such a child the single `*` catch-all rule instead of a per-value list.

### `showIf` gates a control; `parentId` replaces it

These look similar and are not. **`parentId` makes a kwarg fully derived** — it loses its control entirely and its value comes from the parent's `rules`. **`showIf: { id, value }` only gates visibility**: the kwarg keeps its own slider or toggle and simply does not appear while the named kwarg holds a different value. That is what lets a thinking budget show up only once thinking is switched on.

A closed gate is treated as a *kind of hidden*, so `kwargVisible` is `visible !== false && gateOpen(...)` and everything downstream — the picker's control list, its chips, and `kwargPayload` — asks that one question rather than reading `visible` directly. The consequence worth knowing: **`sendWhenHidden` decides what a gated-off kwarg does**, exactly as it does for an admin-hidden one, and it defaults to still sending. That is deliberate for the budget case, where sending a budget while thinking is off is harmless, but it means "hidden" never silently means "not sent".

The gate is display-only in one further respect: a request that names a gated-off kwarg is still honoured, because the value belongs to the user and should survive toggling thinking off and on again. Only `adminOnly` actually refuses a requested value.

Gates are sanitized like `parentId`: a self-reference or a pointer at an id that does not exist is dropped on write. Only a kwarg with discrete `values` may gate another — `gateValues` in the editor excludes ranges, since "show when the budget is exactly 3072" is never what anyone means.

`target` decides where the value lands, and **two of the three nest while one does not** — getting this wrong produces a request the server silently ignores, with no error anywhere:

| Target | On the wire |
| --- | --- |
| `chat_template_kwargs` (default) | `{"chat_template_kwargs": {"enable_thinking": true}}` — what a chat template reads for values it uses itself |
| `body` | `{"thinking_budget_tokens": 1024}` — a plain field beside `model` and `messages` |
| `extra_body` | `{"extra_body": {...}}` — a literal nested object |

**`extra_body` is a client-side SDK concept, not a wire format.** The OpenAI SDKs take `extra_body={...}` and *flatten it into the top level* before sending; the server never sees a key called `extra_body`. Ours sends it nested, which llama.cpp and vLLM ignore outright. So the target that reproduces what an SDK's `extra_body` does is **`body`**, and the `thinking_budget_tokens` preset uses it. The nested target is kept only for gateways that genuinely unwrap it, and `TARGET_NOTE` in `KwargsEditor.jsx` says so at the point of choice — this cost a real debugging session once.

For the same reason `PayloadPreview` renders the **whole request body** (`model` and `messages` elided) rather than just the kwarg fragment: `{"extra_body": {"x": 1}}` and `{"x": 1}` are indistinguishable at a glance when shown alone, and they are the entire difference between working and not.

`RESERVED_BODY_KEYS` blocks a top-level kwarg from overwriting `model`, `messages`, `tools` and friends.

## Tool reliability telemetry

`lib/toolstats.js` counts every tool call by `(model, tool)` in the `toolstats` table: successes, failures, a breakdown by failure *kind*, and the last error text. `GET /api/admin/tool-stats` serves it and Admin → Analytics renders it, with a `DELETE` to reset.

The point is diagnosis, not accounting. Every harness bug fixed here so far was found because someone happened to be watching a chat and screenshotted it; a ranked failure list finds the next one without that luck, and shows whether a fix actually moved the number.

`classifyToolError` maps error text onto a fixed set of kinds (`cut_off`, `unknown_tool`, `missing_arg`, `no_match`, `blocked`, `missing_program`, `not_found`, `timeout`, `too_big`, `nonzero_exit`, `other`). It matches on the error strings the sandbox actually produces, so **changing an error message can silently reclassify a whole failure mode** — when you reword one, check `KIND_PATTERNS` and the test that pins each kind to a real message. Rows are aggregates rather than an event log, so the table stays small; `pruneToolStats` drops anything untouched for 90 days.

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

## Query in SQL, not in JavaScript

Rows are JSON blobs, which makes `db.<table>.all()`, `.filter()`, `.find()` and `.count(fn)` read *and `JSON.parse`* the entire table. They are convenient and they are the wrong tool for anything on a hot path. Four endpoints were built on them and each was quadratic in a way that only showed up with real data:

| Endpoint | What it used to do | Now |
| --- | --- | --- |
| `GET /api/search` | built a full message graph for **every chat the user owns, on every keystroke** — and evicted the open chat's cached graph from `lib/tree.js` while doing it | one `messages ⋈ chats` query per search |
| `chat_search` (the model-facing tool) | `db.messages.byChat()` for up to 300 chats, parsing the user's whole history on a single tool call | the same `messages.searchForUser` query, which now also returns `role` and takes a row limit |
| `GET /api/chats-overview` | loaded and parsed every message of each chat on the page to find one preview line | `messages.lastUserText`, one indexed lookup per chat |
| `GET /api/users/search` | parsed every user row per keystroke | indexed `users.search` |
| `GET /api/admin/audit` | pulled up to 100 000 rows into JS twice per request to filter, count and page them | filtering, counting and paging in SQL |

Two things make this possible without changing behaviour:

- **`oq_icontains` is a JS function registered on the connection.** SQLite's own `LIKE` and `lower()` fold ASCII only, so using them would have quietly stopped matching `ДОМ` against `дом`, which the JavaScript scans always did. The needle is lowercased once by the caller; only the haystack is folded per row. There is an end-to-end check for exactly that pair.
- **`json_extract` reads the one field a query needs** instead of parsing the whole row into an object.

`messages.attachmentUrls()` uses `json_each` over every message's attachment array to answer "is this upload still referenced by anything", which is what makes the two-phase upload purge above correct.

## Nothing off-origin may drive this server (`lib/origin.js`)

Auth is a cookie, so anything a hostile page can make the browser send arrives already authenticated. `sameOrigin(req)` is the single answer to "did this really come from our own UI", and both entry points use it:

- **HTTP**: `sameOriginGuard` runs before `express.json`, so a cross-origin `POST`/`PUT`/`PATCH`/`DELETE` is refused with 403 before its body is even parsed. `GET`/`HEAD`/`OPTIONS` pass through — they are not state-changing, and blocking them would break ordinary navigation.
- **WebSocket**: `verifyClient` in `lib/ws/connection.js` checks the origin *and* the session before the socket exists. `SameSite=Lax` does not reliably cover the websocket handshake, so without this a page on any other origin could open an authenticated socket and read the user's entire stream. There are handshake tests for 403 (wrong origin), 401 (no session) and 400 (wrong path).

**`Sec-Fetch-Site` is the primary signal, and comparing `Origin` to `Host` is not.** This is the thing to get right. The obvious check — does the Origin header match the Host header — is wrong the moment anything proxies, and it shipped broken for exactly that reason: Vite's dev proxy rewrites `Host` to the backend (`localhost:3001`) while forwarding the browser's `Origin` (`localhost:5173`) untouched, and sets no `x-forwarded-host`. Every write from the real UI was refused, so in `npm run dev` nothing could be sent, logged out, or streamed. A reverse proxy in production can do the same.

`Sec-Fetch-Site` does not have that problem: the *browser* computes it from the document's own origin against the request URL, before any proxy exists, and proxies forward it unchanged (verified against Vite's). So it is checked first, and `same-origin`, `same-site` and `none` pass while `cross-site` is refused — `none` being a typed URL or bookmark, which a cross-site page can never produce for a write.

Everything after it is a fallback for callers that do not send it, in order:

1. **A missing `Origin` is allowed.** Browsers attach it to every request a cross-site page can forge; curl, scripts and the CI liveness probe do not send it and cannot be driven by a hostile page. Rejecting on absence would break every non-browser caller and buy nothing.
2. **A literal `"null"` origin is refused.** That is what a sandboxed iframe or a `data:` document sends. It is not "absent" — it is an origin that deliberately carries no identity.
3. **`TRUSTED_ORIGINS`** (comma-separated env var) is the operator's escape hatch for a proxy that rewrites `Host` in front of a browser too old to send `Sec-Fetch-Site`.
4. **`Origin` host equals the request host**, taking `x-forwarded-host` when present. The plain unproxied case.
5. **Loopback to loopback.** The dev proxy on a browser that sends no `Sec-Fetch-Site` (Safari below 16.4): the page is on `localhost:5173` and we are answering on loopback. It widens the boundary only to other servers already running on this machine, which is the boundary every local dev tool works within — and it is a fallback, so it never applies to a browser that sent the header.

When changing any of this, test **both** `npm run dev` (proxied) and `npm start` (direct). The failure mode is silent and total: the UI renders fine and every button stops working.

The socket is bounded as well as authenticated: `maxPayload` caps a frame at 8 MB so nothing is buffered before it is inspected, and every field is normalized on arrival (`content` capped, `attachments` reshaped to `{url,name,type,size}` and capped at 20, ids required to be strings). Any of these arriving as an object used to reach `better-sqlite3` and throw; `db.*.byId` now returns `undefined` for a non-primitive id rather than throwing, which is the choke point for every route as well.

`clientIp` in `lib/audit.js` honours `x-forwarded-for` **only when `TRUST_PROXY` is set**. Read unconditionally, it lets any caller forge audit-log entries and — because the login limiter keys on it — hand themselves unlimited login attempts by rotating one header.

## A user-supplied regex runs somewhere killable

`search` with `regex: true` compiles a pattern a *model* wrote. Catastrophic backtracking is a property of the pattern and the text together, so inspecting the pattern alone only ever catches the shapes someone thought to look for, and once `RegExp.test` has started nothing in JavaScript can interrupt it — no timeout option, no step budget. On a single-threaded server one bad search stalls every request for every user, indefinitely.

So the regex path runs in a `worker_threads` worker that the parent kills after 5s (`sandbox/regexsearch.js`). That is the only sound fix short of adding a linear-time engine as a dependency. Two things make it cheap:

- **Only the regex path pays.** Plain substring search stays in-process, because `String.includes` cannot backtrack. Worker startup is ~25ms, which is nothing beside reading the files.
- **`compileSearchPattern` runs first** (`lib/sandboxguard.js`). It rejects a malformed pattern, one over 500 characters, and the classic `(a+)+` / `(x{2,})+` nested-quantifier shape — in under a millisecond, with an error that tells the model what to write instead, and without paying for a worker to discover it.

That static check is **deliberately narrow**: it looks for a quantified group whose body is itself quantified, and nothing else. Alternation under a quantifier, `(foo|bar)+`, can also backtrack badly but is overwhelmingly written on purpose; refusing it would break ordinary searching. There is a test listing the patterns that must keep working, and it should grow whenever the check does. Everything the static check misses — `(?:a|aa)+b` is the test case — is caught by the worker timeout instead.

**`ruleMatches` in `lib/router.js` goes through the same screen**, for a sharper reason: a routing rule is evaluated on *every turn* against whatever the user typed. It cannot afford a worker per turn, so it declines a pattern it cannot compile safely, exactly as it already declined a malformed one.

## Uploads are stored and served defensively

**`/uploads` requires a session.** Attachments are other people's conversations; a URL is not authorisation, however unguessable it is. A signed-out caller gets **404, not 401**, because whether a given upload exists is itself something only a member should learn.

Exactly one upload stays public, and the exemption is narrow by construction: the file currently named by the `app_icon` setting, because the sign-in screen shows it to someone who by definition has no session yet. `isPublicUpload` compares against that setting on every request, so changing or clearing the icon changes what is public with it — nothing is latched. If you ever add another asset the logged-out screen needs, extend that predicate rather than widening the mount.

The stored filename is a fresh uuid plus a normalized extension (`safeExt`: a short alphanumeric suffix or nothing at all); the user's own filename lives only in the message row. Serving adds `default-src 'none'; … sandbox` as CSP, `nosniff`, `Cross-Origin-Resource-Policy: same-origin`, and `Content-Disposition: attachment` for everything outside `INLINE_EXT`. So an uploaded `.html` downloads instead of becoming a live same-origin document, while images and audio — which the app renders through `<img>`/`<audio>`, where disposition does not apply — still display.

What this does *not* do is check which user an upload belongs to: any signed-in member who has the URL can fetch it. Closing that needs a per-request lookup from URL to owning chat on every image in a thread, and the exposure it removes is small next to what the session gate already closed.

Deleting a chat's uploads is deliberately two-phase (`attachmentUrlsOf` → delete the rows → `purgeUnreferencedUploads`). Fork and cherry-pick copy a message verbatim, attachments included, so one `/uploads` file can be referenced from several chats; unlinking everything the deleted chat pointed at silently broke the images in the copy.

### What the model can actually read is decided by the bytes, not the extension

Attachments were never sandbox-gated, which is what made the symptom confusing: with the sandbox **on** the same file was *also* copied into the workspace (`connection.js`), so tools could reach it, and it looked as though attachments only worked there. The real gate was `isTextLike`, a hard-coded list of 28 extensions in `uploads.js`. Anything outside it — `.toml`, `.kt`, `.swift`, `.vue`, `.env`, and every PDF, despite `.pdf` being advertised in the composer's `accept` — reached the model as the bare string `[Attached file: x]` and nothing else.

`historyMessage` in `convo.js` has four branches now, and the fallbacks are written for a model that would otherwise invent the contents:

1. image + `has_vision` → `readImageDataUri`
2. image without vision → a note saying the model cannot see it, so it says so instead of guessing
3. `isTextLike` → inlined, capped at 20,000 chars
4. anything else → a note naming the format and stating plainly that the contents are unavailable

`isTextLike` keeps the extension list as a fast path and otherwise **sniffs the first 4KB** (`looksTextual` in `lib/extract.js`): PDF and ZIP magic numbers, any NUL byte, more than 5% control characters, or a failed strict UTF-8 decode all mean binary. That is what makes a format nobody listed work without anyone maintaining a list.

PDFs are the exception that shaped the design. `readUploadText` is synchronous and the whole `chatHistory` → `buildMessages` chain above it is synchronous, so extraction cannot happen there. `POST /api/upload` extracts once, at upload time, into a `<file>.txt` sidecar that `readUploadText` prefers. `extractPdf` lived in **two byte-identical copies** (`projectfiles.js` and `membank.js`); it is now one implementation in `lib/extract.js` that all three import.

The edit path in `connection.js` also used to reuse `orig.attachments` verbatim, silently discarding anything newly attached while editing; it now merges by url and re-caps at `MAX_ATTACHMENTS`.

## Authentication and the sign-in screen

Three endpoints, and the split between the first two is the important part:

- `POST /api/auth/login` — **signs in only**. It used to create an account when the email was unknown, which meant a typo silently registered a second account. It now returns "Incorrect email or password" without saying which was wrong, so it is not an account-existence oracle. **The wording is only half of that**: an unknown address used to skip the argon2 verify entirely and answer in a fraction of the time, which is the same oracle measured with a stopwatch. `passwordMatches` always pays for one verify, against a lazily-created decoy hash when there is no account.
- `POST /api/auth/register` — **creates only**. Returns 409 on a duplicate, requires 8+ characters, and honours the `allow_signups` setting. The first account ever created is always allowed through regardless of that setting and becomes owner+admin, which is the bootstrap path.
- `GET /api/auth/context` — the one **public** endpoint (no `authMiddleware`). Returns `firstRun`, `allowSignups`, `appName`, `appIcon`, `appFont` and `uiPreset`.

`/api/auth/context` exists because `/api/app-config` is auth-gated, so before signing in the client knew nothing about the server. That is why the login screen used to render in the wrong preset on a first visit: the pre-paint boot script in `index.html` reads `localStorage 'oq-preset'`, which is empty on a new device, so it fell back to Anthropic. `App.jsx` now fetches the context on the `/api/me` failure path and applies preset, font and icon before rendering `Login`. Keep this endpoint free of anything an anonymous caller should not see — it is deliberately limited to branding and the two booleans the screen needs.

`POST /api/auth/check-email` was removed. Nothing used it after the flow split, and it answered "does this account exist" to anonymous callers. CI used to probe it as its liveness check; that job now lives in `test/http.test.js`, which asserts the whole sign-in loop rather than a status code, so check there before assuming nothing depends on an endpoint you are removing.

The login limiter keys on **both** the address and the account (`ip:` / `user:`), so one address cannot spray a whole user list and a botnet cannot grind one account from many addresses. Two details are load-bearing: the counter is cleared only after the *whole* login succeeds, so a stolen password cannot be used to grind TOTP codes without limit; and when the map is full it drops only what has aged out, because clearing it wholesale — which it used to do — let an attacker wipe every other address's counter with 5000 junk attempts.

**Registration counts under `reg:`, not `user:`.** Sharing the account key with login turned the duplicate-email 409 into a lockout: eight registration attempts against a known address locked its real owner out of signing in for ten minutes, from any device.

The session cookie is `HttpOnly; SameSite=Lax`, plus `Secure` **only when the request arrived over TLS**. Forcing `Secure` unconditionally makes the browser discard the cookie on a plain-http install and locks everyone out of an ordinary localhost deployment.

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

## The admin panel borrows the Settings controls, it does not reinvent them

Admin is the part of the app most likely to drift, because it is edited section by section. The rule is that **the User Settings dialog is the reference for every shared control**, and admin matches its metrics rather than growing its own:

- Text inputs, selects and textareas are **32px tall, 14px, 8px radius** — the same numbers `modals.css` gives `.modal-main input`. `admin.css` restates them for `.oqa` because admin is not inside a modal, but the values must stay in step.
- `SegPick` in `admin/widgets.jsx` is a thin adapter over **`SegSlide`** from `components/settingsui.jsx`, so every segmented control in admin is the same sliding-thumb control as Motion or Message density in Settings. It keeps its own `[value, label]` tuple API purely so the ~six call sites did not have to change; do not fork a second segmented control for admin.
- Buttons are `.btn` and its modifiers, including the ones that used to carry their own metrics (`.dash-action`). `.push-btn` only adds weight and `flex-shrink`, never a different shape.
- **Colour is the only thing that separates a CTA from an ordinary button.** Publish — `Push now` and the header `Push to all clients` — stays `.btn.primary` and keeps the accent fill; it does not get a different height, font or radius to stand out. Under the OpenAI preset the light accent is `#0d0d0d`, which reads as a hard black slab at 600 weight, so `openai.css` softens *only* that fill to `#3d3d3d` under `[data-preset="openai"][data-theme="light"]`. Do not fix that by changing `--accent`; links and highlights use it too.
- `.med-tabs` matches `.me-sec`: 9px 12px, 13.5px, an accent underline.

`.seg` (the older bordered segmented control) is still used by the usage-window tabs and the chats overview and is deliberately left alone — it is a different, denser context.

## The disclaimer is admin text, and may contain links

`cfg.disclaimer` is rendered by `components/Disclaimer.jsx`, not by a bare `<div>`. It parses `[label](url)` into real anchors and passes everything else through as text — never `dangerouslySetInnerHTML`, since the string is admin input. `safeHref` allows only `http`, `https`, `mailto` and same-site absolute paths; anything else is left as the literal markdown so it is visibly wrong rather than silently dropped. An empty disclaimer renders nothing at all.

Custom text goes through `t()` and therefore falls through untranslated, which is the honest outcome — the admin field says so.

## The chats overview must fill its own viewport

`ChatsOverview` pages 18 chats at a time and used to load more only from a `scroll` event. On a tall window 18 rows do not overflow `.co-body`, no scroll event ever fires, and the list is stuck at one page — which is why clicking **Select** appeared to reveal older chats: the bulk bar shortened the body enough to make it scrollable. Two effects now close that: one re-checks after every `chats` change and pulls another page while `scrollHeight <= clientHeight + 320`, and a `ResizeObserver` on `.co-body` does the same when the window or the bulk bar changes its height. Any other infinite list added here needs the same pair — a scroll handler alone is not enough.

## Adding a feature checklist

1. Build it plain (Anthropic look) first.
2. If the OpenAI skin needs different visuals, add scoped rules to `openai.css` only.
3. If it needs different *behavior*, branch on `cfg.uiPreset` and add the branch to the list above.
4. Verify both presets and both light/dark before shipping. Preset switching is live — test by toggling in Admin → Branding with a second window open.

## Handling untrusted input

Everything below has already caused a real bug here at least once.

**A lookup table indexed by a value from outside gets `__proto__: null`.** `PROVIDER_TYPES['constructor']` inherits `Object`, which is truthy, so `if (TABLE[req.body.type])` accepts it as a real entry and the next line reads a property off a function. `PROVIDER_TYPES`, `STRICT_ALIASES`/`LOOSE_ALIASES` (indexed by a tool name a model invented), `STYLE_PRESETS`, `DOCS` and the client's `EXT_LANG`/`EXT_COLOR` are all null-prototype for this reason, and there are tests asserting `constructor` and `__proto__` resolve to nothing. A fixed set of allowed values is a `Set`, not an object.

**Coerce and cap at the boundary, once.** A row is a JSON blob, so an unbounded string or object on a `PATCH` body grows a row that is then re-parsed on every request that touches it. `String(x ?? '').slice(0, n)` at the route, not `x` straight into the patch — `display_name` was storing whatever it was given, including objects. `prefs` is the one free-form bag and is bounded by serialized size rather than schema.

**`PATCH /api/admin/settings` does this from a table, not from 40 hand-written `if` lines.** `SETTING_FIELDS` in `routes/settings.js` maps each body key to its setting key and its shape (`bool`, `enum`, `int`/`num` with bounds, `text` with a cap, or a `map` function), and `coerceSetting` is the single place a value is turned into what gets stored. Both are exported so the coercion is unit-tested without booting a server. The table is null-prototype for the reason above: it is indexed by a key straight off the wire. Adding a setting is one row — writing another `if ('x' in req.body) setSetting(...)` beside it reintroduces exactly the drift this replaced, where `apiBaseUrl` stored whatever object it was handed and `appName` threw a 500 on `.trim()` when sent a number.

**`req.body` is normalized to `{}` by one middleware, immediately after `express.json()`.** Express 5 dropped Express 4's habit of always defining `req.body`; it is `undefined` whenever nothing parsed a body, which is any request with no `Content-Type` and any bodyless `PATCH`/`PUT`/`DELETE`. Route handlers read it directly — `'title' in req.body`, `req.body.styles`, `req.body.messageId` — so without the middleware every one of those is a `TypeError` and a 500 rather than a clean no-op. Roughly fifteen endpoints across `auth`, `chats`, `models`, `projects`, `spaces` and `media` were affected. Multer assigns `req.body` itself when it runs, so seeding an empty object first cannot mask a multipart upload. There is an `http.test.js` case sending real bodyless writes; a unit test cannot see this, because nothing in one starts a server.

**Never index the database with something you have not type-checked.** `db.*.byId` returns `undefined` for a non-primitive rather than letting `better-sqlite3` throw, which is what turned "look up this thing" into a 500 in any route that forgot to coerce. `update`, `removeById` and `removeByIds` apply the same `isKey` guard, so the whole accessor surface fails the same way instead of only reads being safe. Websocket handlers must still check `typeof chatId === 'string'` themselves, because they are outside the express error handler.

**`getSetting` hands back the cached object, not a copy, so a setting value is never mutated in place.** `setSetting` stores the same reference it was given, and callers that cache derived work compare that reference by identity to decide whether to recompute. `applySunsets` used to patch the `published_models` array in place and hand the same array back to `setSetting`; the identity never changed, so `shapeCache.published` and `snapIndex` in `lib/models.js` both kept serving pre-sunset data. A model whose retirement date had passed went on being listed as available *and* stayed runnable for every non-admin user until the process restarted. Build a new array, then call `invalidateModelShapes()`.

**An id from a request body must be checked against the resource it will be used on.** `regenerate` accepted a `messageId` from any chat and wrote its parent into *this* chat's `active_leaf`; the fix is one `target.chat_id !== chat.id`.

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

- `db.js` — encrypted SQLite (better-sqlite3-multiple-ciphers) with JSON-blob tables; exports `db.<table>` accessors plus `uid`, `now`, `getSetting`, `setSetting`. Data lives in `server/data/` (gitignored). See "Query in SQL, not in JavaScript" below before adding an accessor.
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
  - `ignore.js` — `extOf`/`isText` plus dependency, build and `.gitignore` filtering. Owns the gitignore cache; `files.js` drops entries through `gitignoreCacheDrop` rather than reaching into the `Map`. The cache is bounded at 32 chats like `meta.js`'s, or it grows one entry per chat for the life of the process.
  - `zip.js` — the zip codec (`zipBuffer`, `unzipBuffer`). Pure: no filesystem, no chat id. `unzipBuffer` inflates under a `maxOutputLength` and a running total (64 MB per entry, 256 MB per archive), because `extractZip`'s own size check happens *after* the entry is already expanded in memory — a few hundred kilobytes of zeroes deflates small enough to exhaust the heap before anything got to look at it.
  - `files.js` — the versioned workspace filesystem: list, read, write, edit, tree, search, find, and the zip wrappers that touch disk. **`list()` only counts hidden files when asked for them.** The count is what the `(N file(s) inside dependency or build folders …)` line in the sandbox prompt reports, and producing it means walking every ignored directory to the bottom — all of `node_modules`, `.venv`, `target`. Exactly one caller wants it (`sandboxPromptFor` in `lib/prompts.js`, via `withHidden: true`); the plain `sandbox.list(chatId)` that `turn.js` broadcasts after every file-mutating tool call, and the six calls in `routes/artifacts.js`, all discarded it. On a workspace with 6 000 files under `node_modules` that walk was the entire cost of the call: 15.6 ms against 0.8 ms without it.
  - `hostenv.js` — `pickShell` and the PATH-scanning host detection described under "The sandbox harness".
  - `shell.js` — `bash`, the cmd.exe/POSIX wrapper and `winTranslate`. The transcript is kept as a bounded head plus a rolling tail rather than one growing string: only the first `OUT_CAP` characters are ever shown and only the last line carries the cwd marker, so buffering everything a process may emit held up to 12 MB per concurrent command to produce 20 KB of output.
  - `args.js` — the argument readers (`argText`, `argPath`, `argBool`, …) that absorb the many spellings models use for the same argument.
  - `exec.js` — `execTool`, a **dispatch table** keyed by canonical tool name. Adding a tool is one entry plus one schema in `tools/schemas.js`; handlers receive an already-normalized relative path and never re-validate one.
- `websearch.js`, `membank.js`, `skillsys.js`, `mcp.js`, `projectfiles.js` — self-contained tool backends (each exports `execTool`/`promptFor`/`resultPayload`/`formatResult` variants).
- `totp.js` — 2FA secrets, verification, recovery codes.

### Shared logic (`server/lib/`)

- `appconfig.js` — `APP_VERSION` + `appConfig()` (the `GET /api/app-config` payload).
- `audit.js` — `logAudit`, `pruneAudit`, `clientIp` (which trusts `x-forwarded-for` only under `TRUST_PROXY`).
- `origin.js` — `sameOrigin`, `sameOriginGuard`, `requestHost`. Pure, no imports, covered by tests. See "Nothing off-origin may drive this server".
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
- `tree.js` — message branching tree: `activePath`, `ensureChain`, `childrenOf`, `leafUnder`, `sortedMsgs`. All of these share one per-chat graph (`graphOf`) cached against `db.messages.version()`, so a chat's messages are loaded and parsed once per mutation rather than once per call. Do not go back to loading messages directly in these helpers. `leafUnder` descends via `preferredChild(kids, onPath)`, which follows the **currently active branch** when a node has several children and only falls back to the newest sibling when none of them is on the active path. Without that preference, selecting any ancestor silently moved the conversation onto whichever sibling happened to be created last, which is why the branch map must never be wired straight to a plain last-child walk. **Take the graph after anything that can write, never before.** `ensureChain` backfills `parent_id` on chats saved before branching existed, and that write bumps `db.messages.version()`, so a graph captured ahead of it is stale — every message still hangs off `null`, `kids.get(cur.id)` is empty, and `leafUnder` returns the node it was handed instead of descending. It reads `activePath` (which calls `ensureChain`) first for that reason.
- `llamacpp.js` — llama-server integration: `/props` and `/slots` for exact `n_ctx`, `/apply-template` plus `/tokenize` for exact prompt token counts (`llamaTokenCount`), and `isContextOverflowError` for recovering from context overflow. Results are cached; llama.cpp is the default provider type.
- `uploads.js` — `UPLOADS` dir, multer `diskStore`, the `uploadHeaders` serving middleware, attachment readers (`readUploadText`, `readImageDataUri`, `isTextLike`), and the two-phase `attachmentUrlsOf` / `purgeUnreferencedUploads`.
- `ws/` — the websocket engine, re-exported from `ws/index.js`: `broadcast.js` (the `clients` map, `broadcastConfig`, `broadcastAdminConfig`, `broadcastToUser`, `killSessionSockets`, `requestedKwargs`), `live.js` (the in-flight turn registry), `turn.js` (`runCompletion`, the agentic tool-call loop, plus `maybeCompact`), `connection.js` (`initWs(server)` and the `chat`/`regenerate`/`edit`/`incognito`/`stop` handlers). `runCompletion` is module-scope and takes `(ws, state, safeSend, chat, model, ...)` rather than closing over the socket. **`lib/ws/` must never import from `routes/`** — dependency direction is routes → lib.

### Turns outlive sockets (`lib/ws/live.js`)

A generation belongs to the *chat*, not to the socket that started it. `live.js` keeps one record per in-flight chat turn (accumulated content, reasoning, phase, tool preview, steer notes, prefill status) plus the global `aborts`/`steers` maps keyed by chat id, and `sendLive` fans every event out to **all** of that user's sockets while folding it into the record. Consequences to preserve when editing this area:

1. `connection.js` passes `liveWs`/`liveState`/`liveSend` into `runCompletion` instead of the raw socket, so a reload, a dropped connection, or a second tab never truncates a reply.
2. Socket close aborts **only** incognito turns (they are per-socket by definition and are never persisted). Saved chats keep generating and land in the DB as normal.
3. Every new socket is handed `{ type: 'resume', turns: [...] }` before anything else. `App.jsx` seeds its `gen` map from that and calls `syncView()`, which is what makes a mid-stream refresh pick the response back up rather than waiting for `done`.
4. Because `aborts` is keyed by chat rather than by socket, Stop and steering work from a freshly loaded page — both paths ownership-check the chat against the session user first.
5. One turn per chat: a second `chat`/`regenerate`/`edit` for a chat that already has a live turn is rejected. `beginTurn` is paired with `endTurn` in a `finally`, and records older than 45 minutes are treated as stale, so a crashed turn can never wedge a chat permanently.
6. The client mirror of this is `App.jsx`'s `gen` map, which is a **ref** so a token never re-renders the tree. `busyChats` state is the one thing derived from it, refreshed only by `syncBusy()` and only when membership actually changes; `Sidebar` turns that into the pulsing `.row-busy` dot and a Stop entry on rows generating out of view. Every mutation of `gen` goes through `queueRec`/`dropRec`/`recFor` so the mirror cannot drift — do not call `gen.current.set/delete` directly.

### A queued message may only be sent from `finalize()`

While a reply streams, `App.jsx` renders it by force-appending the streaming placeholder to the **end** of the list (`renderList` pins `streamKey` last). So the ordering invariant is: **nothing may be appended to `messages` between `done` arriving and `finalize()` committing the reply.** Break it and every following turn renders one slot out of place — the queued user message sits above the answer it came after — and it stays wrong locally, because the `refreshMessages` that would repair it is cancelled by the next turn bumping `refreshSeq`. Only the last turn in a run gets corrected, which is why the bug looks like the thread "settling" at the end.

`done` therefore commits nothing itself. It sets `nextTurnPending` and `pendingDone` and leaves; the reveal loop calls `finalize()` when the typewriter catches up, and `finalize()` calls `startNextTurn()` **after** its `setMessages`. `startNextTurn` is the single place a queued send or a compare-mode regenerate is dispatched.

Details that are load-bearing:

- **`done` finalizes immediately when there is nothing left to reveal** (`dispLen >= targetContent.length`), not only when `animate` is off. The reveal interval is the only other caller, and an `error` earlier in the turn has already run `stopLoops()` — without this check a turn that errored then completed would leave `nextTurnPending` set with no loop alive to drain it, and the queue would stall silently for the rest of the session.
- **`start` clears `nextTurnPending` before its catch-up `finalize()`.** A new turn is already running, so dispatching another send there would be refused by the server's one-turn-per-chat guard and the message would be lost. Clearing it instead leaves the item in `queuedList` to drain at *that* turn's `done`.
- **The compare `remaining.shift()` happens in `startNextTurn`, not in `done`.** Shifting at `done` discards the id if the continuation never runs.
- `finalize()` skips the `setMessages` append entirely when content and reasoning are both empty, so a turn that produced nothing does not flash an empty assistant bubble before `refreshMessages` removes it.

Server side, the pairing rule is that **`done` and `endTurn` must land in the same tick.** `runCompletion` generates a chat's title after sending `done`; awaiting it kept `live.activeTurn(chat.id)` true for the length of an extra LLM call, so the client's queued send arrived while the turn still looked live and was rejected — the user message was never even inserted, since that check runs before the insert. Title generation is now detached (`.then(...).catch(() => {})`) so nothing async separates `done` from the `finally` that ends the turn. The trade-off is that the title call escapes `runQueued`, so with `model_queue` on it can overlap the next turn; that is preferred over dropping a message.

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
- `src/lib/reveal.js`: how a streaming reply appears. `REVEAL_STYLES`, `resolveReveal`, `legacyRevealStyle`, `revealSpeedMs`. Pure and import-free, so it is unit-tested and no consumer can disagree about the rules. See "Motion and the text reveal are two separate prefs".
- `src/lib/threadmeta.js`: `railItems` (rail model derived from the message list), `previewOf`, `hasToolCall`, plus `buildTree`/`collapseRuns` shared by the branch map. Note `lib/artifacts.js` exports its own `buildTree` and `collapseRuns` for files and diff rows — same names, unrelated shapes; do not merge them.
- `src/lib/drafts.js`: `useDrafts(skipRef)`, the unsent-composer-text persistence described under "Composer drafts". The ref is what suppresses writes in incognito, and it is passed rather than read so the hook has no knowledge of chat state.
- `src/styles/` — `app.css` imports everything; `openai.css` is the OpenAI preset (always last). Others: `base`, `layout`, `chrome`, `chat`, `composer` styles live across `polish`, `extras`, `modals`, `admin`, `artifacts`, `fonts`, `threadnav`.
- `src/styles/threadnav.css`: thread rail, find bar, branch map, `.skip-link`, `.sr-only`, the `.kb-focus` ring, and the thread occlusion rules. Imported second-to-last, immediately before `openai.css`.

### Components (`src/components/`)

- `AdminPanel.jsx` — admin shell: tab navigation, models list/publish flow, branding, members, settings tabs. Tab ids: `overview, models, providers, branding, home, members, websearch, membank, voice, safety, memory, skills, mcp, feedback, limits, audit, analytics`.
- `admin/widgets.jsx` — shared admin primitives: `Card`, `Toggle`, `IconSlot`, `IconCropModal`, `SystemPromptEditor`, `QpIconPicker`, `AutosaveNote`, `CopyBtn`, `StatusChips`, `Grip`, `bgPreviewStyle`.
- `admin/ModelEditor.jsx` — the per-model editor (sections: General, Intelligence, Abilities, Style, Tuning; `ME_SECTIONS`).
- `Composer.jsx` — the input: slash commands, style menu, sandbox/web-search toggles, saved prompts, send/queue/steer. Attachments and dictation are **not** here: they are `useAttachments` (`lib/attachments.js` — the file list, drag state, paste, object-URL lifetime and the dominant-colour glow) and `useDictation` (`lib/dictation.js` — both the browser `SpeechRecognition` path and the `MediaRecorder`-plus-server path). Each owns its own state and cleanup, so neither can leak an object URL or leave a recorder running when the composer unmounts.
- `Message.jsx`, `Markdown.jsx`, `CodeBlock.jsx`, `ReasoningBlock.jsx`, `StreamingText.jsx`, `ToolCard.jsx` — message rendering pipeline.
- `Sidebar.jsx`, `ChatMenu.jsx`, `ChatsOverview.jsx`, `SearchModal.jsx`, `BranchCompare.jsx` — navigation and history.
- `CtxGauge.jsx`: the persistent context fill beside the model picker, behind the `ctxGauge` pref (default off). It follows the picker: composer under the Anthropic preset, topbar under OpenAI. Rendered from one `ctxGaugeEl` in `App.jsx` so the two sites cannot drift. Reads `GET /api/chats/:id/context`, which counts with the real tokenizer when the backend has one. It measures against the **budget** (window minus the reply reserve), not the raw window, because the raw window reads empty right up to a truncation. Deliberately not recomputed on keystrokes: each refresh is a live `/tokenize` round trip, so it is keyed on chat, model and the last message id, debounced 350ms, and skipped entirely while streaming.
- `ThreadRail.jsx`: the conversation minimap pinned to the right edge of `.main`. One `IntersectionObserver` rooted on `.scroll-area` tracks which turns are on screen (there is deliberately no pixel measurement, so it survives streaming and reflow); one `ResizeObserver` compresses the tick gap to fit. Hidden below 4 messages and under 900px.
- `ThreadFind.jsx`: in-thread find. Flattens thread text nodes into a single string plus an offset index, so matches spanning inline elements are found, then paints via the CSS Custom Highlight API (`CSS.highlights`, styled by `::highlight(oq-find)` / `::highlight(oq-find-active)` in `threadnav.css`). Where the API is missing it still navigates by message. Recomputes on a `revision` prop rather than watching the DOM.
- `BranchTree.jsx`: the branch map modal (lazy-loaded, own chunk). Renders the whole message graph: linear runs collapse into a single column and fold above 6 nodes, fork points split into parallel branch columns, the active path is highlighted. Clicking a node already on the active path jumps to it in the thread (`onJump`); clicking anything else switches branches via `selectBranch`. Keep that split: making every click switch branches means clicking a shared ancestor mutates the conversation the user was only trying to look at.
- `ArtifactsPanel.jsx` — the sandbox file browser: tabs, split panes, resize, the file tree. The pieces live under `components/artifacts/`: `Viewer.jsx` (one file — code, diff, preview, image, live-write follow, find-in-file), `FileTree.jsx` and `FileChip.jsx`. Everything pure sits in `lib/artifacts.js` (`diffLines`, `stableLineDiff`, `collapseRuns`, `splitHighlightedLines`, `markLine`, `findMatches`, `buildTree`, plus the extension tables), which is why that logic is unit-tested rather than only exercised by eye.
- `ProjectsPanel.jsx`, `SpacesPanel.jsx` — projects and spaces UIs.
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

`cd server && npm test` is `node --test`, which **discovers** every `*.test.js` under `server/`. There are two files and they answer different questions. Do not replace the discovery with a named list, or a new test file silently stops running in CI.

### `test/http.test.js` — the real server, started the way it ships

This boots `index.js` as a child process against a throwaway database on an ephemeral port, then drives it over `node:http` and `ws`. `node:http` rather than `fetch` on purpose: `Origin` and `Sec-Fetch-Site` are *forbidden header names* in a browser and undici may refuse to set them, and reproducing exactly what a browser sends is the entire point.

**It exists because 128 unit tests passed while every button in the app was dead.** The CSRF guard compared `Origin` against `Host`, which is right until something proxies — and Vite's dev proxy rewrites `Host` while forwarding `Origin` untouched. Under `npm run dev` nothing could be sent, logged out, or streamed. Nothing in a unit test starts a server, and the CI smoke script it replaced drove the server with `curl`, which sends no `Origin` at all, so neither could see it.

So the assertions are header shapes, not just status codes: a browser on this origin, a browser behind a dev proxy (`Origin` and `Host` disagreeing) with and without `Sec-Fetch-Site`, a cross-site page, a sandboxed iframe's `null` origin, and a non-browser caller with no `Origin`. Same again for the websocket handshake, plus a frame sent on an open socket that must be answered — the user-visible symptom was a send button that did nothing, so "it opened" is not enough. Reverting `lib/origin.js` to the broken version fails exactly two of these; that is the check to repeat if you touch it.

Also covered: the whole sign-in loop including that logout genuinely revokes, uploads serving (disposition, CSP, honest 404s), profile input validation, and that unknown `/api` routes answer in JSON while client routes still reach the app.

Two mechanical details. The database is `OPEN_QUILL_DB=oqhttptest`, removed before *and* after, so a crashed run cannot poison the next one. And teardown waits for the child to actually exit before removing it — Windows keeps the SQLite file locked until then, and `kill()` only asks.

### `test/logic.test.js` — pure logic

It covers the logic that is easy to break silently: kwarg resolution and pairing chains, text tool-call parsing (including the negative cases where prose or an unknown tool name must NOT become a call), compaction thresholds and in-turn tool trimming, llama.cpp overflow detection, the Windows command translation, the sandbox path/command guards, tool-name alias resolution, and `preferredChild` from `lib/tree.js`. Add cases here when touching any of those; they are cheap and they have already caught real regressions.

The **sandbox tool tests deliberately touch a real temporary workspace** (`oq-test-sandbox`, removed before and after each case). That is not laziness about mocking: `node --check` and even importing a module both pass while a handler references an identifier it never imported, because the reference is only resolved when the handler runs. Splitting `sandbox.js` produced exactly that bug — `list()` called `readMeta` without importing it, and every static check was green. Only running the tool caught it.

CI syntax-checks every `.js` file under `server/` via `find`, so new files and folders are covered automatically. Do not replace that with a hand-written file list.

**Adding an endpoint or middleware means an `http.test.js` case, not just a `logic.test.js` one.** Anything that depends on middleware order, a header, a cookie or the websocket handshake is invisible to a unit test by construction.

## Scrolling containers

Never write `overflow-y: auto` on its own. Per spec a `visible` axis paired with a non-`visible` one computes to `auto`, so it silently creates a **horizontal** scroll container too — that is what once hid the "More models" submenu behind a sideways scrollbar. Always `overflow: hidden auto`. All 41 pre-existing instances were converted; `.katex-display` is the one intentional exception, since it pairs `overflow-x: auto` with `overflow-y: hidden` on purpose.

This is safe across the app because wide content already scrolls inside its own container: `table` is `display: block; width: max-content; overflow-x: auto` in `chat.css`, `pre` carries `overflow-x: auto` in both `.code-wrap` and `.art-md`, and `.katex-display` handles wide formulae. Anything new that can exceed its column needs the same treatment rather than relying on an ancestor to scroll sideways.

The sidebar chat list adds stepper arrows at each end of its scrollbar via `::-webkit-scrollbar-button`. Firefox has no equivalent, so `.chats-arrow` DOM buttons are rendered behind `@supports not selector(::-webkit-scrollbar-button)` — they appear only in engines lacking the pseudo-element, which keeps Chrome and Safari on the native-looking steppers and avoids double arrows anywhere.
