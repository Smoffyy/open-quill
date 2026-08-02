# Changelog

All notable changes to **open-quill** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [27.1.0] — TBD

### Added
- **Router models** - a router is a model you add like any other, except it does not talk to a backend itself. It sits in the picker, and when you send a message it hands the turn to whichever of your real models matches first. Rules are ordered and match on keywords, a regular expression, whether there is an image or an attachment, whether the message looks like code, or how long it is, with a catch-all fallback. So a small fast model can answer one-liners while anything with a code fence goes to your coding model, without you choosing every time. Routers can point at other routers; loops are detected and refused rather than left to spin, and a router with no fallback declines the turn instead of silently guessing. Set it up under the new **Routing** tab on any model. While a reply generates, the strip above the message bar shows which model was picked and why.
- **What gets sent** - a panel showing the exact prompt your conversation would send right now: the model's system prompt, your instructions, the conversation summary and memory bank, then every message, each with its token cost and a bar showing the proportions. Anything trimmed out is counted. `Alt+P`, or ask for it in the command palette. Previously the only way to know what the model actually received was to guess.
- **Copy a message from one branch into another** - right-click any message in the branch map. Retry a question three ways, then take the best answer and carry on with it, instead of losing two branches to keep one.
- **Privacy dashboard** - a new **Admin > Privacy** section listing every attempt this server made to reach another machine, whether it was allowed or blocked and why, with running totals. Kept in memory only, so it clears on restart.
- **Two-step shortcuts** - shortcuts can now be a leader key followed by a second key, like `Space` then `L`. Hold the leader for a moment and a panel lists everything bound to it, so there is nothing to memorise. Set them like any other shortcut in **Settings > Keybinds**.
- **Generation speed graph** - the engine strip now draws a sparkline of tokens per second across the response, so a model that starts fast and degrades as context fills is visible rather than averaged away.
- **No outbound internet connections, on by default** - the server now refuses to connect to the internet. Loopback and private network addresses still work, so a model backend or a local SearXNG on this machine or elsewhere on your LAN is unaffected, but anything pointed at a public address is blocked before a packet leaves. To use a cloud provider, add its host under **Admin > Safety** (one per line, `*.` covers subdomains) or turn the block off entirely. Blocked attempts explain themselves rather than failing as a generic network error.
- **Web search keeps working with the block on** - searching finds pages and then opens them to read, and those pages are on the internet even when the search engine itself is a SearXNG running on your own machine. Web search therefore has its own exemption, on by default and separately switchable, that applies to nothing else.
- **Local only, on by default** - the app now tells your browser it may not load anything from anywhere except your own server. Scripts, styles, fonts, images, media and network requests are all confined to this origin, so a page that tried to reach a CDN or an analytics endpoint would be blocked by the browser rather than trusted to behave. Under **Admin > Safety**; turn it off only if you point the app icon or background at a remote image URL, or if your artifact previews load libraries from a CDN. Requests your *server* makes to model providers are unaffected.
- **The build now fails if anything remote sneaks in** - `npm run build` checks the finished bundle for references to outside servers and stops with an error naming the file. Previously a dependency that quietly pulled a font or script from a CDN would have shipped unnoticed.
- **Signing in and creating an account are separate** - the old screen asked for an email, quietly looked it up, and then either signed you in or made you a brand new account depending on what it found. A typo in your email silently created a second account instead of telling you the password was wrong. There are now two clearly labelled choices, both with the email and password on one screen, and creating an account asks you to confirm the password.
- **Admins can turn off new accounts** - under Admin > Members. With it off the sign-in screen stops offering account creation and the server refuses registrations, while existing members carry on as normal. It stays on by default, which is how the app behaved before.
- **Custom keyboard shortcuts** - every shortcut can now be rebound from **Settings > Keybinds**. Click Change, press the combination you want, and it takes effect everywhere: the shortcut sheet, the command palette hints and the app itself all read the same list, so nothing can drift out of date. Conflicts are called out as you make them, and if you bind something the browser normally claims, you are told rather than left wondering why nothing happens.
- **Shortcut presets, backup and restore** - a Vim flavoured preset ships alongside the defaults, and your overrides can be exported to a file and loaded on another device. Individual shortcuts can be reset one at a time or all at once.
- **More things worth a shortcut** - the message bar, attachments, web search, sandbox, stop, incognito, light/dark, the context ledger, the artifacts panel, jump-to-latest, settings, and moving between chats all have bindings now. Defaults avoid combinations the browser or the OS already owns.
- **Full LaTeX environments** - `\begin{align}`, `equation`, `cases`, `pmatrix`, `gather`, `split` and the rest now render whether or not they are wrapped in `$$`. Models write them both ways and only one used to work.
- **Chemistry notation** - `\ce{}` and `\pu{}` are supported through KaTeX's mhchem extension, so reaction equations render properly.
- **Common maths shorthands** - `\RR`, `\NN`, `\ZZ`, `\QQ`, `\CC`, `\eps`, `\dd`, `\abs{}`, `\norm{}`, `\set{}`, `\argmin` and `\argmax` are predefined. Macros are scoped to the block that defines them, so nothing a model writes in one message can affect another.
- **Generations survive a refresh** - a reply now belongs to the chat, not to the browser tab that started it. Reloading mid-answer, dropping your connection, or opening the same chat in a second tab all pick the stream back up where it is, instead of leaving you staring at nothing until the model finishes. The server holds the in-progress text, reasoning, tool preview and prefill status, and hands all of it to whichever tab connects next.
- **Stop and steer work after a reload** - since a running turn is no longer tied to one socket, the stop button and mid-generation steering still control the reply on a freshly loaded page.
- **Router hop names display correctly** - the "via" chip now shows the correct model names by falling back through display_name, name, and internal_name, fixing the blank labels seen in previous builds.
- **Chat ownership verified before regeneration** - for `regenerate` requests, the system now checks that the chat belongs to the caller before routing, preventing errors where a router error string was incorrectly sent back.
- **Multi-step tool usage tracked correctly** - the client no longer shows a spurious "Continue" affordance for multi-step tool runs, as the usage counter now tracks only the final step completion.
- **Private IP range filtering tightened** - the egress filter now correctly treats the standard private ranges, ensuring only truly external connections are blocked while internal loops remain functional.
- **Dead code removed for efficiency** - several unused functions and redundant awaits have been stripped from the core logic, making the engine lighter and more responsive.
- **Memory bank and Sandbox performance boosted** - file operations for the memory bank and sandbox have been cached and optimized, significantly reducing I/O overhead during heavy usage.
- **Database operations streamlined** - model reordering and project deletion now use efficient transactions and index-based lookups, reducing load on the database server.
- **Password policy hardened** - password change now requires 8 characters, matching the registration requirement for better security.
- **Chats generating out of view are marked in the sidebar** - a reply already survives a reload or a switch to another chat, but nothing on screen said so, so leaving a slow model to run looked identical to nothing happening. Chats with a turn in progress now carry a pulsing dot in the sidebar, and their menu gains a **Stop generating** entry, so you can call one off without opening it first.
- **A context gauge that is there before you send** - a small how-full-is-the-window meter beside the model picker, showing the size of the prompt your next message would actually send: the whole conversation plus the system prompt, not just what is on screen. It amber-warns at three quarters full and reddens at nine tenths, so running out of room is something you see coming rather than something you discover. On a llama.cpp backend the number is counted by the model's own tokenizer rather than estimated. Off by default, under **Settings > Chat > Tools**.
- **Generation speed stays with the reply** - the engine strip fades a few seconds after a response finishes and takes its numbers with it, which makes comparing two models or two quantisations a matter of memory. Each reply can now keep the tokens per second it ran at, shown beside the model name on hover, along with prompt speed and output length. Off by default, under **Settings > Chat > Tools**.

