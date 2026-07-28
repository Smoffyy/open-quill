<div align="center">

# Open Quill

<img src="assets\v27\icon.svg" alt="Starburst Logo" width="200"/>

*A fully open-sourced chat interface featuring Anthropic inspired theming.*

[![Latest Stable Release](https://img.shields.io/github/v/release/Smoffyy/open-quill?label=Latest%20Stable%20Release)](https://github.com/Smoffyy/open-quill/releases/latest)
[![Latest Beta Release](https://img.shields.io/github/v/release/Smoffyy/open-quill?include_prereleases&label=Latest%20Beta%20Release)](https://github.com/Smoffyy/open-quill/releases)

</div>

A **chat interface** inspired by **[Anthropic's Chat Interface](https://claude.ai/new)**, enhanced with new features while preserving the Anthropic's aesthetic. This project aims to recreate the look and feel of Anthropic's interface while introducing the ability to run everything **entirely locally** for greater privacy and control.

This project is licensed under the [MIT License](LICENSE), by downloading, using, or modifying this project, you agree to the terms of the [LICENSE](LICENSE) file. **Forever free. Built by the community, for the community.**

> **This project is not enterprise ready and is not intended to be. It is a community built interface designed to be customized, modified, and configured however you prefer.**

---

<p align="center">
  <img src="assets\v27\anthropic_screenshot1.jpeg" alt="Chat Interface with Artifacts"/>
</p>

<details>
  <summary>More Screenshots.</summary>
  <br>

  <p align="center">
    <img src="assets\v27\anthropic_screenshot2.jpeg" alt="Artifacts"/>
    <br>
    <sub>Chat with Artifacts.</sub>
  </p>

  <p align="center">
    <img src="assets\v27\anthropic_screenshot4.jpeg" alt="Chat"/>
    <br>
    <sub>Chat response.</sub>
  </p>

  <p align="center">
    <img src="assets\v27\anthropic_screenshot3.jpeg" alt="Admin panel"/>
    <br>
    <sub>Models tab in Admin Panel.</sub>
  </p>

  <p align="center">
    <img src="assets\v27\openai_screenshot1.jpeg" alt="OpenAI chat"/>
    <br>
    <sub>OpenAI theme</sub>
  </p>

</details>

---

## Features

- Anthropic-style UI with a serif assistant voice (Source Serif 4) and Open Sans user input
- Two-step email + password sign-in; the **first account created becomes the admin**
- Letter-by-letter streaming with a fade-in reveal
- Per-phase model logos (static / generating / thinking), admin-uploadable
- Reasoning models: an **Extended** toggle and collapsible "Thought process" view; supports `<think>` tags and `reasoning_content` deltas
- Admin panel: manage models (display name, internal API id, description, system prompt), tuck models under a renamable "More models" group, toggle reasoning and set reasoning / non-reasoning tokens, and upload the three state logos
- Reasoning / non-reasoning tokens are appended to the end of the system prompt on a new line (e.g. `/think`, `/no_think`)
- Changes save instantly and push to every connected client in real time over WebSocket
- Auto-generated chat titles, code blocks with hover-to-copy, smart autoscroll with a jump-to-bottom button
- Zero native dependencies, data is stored in a local JSON file (`server/data.json`)
- Artifacts, enabling users to create entire projects natively inside the UI!
- And much more!

## Why was this project made?

This project was made mainly because I was fascinated by the Anthropic interface and colors. There's many other apps that have recreated simliar styles of other interfaces and I wanted to contribute openly for others to build upon what I've created. This entire project will **FOREVER** be listed under the MIT License. The front end aims to keep a balance between useful functionality and a clean, aesthetically pleasing experience. This project was made with the help of my local assistants alongside me.

I've created an official YouTube channel dedicated to this project, which will showcase major updates as well as tutorials on how to use the interface. Check it out at [open-quill-git YouTube](https://www.youtube.com/@open-quill-git)

## Requirements

- Node.js 18+ (Node 20+ recommended)
- A running OpenAI-compatible server. Default target is LM Studio at `http://localhost:1234/v1`.

## Setup

```bash
npm run install:all
npm run build # builds the client into client/dist
npm start # serves everything from http://localhost:3001
```

Open http://localhost:3001 and create your account, the first one is the admin.

### Development (hot reload)

```bash
npm run install:all
npm run dev # client on :5173 (proxied), server on :3001
```

Open http://localhost:5173.

## Connecting your model

1. Start your local server (e.g. llama.cpp server) and load a model.
2. Sign in as the admin, open the profile menu (bottom-left) -> **Admin Panel** -> **Providers**.
3. Set the API base URL (default `http://localhost:8080/v1`) and key, then Save.
4. Under **Models**, set each model's **internal model name** to the id your server expects (llama.cpp accepts the model name configured when starting the server, or the model's id). Add a description, system prompt, logos, and reasoning settings as desired.

> The interface is primarily designed for use with llama.cpp. Other providers may work, but full functionality and feature compatibility cannot be guaranteed.

## Databases

Open Quill can run multiple, fully isolated databases and switch between them with a single line in a `.env` file. Each database keeps its own users, chats, preferences, interface and model configuration, artifacts, uploaded content, sandbox, project files and memory. Nothing is shared between them.

The active database is chosen by `OPEN_QUILL_DB` and is read **once at startup**. For safety it can never be switched while the server is running, change the value and restart to switch.

### First-time setup

You don't have to create the `.env` yourself, the server writes one automatically the first time it starts, so a fresh clone just works. To set it up ahead of time, copy the example that ships in the project root:

```bash
cp .env.example .env
```

Then pick a database name:

```bash
# .env  (in the project root, the folder you run npm from)
OPEN_QUILL_DB=default
```

`default` uses `server/data/`, the original location, so existing installs are untouched. Any other name lives in its own folder under `server/data/databases/<name>/` and is created automatically the first time it loads. Names may use lowercase letters, numbers, dashes and underscores.

The `.env` belongs in the **project root**. If both a project-root `.env` and a `server/.env` exist, the project-root one wins and the other is ignored. On startup the server prints exactly which database and which file are in effect:

```
[db] active database "default" -> .../server/data
[db] database selector: .../.env (edit OPEN_QUILL_DB, then restart to switch)
```

### Switching or creating databases

Two ways, both take effect on the next restart:

- **Edit `.env`** — set `OPEN_QUILL_DB` to any name and restart. A brand-new name starts as a fresh, empty database.
- **Admin panel** — sign in as the admin and open **Admin Panel -> Databases**. Create named databases, see which one is running versus which loads next, choose the one to load, and delete unused ones. Your choice is marked pending and applied on the next restart.

Each database is encrypted with its own key stored beside its data. To use one key for every database instead, set `DB_ENCRYPTION_KEY` in your `.env`.

## Notes

- All data lives under the active database's folder inside `server/data/` (see **Databases** above). To reset a database, stop the server and delete its folder.
- To change the port, set `PORT` before `npm start`.

## Privacy and local-only operation

Open Quill is built to run entirely on your own machine, and by default nothing leaves it:

- No telemetry, analytics, crash reporting, tracking, or update "phone-home" checks. The "Analytics" in the admin panel is your own local token/cost accounting, computed from the local database.
- The web client only ever talks to its own backend (same-origin requests and a same-host WebSocket). It loads no third-party scripts; fonts are self-hosted, not fetched from a CDN.
- Secrets (the database encryption key and the auth token secret) are generated and stored locally and are never transmitted. The database itself is encrypted at rest.
- The server binds to `127.0.0.1` (this machine only) by default. Set `HOST=0.0.0.0` in your `.env` if you want to reach it from other devices on your network.

Outbound network requests happen only when you explicitly configure or enable a feature, and only to the destination you specify:

- **Model provider**: chat requests go to the provider base URL you set. The default is a local server (llama.cpp at `http://localhost:8080/v1`). If you choose a cloud provider and enter an API key, requests go there.
- **Voice**: speech‑to‑text and text‑to‑speech use the base URL you configure (local by default).  
- **Web search**: off unless you enable it and point it at your own SearXNG instance. When a search runs, the server fetches result pages from the web, which is the point of the feature.  
- **Connectors (MCP)**: only those you add. These run as local subprocesses, or reach an `http(s)` URL if you configure one.  
- **Code sandbox**: runs code the model or you generate; that code has the same network access as the host, so a script it runs could make its own requests.

## Updates / Version Information

Beginning with **Open Quill 27**, the project will adopt a year based versioning system. Major releases will increment annually, starting with version **27** and continuing forward with each new release cycle.

If you'd like to try upcoming features on a **semi-stable** build, check out the [beta](https://github.com/Smoffyy/open-quill/tree/beta) branch. For users who prefer a packaged release without automatic updates, you can find available builds on the [releases](https://github.com/Smoffyy/open-quill/releases) page. *Please note that beta builds are considered semi-stable and may contain bugs or unfinished features.* 

For developers and advanced users who want access to the **bleeding-edge** changes, the [dev](https://github.com/Smoffyy/open-quill/tree/dev) branch contains the latest in-development updates.