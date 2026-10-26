<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="press-kit/lockup/lockup-horizontal-tagline-on-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="press-kit/lockup/lockup-horizontal-tagline-on-light.svg">
    <img src="press-kit/lockup/lockup-horizontal-tagline-on-light.svg" alt="Open Quill" width="440">
  </picture>
</p>

<p align="center">
  <strong>Open Quill</strong> is a chat app for language models that runs on your own computer.
</p>

<p align="center">
  <a href="https://github.com/Smoffyy/open-quill/releases/latest"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.github.com%2Frepos%2FSmoffyy%2Fopen-quill%2Freleases%2Flatest&query=%24.name&label=release&labelColor=1f1f1e&color=d97757" alt="Latest release"></a>
  <a href="https://github.com/Smoffyy/open-quill/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Smoffyy/open-quill/ci.yml?branch=dev&label=CI&labelColor=1f1f1e&logo=githubactions&logoColor=f4f3ee" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-7193f5?labelColor=1f1f1e" alt="MIT license"></a>
</p>

<p align="center">
  <img src="docs/images/greeting.png" alt="Open Quill home screen" width="80%" />
</p>

</br>

Connect it to a model running on your machine, like Ollama or llama.cpp, or to a cloud provider with your own API key. Nothing leaves your computer unless you set it up that way.

---

## Quickstart

### Install and run

You need [Node.js](https://nodejs.org/en/download/) 22.23.2 or newer.

```shell
git clone https://github.com/Smoffyy/open-quill.git
cd open-quill
npm run install:all
npm run build
npm start
```

Then open `http://localhost:3001` and create an account. The first account becomes the owner.

Connect a model under **Admin Panel → Providers**. A llama.cpp connection at `http://localhost:9931` is ready to use as a starting point.

Prefer not to build? Download the [latest release](https://github.com/Smoffyy/open-quill/releases/latest), which comes prebuilt. Run `npm install` in `server/`, then `npm start`.

### Let other people on your network in

Set `HOST=0.0.0.0` in `.env` and restart. Then turn on **Accept new sign-ups** under **Admin Panel → Members**.

## What it does

- Works with local and cloud models, including several at once
- Gives the assistant a workspace per chat, with files and a shell
- Projects, memory, scheduled tasks, web search and MCP connectors
- Team accounts with roles, and releases you can roll back
- Two interface styles, light and dark modes, ten languages

## Docs

- [**Getting Started**](docs/getting-started.md)
- [**Chatting**](docs/chatting.md)
- [**Models & Reasoning**](docs/models.md)
- [**Admin Guide**](docs/admin-guide.md)
- [**Privacy & Security**](docs/privacy-security.md)
- [**All documentation**](docs/README.md)

## Contributing

Report bugs in [Issues](https://github.com/Smoffyy/open-quill/issues) with your version from **Settings → Version**. Pull requests go to `dev`, with lint, build and tests passing. Architecture and conventions are in [AGENTS.md](AGENTS.md).

## License

Open Quill is released under the [MIT License](LICENSE). See [CREDITS.md](CREDITS.md) for the libraries and assets it uses.