### Changed
- **About 60% less to download on first load** - the startup payload went from roughly 570 KB compressed to 233 KB. Maths, syntax highlighting, the admin and playground stylesheets, and every translation except the one you are using are no longer part of it. Each loads when it is actually needed, or quietly in the background once the app is up. Nothing is fetched from the internet; everything still ships with the app.
- **Only your own language is downloaded** - all translations were bundled into the startup payload, so everyone paid for every language whether or not they read it. Each is a separate file now and only the active one is fetched. Adding more languages no longer makes the app slower to start for everybody.
- **Admin and playground styling loads with the screens that use it** - roughly 44 KB of stylesheet was being sent to every visitor for two screens most of them never open.
- **Uncommon code languages cost a few hundred bytes instead of 250 KB** - support for a language outside the common set used to mean fetching the entire highlighting library. Forty of the most likely extras are now individual files, so opening a GLSL or Dockerfile artifact fetches about 0.3 to 2.5 KB. The full library is still there as a fallback for anything rarer.
- **Syntax highlighting covers every language again** - the file viewer used to pull in support for all 190-odd languages up front just in case. The common set loads first now and the full set arrives only when a file actually needs a language outside it, then the view re-highlights itself.
- **Shortcuts are matched by physical key** - a shortcut is now identified by the key you pressed rather than the character it produced. `Ctrl` and `Cmd` are treated as one modifier so a single binding is correct on both macOS and Windows, and `Alt`/`Option` bindings work on macOS, where they previously could not.
- **Closing a tab no longer cancels the reply** - any dropped websocket used to abort whatever it was generating. Saved chats now run to completion and land in the database as normal. Incognito is the exception; it has nothing to persist to, so it still stops when the socket goes.
- **One reply at a time per chat** - two tabs can no longer start overlapping generations in the same conversation. The second is turned away with a message rather than interleaving into the same reply.
- **Context tracking is accurate** - the context ledger now measures the system and instruction blocks on their own and scales the per-message rows to match the true token count, rather than relying on rough estimators.
- **Waiting on a long prompt shows what is happening straight away** - the prefill readout used to appear only after five seconds of silence, which is precisely the stretch you spend staring at nothing while a local model chews through a long conversation. It now appears as soon as there is anything real to report, and leads with how much of the prompt was reused from cache, since that is the number that tells you the model is not re-reading the whole conversation from scratch. A rough time remaining is included, worked out from the speed of the part it actually had to process.

