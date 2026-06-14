# Changelog

All notable changes to **open-quill** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2026.2.3] — 2026-06-13

### Added
- **Folders** - organize chats into collapsible folders with drag-to-move and a "Move to folder" submenu in each chat's menu.
- **Incognito chat** - an ephemeral, fully local chat that's never written to disk. Toggle from the top-right ghost icon; the viewport fills with a white outline and the canvas switches to a dark palette. Sandbox and attachments are disabled in incognito.
- **Model draft / publish workflow** - admins now edit a private draft. Changes autosave and are visible only to admins (live across admin sessions), while clients keep using the last published config until an admin clicks **Push to all Clients**.
- **Mark models as unavailable** - admins can disable a model in real time. It stays in the dropdown but shows a banner with the model name and a developer-written "Learn more" reason, and clients are blocked from sending to it. Admins can still use unavailable models for testing.
- Pre-paint theme bootstrap so the saved theme is applied before first render.
- **Anthropic style theme** - Different color pallet, same functional interface!
- **Configurable Capability Icons** - Adds a little icon within the model, as well as making it compacted with just an info icon.

### Fixed
- **Theme flash on load** - the page no longer flashes light mode before switching to dark on startup.
- **Composer focus/blur** - the input bar now eases smoothly in both directions instead of snapping on blur.
- **Model dropdown z-index** - the menu no longer renders behind the quick-prompt buttons on the home screen.
- Removed the gradient sheen ("fade") on user message bubbles.
- Hardened folder operations with optimistic rollback on network failure, and made chat drag-and-drop read from the drag payload to avoid race conditions.
- The chat-row menu now dismisses on scroll/resize so it can't float detached.

### Changed
- **Theme switching no longer animates** - the light/dark transition was removed entirely (it only ever risked flashing); the change is now instant.
- Models tab: removed the per-model Save button in favor of autosave-to-draft, with a new "Push to all Clients" control and a dirty-state indicator.
- Reverted the experimental "Fluid motion" animation tier and removed its settings toggle.
- Sidebar widened slightly (250px → 290px).

---

## [2026.2.2] — 2026-06-12

### Added
- Chats Tab: allowing you to view all your previous chats in one spot! Cards show the title, your last message with a bottom fade, and a timestamp. They lift on hover, stagger in, and infinite-scroll as you go.
- Default model: mark one model as the default and it's pre-selected when a user first logs in (never resets on new chats).
- Model queue (optional): one model runs at a time, same-model requests run together, a different model waits its turn instead of swapping the loaded one mid-response.
- Per-role limits: separate Admin and User caps for attachment upload size and total sandbox storage per chat (0 = unlimited).
- Per-model icon animation styles: pick Spin, Breathe, Bounce, Wobble, Fade, or No motion for the Generating and Thinking logos.
- Model icon glow tinted from the logo's own colors (off by default, toggleable).
- Streaming cursor (off by default): a soft breathing cursor at the write position, in Block or Circle style.
- Reveal speed setting: tune the streaming reveal between 0–100 ms (0 = instant, default 40).
- Fluid animation pass: modal and panel entrances, smooth composer resize, reasoning expand/collapse, directional message entrances, chat-open stagger, theme cross-fade, copy/scroll/button micro-interactions. Every effect individually toggleable in Settings → Chat, and all of it respects the OS reduce-motion preference.
- 3 default greetings and 3 default quick prompts on fresh installs.
- Mid-response summarization: if a long tool-using response nears the context window, the conversation compacts and the assistant continues where it left off.
- Login brute-force protection (8 failed attempts -> 10-minute cooldown).
- Zip extraction limits (entry count + uncompressed size) to block zip bombs.
- Uploads are served with a strict Content-Security-Policy so SVGs can't run scripts.

### Changed
- Updated **ALL** dependencies to the **Latest** version (Express 5, React 19, Vite 8, react-markdown 10, bcryptjs 3).
- Refactored `Models` menu in Admin Panel into a master–detail layout with General / Reasoning / Capabilities / Context / Appearance / Sampling sections.
- Refactored `Chat` menu in User Settings into Streaming / Motion / Effects sections.
- Smoother streaming: faster reveal tick with an eased catch-up curve, and the live file viewer skips expensive language auto-detection while streaming.
- Database lookups by id are now O(1) via an in-memory index.
- Agent step cap is configurable per model with no upper limit.

### Fixed
- Fix `.reasoning-body` margin.
- Tools only execute after a step's stream completes. If you stop mid-step, the loop breaks before executing — completed files are now committed even when you press Stop.
- My "pending files" feature shows files in the tree from the streamed text before they're committed. Clicking one fetches from the server, which 404s.
- Pass committed to the Viewer so a pending (not-yet-written) file shows a placeholder and auto-loads once real, instead of erroring — and files already finished in the stream display their content immediately.
- Code copy bar 8px slot above bar.
- Copy buttons now work on macOS and over LAN (non-HTTPS) via a clipboard fallback, and only show "Copied" when the copy actually succeeded.
- Regenerating no longer deletes the message with nothing happening when the connection had silently dropped — sends are verified, the socket auto-reconnects, and your typed message is never lost.
- Deleted sandbox files no longer reappear in the artifacts tree; stopping mid-generation no longer loses already-created files.
- Model logo uploads save correctly again (field-name mismatch), along with the "More models" label and non-reasoning token.
- Tool chips no longer replay their entrance animation on every streamed token.
- Assistant messages no longer flash invisible for a moment when a response finishes.
- Sidebar chat rows kept their hover nudge after the entrance animation.
- The admin icon previews animate in a loop like they do in chat, and the reset X is centered.
- A disconnecting client now aborts its in-flight generation instead of leaving it running.

---

## [2026.2.1] — 2026-06-11

### Added
- Configurable user upload limit in the Admin panel.
- Model queueing, model awareness, if a new model is requested it will wait in queue. (Not recommended for external models, configurable in admin panel)
- More small animations.

### Changed
- Updated `baseline-browser-mapping` package. (2.10.34 -> 2.10.35)
- Updated `caniuse-lite` package. (1.0.30001797 -> 1.0.30001799)
- Updated `electron-to-chromium` package. (1.5.368 -> 1.5.371)
- Updated `shell-quote` package. (1.8.3 -> 1.8.4)
- Updated `Agent Step Cap` max to no upper-limit (Was 30)

### Fixed
- User uploaded zip file can't be extracted by assistant in artifacts sandbox on large files.
- Client and Server sync with files in sandbox.

### Removed
- `shell-quote` is a dev-only, transitive dependency (it comes in through concurrently, which only runs npm run dev). Never used during runtime at all.

---

## [2026.2.0] — 2026-06-11

### Added
- **First Release! This WILL contain bugs and not have all features implemented.**
