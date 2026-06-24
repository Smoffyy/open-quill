# Changelog

All notable changes to **open-quill** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2027.0.0] — 2026-06-24

> **Breaking:** This release replaces the plaintext `data.json` store with an encrypted SQLite database and is **not backward compatible** with previous versions. There is no automatic import; a fresh database is created on first run and the first account to sign in becomes the owner.

### Added
- **Encrypted database** - all data now lives in an encrypted SQLite database (`better-sqlite3-multiple-ciphers`, AES-256 / SQLCipher) instead of a plaintext JSON file. Runs in WAL mode with foreign keys, prepared statements, and indexes on the hot paths for faster, safer reads as data grows.
- **Encryption key management** - the database key is read from the `DB_ENCRYPTION_KEY` environment variable, or auto-generated and stored at `server/data/.dbkey` (permissions `0600`). The key must stay paired with the database to open it.
- **Consolidated data directory** - the database, encryption key, uploads, and sandbox now all live under a single `server/data/` folder (git-ignored), keeping the server directory clean.
- **Exporting/Importing of User Chats** - allows users to export or import their chats properly.
- **Spaces** - allows users/admins to share a chat with an assistant, collaborating on projects locally.
- **Session management** - logins now create a tracked session bound to the auth token. A new Sessions tab under Settings lists every signed-in device with its browser, OS, IP, and last-active time, and lets you revoke any individual session or sign out everywhere else. Revoking a session immediately disconnects its live websocket.
- **Sliding 30-day session expiry** - a session stays valid as long as it is used. Each authenticated request refreshes its activity timestamp; after 30 days of inactivity the session expires and the user is asked to sign in again.
- **Admin audit log** - a new Audit Log tab in the admin panel records sensitive actions (model create, update, and delete, model publish, provider create, update, and delete, settings changes, user role changes, and user deletions) with the actor, timestamp, affected target, and originating IP. Entries are paginated and load on demand.
- **Audit retention** - audit entries older than 120 days are pruned automatically at startup and once per day.
- **Recognized model pricing presets** - a built-in price table covers common hosted models (GPT, Claude, Gemini, DeepSeek, Mistral, Kimi, Grok, and Llama families). When a new model's ID matches a known name, its input and output prices are filled in automatically. Local or unrecognized models stay blank.
- **Pricing override controls** - the model editor now shows when an ID is recognized and offers a one-click "Apply preset" action plus a "Clear price" link, so admins can accept, override, or remove the suggested price at any time. Manual prices are never overwritten by a preset.
- **Usage time windows** - the personal Usage tab can now be filtered to the last 7, 30, or 90 days, or all time, and reports how many generations fall in the selected window.
- **Usage budgets** - admins can set monthly spend caps per role (users and admins) and per individual user, based on each model's configured price. A warning banner appears in the composer once a configurable fraction of the budget is used, and an optional enforcement mode pauses new messages for anyone at or over their cap until the start of the next month. Admins are never blocked. The budget banner reuses the model-unavailable banner style and stacks above it.
- **Two-factor authentication** - users can enable TOTP-based two-factor from a new Security tab in Settings. Setup shows a secret key and an otpauth setup URL for any authenticator app, verifies a code before turning on, and issues one-time recovery codes. Login gains a second step that accepts either an authenticator code or a recovery code. The entire implementation is local and uses no external services or new dependencies; codes are computed with Node's built-in crypto.
- **Password change** - the Security tab lets a signed-in user change their password after confirming the current one. Changing the password signs out all of that user's other sessions.
- **Configurable session policy** - admins can set how many days of inactivity end a session and cap the number of concurrent sessions per user (oldest sessions are signed out beyond the cap).
- **Admin usage dashboard** - a new Usage & Pricing tab in the admin panel shows account-wide token and cost totals over 7, 30, or 90 days, broken down by user and by model.
- **Editable price presets** - admins can add custom price presets (a model-name fragment plus input and output prices) or override built-in ones from the Usage & Pricing tab. Custom presets are layered over the built-in table used for automatic price suggestions.
- **Audit log filtering and export** - the audit log can be filtered by action, actor email, and time range, and exported to CSV.
- **Per-user admin controls** - the Users tab now shows each user's two-factor status, month-to-date spend, and an inline monthly budget override.
- **Projects** - place to store entire projects at and chat with.

### Changed
- **Password hashing** - switched from bcrypt to **argon2id** (OWASP-recommended), with tuned memory/time parameters. Existing bcrypt hashes are not carried over (see breaking note above).
- **Complete chat deletion** - deleting a chat now also removes its uploaded attachment files from disk, in addition to the chat, its messages, and its sandbox (artifacts and version history). Applies to single-chat delete, "delete all my chats," and account deletion.
- **Admin user deletion** - removing a user now also deletes that user's sandboxes and uploaded attachments, matching the other deletion paths.
- **Starburst Icon** - fully centered all icons.
- **Usage cost accuracy** - each usage record now stores the price that was in effect at generation time. Models with no configured price are shown as "no price" rather than a misleading $0.00, and account totals indicate when a cost figure is incomplete because some models were unpriced.
- **Spaces assistant replies** - the in-space assistant now uses a short cooldown to avoid double-replies and detects when it is addressed by name or asked a direct question, making its decision to speak or stay silent more reliable.
- **Spaces invitations** - re-inviting a user who previously declined now re-sends the invite cleanly, duplicate and self-invites are rejected with clear messages, and spaces are capped at 25 members.
- **Session cleanup on deletion** - deleting a user (by an admin or via self-serve account deletion) now also removes that user's sessions.
- **Models panel** - the model list is now filterable once you have more than six models, and the core per-model toggles (default, extended thinking, hidden) are grouped into a single card for a calmer, less cluttered editor.
- **Session lifetime** - the signed token lifetime was raised to 90 days so the sliding inactivity window (default 30 days, now admin-configurable) is the real expiry, rather than the token expiring first.