### Fixed
- **llama.cpp context windows could be read many times too large** - when the context length had to be worked out from the model list rather than the server itself, the app read the size the model was *trained* for instead of the size it was *loaded* with. A model trained for 128k but started with `-c 8192` was treated as having sixteen times the room it had. Two things made it worse: the request that asks the server directly did not name the model, so it was refused outright on a llama-server running several models, and when the name did not match any entry the app fell back to whichever model happened to be listed first. All three are fixed, and the trained size is now only ever a last resort.
- **The context bar could stay wrong for the rest of a reply** - when a prompt overflows, llama.cpp reports the real window size and the app corrects itself against it. The reading above the message bar was not told, so it kept showing the size it had guessed before the request went out, which is exactly the moment the number matters.
- **Turning tools on or off could reuse a stale token count** - counted prompt sizes are cached, and the key recorded how many tools were enabled but not which. Swapping one tool for another kept the total the same and returned the previous count, which is a silent undercount of a few hundred tokens.
- **The speed graph carried over between replies** - the sparkline in the engine strip could start a new response with the previous one's curve still in it, and dropped a reading whenever two consecutive measurements happened to be identical.
- **Translation coverage could not be checked on Windows** - the tool that finds untranslated text crashed on startup with a mangled path, so missing translations went unnoticed on Windows machines.
- **The sign-in screen ignored your theme entirely** - it was written with fixed colours from the light Anthropic palette, so it stayed cream-coloured in dark mode and on the OpenAI preset no matter what the server was set to. It now follows the theme like everything else, and the OpenAI preset gets its own rounded styling.
- **The sign-in screen did not know which preset the server used** - the preset was only read after signing in, so a first visit on a new device always drew the Anthropic look before switching. The screen now reads the app's name, icon, font and preset before you sign in.
- **A mistyped email created a new account** - because a single endpoint both signed you in and registered you, an unrecognised email was treated as a sign-up rather than a mistake. Signing in now only signs in, and says the email or password was wrong without revealing which.
- **The sign-in screen was never translated** - every string on it was hardcoded English, including the headline and the two-factor prompts. All of it goes through the translation system now.
- **Alt shortcuts were unusable on macOS** - macOS turns `Option` plus a letter into a different character altogether, and `Option+I` into no character at all, so any shortcut using that modifier either did nothing or fired on the wrong key. Shortcuts now resolve through the physical key when the character is unusable, which also fixes non-US layouts and dead keys.
- **Shortcuts fired on the wrong key with Caps Lock or a modifier held** - matching compared characters loosely, so some combinations overlapped. Each shortcut is now one exact combination, and `?` no longer triggers when a modifier is held.
- **Attach files did nothing** - `Ctrl+U` was listed on the shortcut sheet but was never wired up. It now opens the file picker.
- **Maths broke when a model used LaTeX environments** - `\begin{align}` and friends written without surrounding `$$` were shown as raw text. They are now detected and rendered, without touching anything inside a code block.
- **The shortcut sheet could describe keys that no longer worked** - it listed a hardcoded table, so any change to a shortcut left it lying. It now reads live bindings.
 - the OpenAI preset streamed responses instantly but the setting still showed as enabled with its speed pushed to the bottom, which described the wrong thing. The toggle is off by default on that preset now, and the speed keeps its normal default so turning it on behaves sensibly.
