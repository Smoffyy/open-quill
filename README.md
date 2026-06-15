# open-quill

A fully local chat UI for OpenAI-compatible model servers, inspired by Anthropic’s design and enhanced with additional features all running entirely on your machine!

<p align="center">
  <img src="assets\v2026\banner.png" alt="Starburst Logo" width="1250"/>
</p>

## Preview

<p align="center">
  <img src="assets\v2026\artifacts-showcase-screen.png" alt="Chat Interface with Artifacts"/>
  <br>
  <sub>The open-quill chat interface showcasing chats and artifacts.</sub>
</p>

<details>
  <summary>More Screenshots.</summary>
  <br>

  <p align="center">
    <img src="assets\v2026\first-login-screen.png" alt="First Login"/>
    <br>
    <sub>Web page upon first login.</sub>
  </p>

  <p align="center">
    <img src="assets\v2026\response-showcase-screen.png" alt="Normal chat response"/>
    <br>
    <sub>Response showcase.</sub>
  </p>

  <p align="center">
    <img src="assets\v2026\admin-models-screen.png" alt="Admin panel"/>
    <br>
    <sub>Models tab in Admin Panel.</sub>
  </p>

  <p align="center">
    <img src="assets\v2026\your-chats-showcase-screen.png" alt="Saved Chats"/>
    <br>
    <sub>Your Chats panel.</sub>
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
- Zero native dependencies — data is stored in a local JSON file (`server/data.json`)
- Artifacts, enabling users to create entire projects natively inside the UI!
- And much more!

## Why was this project made?

This project was made mainly because I was fascinated by the Anthropic interface and colors. There's many other apps that have recreated simliar styles of other interfaces and I wanted to contribute openly for others to build upon what I've created. This entire project will **FOREVER** be listed under the MIT License. The front end aims to keep a balance between useful functionality and a clean, aesthetically pleasing experience.

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

Open http://localhost:3001 and create your account — the first one is the admin.

### Development (hot reload)

```bash
npm run install:all
npm run dev # client on :5173 (proxied), server on :3001
```

Open http://localhost:5173.

## Connecting your model

1. Start your local server (e.g. LM Studio -> Developer -> Start Server) and load a model.
2. Sign in as the admin, open the profile menu (bottom-left) -> **Admin Panel** -> **Connection**.
3. Set the API base URL (default `http://localhost:1234/v1`) and key, then Save.
4. Under **Models**, set each model's **internal model name** to the id your server expects (LM Studio accepts `local-model`, or the loaded model's id). Add a description, system prompt, logos, and reasoning settings as desired.

## Notes

- All data lives in `server/data.json` and uploaded logos in `server/uploads/`. Delete `data.json` to reset.
- To change the port, set `PORT` before `npm start`.

## Updates / Version info

The scheme is `YEAR.QUARTER.PATCH`, but may not follow closely to accurate date as major releases will release earlier than the specified year.