### Security
- **Encryption at rest** - the database file is encrypted with AES-256; a leaked `data.db` is unreadable without the key.
- **Restrictive file permissions** - the database file and key file are created with `0600` (owner read/write only).
- **Referential integrity** - `ON DELETE CASCADE` foreign keys guarantee a chat's messages cannot outlive it at the storage layer.
- **Path-traversal guard** - attachment cleanup resolves filenames with `basename()` and verifies the resolved path stays inside the uploads directory before deleting.

### Removed
- **Legacy JSON store** - the `data.json` file, its debounced full-file rewrites, and corrupt-file backup handling are gone.
- **bcryptjs** dependency, replaced by argon2id.

### Performance
- **Reduced write amplification** - session activity timestamps are only written when at least 60 seconds have passed since the last update, avoiding a database write on every single request.
- **Bounded in-memory maps** - the spaces reply-cooldown map is capped to prevent unbounded growth on long-running servers.

---

## [2026.2.4] — 2026-06-20

### Added
- **Model Showcase** - customizable background per model, with a nice opaque UI.

### Fixed
- **Model Dropdown** - fixed a bug where if an input is too large, model dropdown would clip and not allow users to select models.

### Changed
- **Interface Aligment** - updated interface to match closely to anthropics official layout.

---

## [2026.2.3] — 2026-06-19

### Added
- **Folders** - organize chats into collapsible folders with drag-to-move and a "Move to folder" submenu in each chat's menu.
- **Incognito chat** - an ephemeral, fully local chat that's never written to disk. Toggle from the top-right ghost icon; the viewport fills with a white outline and the canvas switches to a dark palette. Sandbox and attachments are disabled in incognito.
- **Model draft / publish workflow** - admins now edit a private draft. Changes autosave and are visible only to admins (live across admin sessions), while clients keep using the last published config until an admin clicks **Push to all Clients**.
- **Mark models as unavailable** - admins can disable a model in real time. It stays in the dropdown but shows a banner with the model name and a developer-written "Learn more" reason, and clients are blocked from sending to it. Admins can still use unavailable models for testing.
- Pre-paint theme bootstrap so the saved theme is applied before first render.
- **Anthropic style theme** - Different color pallet, same functional interface!
- **Configurable Capability Icons** - Adds a little icon within the model, as well as making it compacted with just an info icon.
- **Quick prompt icons** - Each quick-prompt button now displays a themed icon (file, code, bulb, etc.) and can be set per-button in the admin panel. Default prompts include icons.
- **Sandbox tools badge** - Toggled tools in the + menu now show a small numbered badge on the icon itself rather than a separate pill.
- **Versioning** - General -> Version for a brief overview of the current version of the software.
- **OLED Burn-in protection setting** Enable the `OLED screen protection` setting in the Appearance menu.
- **Searxng Web Search** - Allows the assistant to call the web search tool (currently only searxng), with a custom web search prompt and more!

### Fixed
- **Theme flash on load** - the page no longer flashes light mode before switching to dark on startup.
- **Composer focus/blur** - the input bar now eases smoothly in both directions instead of snapping on blur.
- **Model dropdown z-index** - the menu no longer renders behind the quick-prompt buttons on the home screen.
- **Model dropdown "More models" submenu** - Fixed selection closing the menu, added hover delay and invisible bridge so models are now selectable without the submenu vanishing.
- **Quick prompt icon truncation** - Icons longer than 4 characters (pencil, coffee, learn, sparkles, search) were being silently corrupted. Now validates against the full allowed list.
- **Incognito transition smoothness** - Background colors and the incognito bar now fade in over 0.45s instead of snapping.
- **Sampling input visibility** - The number inputs in the admin sampling panel are now properly styled with visible text and themed backgrounds across all themes.
- **Image preview memory leak** - File preview blob URLs were never revoked on component unmount due to a stale closure in the cleanup effect.
- Removed the gradient sheen ("fade") on user message bubbles.
- Hardened folder operations with optimistic rollback on network failure, and made chat drag-and-drop read from the drag payload to avoid race conditions.
- The chat-row menu now dismisses on scroll/resize so it can't float detached.
- **Sticky Auto-Scroll** - Sticky Auto-Scroll causes screen glitches when scrolling while the assistant is generating text, resulting in an unsmooth transition between automatic and manual scrolling

### Changed
- **Composer input bar** - Raised minimum height from 26px to 31px for better visual balance.
- **Composer width** - Narrowed max-width from 760px to 675px to match official Claude interface proportions.
- **Active chat highlighting** - In the Anthropic theme, both hover and active states now use the user-message color (#121212) for consistency.
- **Model dropdown** - The + icon border outline has been removed, and models button styling refined.
- **Sandbox icon** - Changed from wrench to cube to better represent a sandboxed environment.
- **Anthropic theme refinements:**
  - Quick-prompt button background: #313130
  - Menu backgrounds (model dropdown, + menu, submenus): #313130
  - Greeting text opacity: lowered to 80%
  - Text selection: #121212 background with white text
- **Theme switching no longer animates** - the light/dark transition was removed entirely (it only ever risked flashing); the change is now instant.
- Models tab: removed the per-model Save button in favor of autosave-to-draft, with a new "Push to all Clients" control and a dirty-state indicator.
- Reverted the experimental "Fluid motion" animation tier and removed its settings toggle.
- Sidebar widened slightly (250px → 290px).
- **Artifacts Overhaul** - Overhauled Artifacts and tool-calling.

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