- **Cursor and reveal settings did nothing on the OpenAI preset** - the preset hardcoded the streaming cursor on, forced its shape to a circle, and disabled the typewriter reveal outright, so those three settings silently had no effect for anyone on that preset. The preset now supplies the starting value instead of overriding you, so it still looks the same out of the box but your own choice wins once you make one.
- **Reloading a chat claimed its model had been removed** - the check for whether a conversation's model still exists ran against the model list before that list had finished loading, and read it from a stale copy that was always empty on a fresh page, so any chat reported its model as gone until you clicked away and back. The check now waits for the list to arrive and re-runs against the current one, so a genuinely removed model is still reported and a present one is not.
- **Notifications and the find bar sat on top of the context ledger** - all three lived in the same strip below the header, so opening the ledger left the trim notice covering its second line and the find bar overlapping it as well. The strip now stacks: the ledger sits at the top, the find bar drops below it, and notifications drop below both, each measuring the one above it rather than relying on fixed spacing.
- **Context ledger reported a huge phantom "system + instructions" figure** - the total was measured by the tokenizer while the per-message rows were still estimates, and the overhead line was simply the gap between the two. So most of that number was estimator error rather than anything real. The system, instruction and summary block is now measured on its own, and the per-message rows are scaled to agree with the measured total, so the parts add up to the whole.
- **Trim notification sat off to one side** - it was centred on the window while the composer is centred on the conversation column, leaving it out of line by half the sidebar. It now shares the composer's centre line and follows the sidebar when you collapse it.
- **The window silently stopped working on Qwen and similar templates** - the note explaining that older messages had been dropped was inserted as a system message in the middle of the conversation. Qwen's chat template refuses that outright, which made the tokenizer endpoint reject every measurement, and with no measurement the window had nothing to work from and passed the full oversized prompt straight through. The note is now folded into an existing message, so system messages stay where templates require them.
- **A rejected template no longer disables the safety net** - if the template endpoint refuses a conversation for any reason, prompt size is now measured by tokenizing the content directly with a small allowance for the message markers, instead of giving up and letting an oversized request through. A model whose template keeps failing is remembered for a few minutes so the retries stop costing round trips.
- **Conversations made of images could not be trimmed and errored out** - the window only ever shortened text, so images were untouchable. Once the pictures alone filled the context, and with summarization off, there was nothing left to cut and the request failed. Images are now evicted oldest first, keeping the newest ones and the text around them, and a note in their place tells the model some were removed. An image too large to fit at all is dropped rather than failing the turn, so a vision chat keeps going instead of dead-ending.
- **A corrected image size was ignored** - measured prompt sizes were cached with the image estimate baked in, so after the server reported the true cost the old number kept coming back out of the cache and the retry could never settle. Only the text measurement is cached now, with the image cost applied fresh each time.
- **Context tracking was guessing, and llama.cpp router mode broke it entirely** - in router mode every request has to name the model so the router can reach the child process. open-quill was calling `/props`, `/tokenize` and `/apply-template` without one, so all three came back empty, context detection fell to the 8192 default and token counting fell back to a rough characters-per-token estimate. Every llama.cpp endpoint is now model-qualified, context comes from the server (`/props`, then `/v1/models` metadata, then `/slots`), and prompt size is measured by the model's own tokenizer rather than estimated.
- **Prompts no longer overflow the context window** - conversations are now measured exactly and slid to fit before the request is sent. Oldest turns are dropped first, the system prompt and your newest message are always kept, and a single message too large for the window on its own is cut down with its beginning and end preserved. If the server ever disagrees with the count anyway, it reports the exact prompt size in the rejection and costs nothing to hit, so that number is used to re-fit and retry rather than failing the turn.
- **The window no longer forgets far more than it needs to** - evicting whole messages meant a single large paste took its entire 23,000 tokens with it when only 5,000 needed to go, and the model would answer as though you had never sent it. The oldest message at the boundary is now cut down to exactly fill the space left instead of being discarded, keeping its beginning and end. In practice this fills 99% of the available window rather than 39%.
- **Context ledger showed the wrong number** - it measured the whole conversation with the rough estimator and compared it against the raw context size, so it read 100% full while the request that actually went out was a third of that. It now reports what will really be sent, measured by the model's tokenizer, against the true prompt budget, and says how much was dropped or trimmed to get there.
- **Reply length is capped to the space that is left** - the generation limit is now clamped to whatever room remains after the prompt, so a long conversation cannot run out of context part way through an answer.
- **Tool schemas and images were invisible to the counter** - tool definitions are now passed to the template when measuring, and images carry a real reserve that corrects itself from the server's reported usage instead of a flat guess that was too low for vision models.
- **Summarization and the sliding window are no longer mutually exclusive** - each previously switched the other off, so if summarization could not keep up there was nothing behind it. They now layer, with summarization preserving meaning and the window guaranteeing the request fits.
- **Model dropdown grew scrollbars it did not need** - with a long message in the composer, the menu decided it did not fit, shrank itself and added a scrollbar, all while leaving most of the screen above it empty. It now measures against the whole viewport and slides into view instead of shrinking, so a scrollbar only appears when the list genuinely does not fit on screen.
- **"More models" would not open** - the submenu was landing outside the menu's own scroll area, so hovering it did nothing except add a horizontal scrollbar you had to drag sideways to find it. It now floats above everything and flips to the other side when it would run off the edge of the window.
- **Unsent text was lost on refresh** - anything typed but not sent on the new chat screen vanished when the page reloaded. Drafts are now saved when the tab is hidden as well as on a timer, so a quick reload cannot outrun the save, and they come back on reload, on back and forward navigation, on switching chats, and on leaving incognito.
- **Incognito typing leaked into the new chat draft** - text typed in incognito was being written to the same draft slot the normal new chat screen uses. Incognito no longer saves drafts at all.
- **Wrong model on a resumed stream** - a reply picked back up after a reload briefly showed the chat's previous model instead of the one actually generating.
- **Escape closes the model menu** - it previously only closed by clicking away.
- **Server-side hardening applied** — all server `.js` files pass `node --check`, and the full test suite passes 49/49. The server boots with all CI smoke assertions passing.
- **Stream cancellation improved** — `stream.js` now cancels the response reader on `[DONE]`/`done` instead of abandoning the socket.
- **Broadcast safety improved** — broadcast helpers wrap `ws.send` in try/catch so one dead socket can't abort the fan-out loop.
- **Upload path security hardened** — `uploads.js` path checks use `UPLOADS + path.sep` rather than a bare prefix match.
- **Build checks for remote resources** — `npm run build` checks the finished bundle for references to outside servers and stops with an error naming the file.
- **Sign-in and account creation separated** — the old screen asked for an email, quietly looked it up, and then either signed you in or made you a brand new account depending on what it found. A typo in your email silently created a second account instead of telling you the password was wrong. There are now two clearly labelled choices, both with the email and password on one screen, and creating an account asks you to confirm the password.
- **Admin can disable new accounts** — under Admin > Members. With it off the sign-in screen stops offering account creation and the server refuses registrations, while existing members carry on as normal. It stays on by default, which is how the app behaved before.
- **Custom keyboard shortcuts** — every shortcut can now be rebound from **Settings > Keybinds**. Click Change, press the combination you want, and it takes effect everywhere: the shortcut sheet, the command palette hints and the app itself all read the same list, so nothing can drift out of date. Conflicts are called out as you make them, and if you bind something the browser normally claims, you are told rather than left wondering why nothing happens.
- **Shortcut presets, backup and restore** — a Vim flavoured preset ships alongside the defaults, and your overrides can be exported to a file and loaded on another device. Individual shortcuts can be reset one at a time or all at once.
- **More things worth a shortcut** — the message bar, attachments, web search, sandbox, stop, incognito, light/dark, the context ledger, the artifacts panel, jump-to-latest, settings, and moving between chats all have bindings now. Defaults avoid combinations the browser or the OS already owns.
- **Full LaTeX environments** — `\begin{align}`, `equation`, `cases`, `pmatrix`, `gather`, `split` and the rest now render whether or not they are wrapped in `$$`. Models write them both ways and only one used to work.
- **Chemistry notation** — `\ce{}` and `\pu{}` are supported through KaTeX's mhchem extension, so reaction equations render properly.
- **Common maths shorthands** — `\RR`, `\NN`, `\ZZ`, `\QQ`, `\CC`, `\eps`, `\dd`, `\abs{}`, `\norm{}`, `\set{}`, `\argmin` and `\argmax` are predefined. Macros are scoped to the block that defines them, so nothing a model writes in one message can affect another.
- **Generations survive a refresh** — a reply now belongs to the chat, not to the browser tab that started it. Reloading mid-answer, dropping your connection, or opening the same chat in a second tab all pick the stream back up where it is, instead of leaving you staring at nothing until the model finishes. The server holds the in-progress text, reasoning, tool preview and prefill status, and hands all of it to whichever tab connects next.
- **Stop and steer work after a reload** — since a running turn is no longer tied to one socket, the stop button and mid-generation steering still control the reply on a freshly loaded page.
- **Router hop names display correctly** — the "via" chip now shows the correct model names by falling back through display_name, name, and internal_name, fixing the blank labels seen in previous builds.
- **Chat ownership verified before regeneration** — for `regenerate` requests, the system now checks that the chat belongs to the caller before routing, preventing errors where a router error string was incorrectly sent back.
- **Multi-step tool usage tracked correctly** — the client no longer shows a spurious "Continue" affordance for multi-step tool runs, as the usage counter now tracks only the final step completion.
- **Private IP range filtering tightened** — the egress filter now correctly treats the standard private ranges, ensuring only truly external connections are blocked while internal loops remain functional.
- **Dead code removed for efficiency** — several unused functions and redundant awaits have been stripped from the core logic, making the engine lighter and more responsive.
- **Memory bank and Sandbox performance boosted** — file operations for the memory bank and sandbox have been cached and optimized, significantly reducing I/O overhead during heavy usage.
- **Database operations streamlined** — model reordering and project deletion now use efficient transactions and index-based lookups, reducing load on the database server.
- **Password policy hardened** — password change now requires 8 characters, matching the registration requirement for better security.

---

## [27.0.0] — 2026-07-27

> **Breaking:** This release replaces the plaintext `data.json` store with an encrypted SQLite database and is **not backward compatible** with previous versions. There is no automatic import; a fresh database is created on first run and the first account to sign in becomes the owner.

> **Version naming update:** Beginning with version 27, releases will use a year-based naming scheme instead of the previous year.month.quarter format. This clears up confusing on when updates will come out.

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
- **OpenAI Theme** - Change the entire UI to match OpenAI's chat interface with just one click of a button!

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
