# Building and running

This page covers installing Open Quill from source or from a release, configuring it, building the client, running it and updating it. For every npm script, see [Commands](commands.md).

## Requirements

- **Node.js 22.23.2 or newer.** CI and release builds use Node 24, so use 24 if you hit a difference.
- **npm**, which comes with Node.
- **A model**: one running on your machine (Ollama, llama.cpp, LM Studio or vLLM), or an API key from a cloud provider.
- **Git**, if you clone the repository. Otherwise download a release.

If `npm install` fails while building a native module (`argon2` or `better-sqlite3-multiple-ciphers`), install the build tools for your platform and run it again.

## Install from source

```shell
git clone https://github.com/Smoffyy/open-quill.git
cd open-quill
npm run install:all
```

`npm run install:all` installs dependencies for the repository root, `server/` and `client/`. Run it after cloning, and again after pulling changes to any `package.json`.

## Build the client

```shell
npm run build
```

This writes the React app to `client/dist`. The build then checks the bundle. If anything would fetch from another origin, the build fails. Fonts, icons and libraries are bundled, so this should not happen.

Run the build again after any client change, before you start the production server.

## Run it

**Production**, one process that serves the built app:

```shell
npm start
```

Open **http://localhost:3001**.

**Development**, with hot reloading for both server and client:

```shell
npm run dev
```

Open **http://localhost:5173**. Vite forwards `/api`, `/uploads` and `/ws` to the server on port 3001. The server also still answers on 3001 directly.

Stop either one with `Ctrl+C`.

## Install from a release

Download the [latest release](https://github.com/Smoffyy/open-quill/releases/latest) and extract it. The client is already built, so there is no build step. In the extracted folder:

```shell
cd server
npm install
cd ..
npm start
```

## Configure

The server reads a `.env` file in the project root. If there is none, it creates one from `.env.example` on first start. Restart the server after changing it.

| Variable | Default | What it does |
| --- | --- | --- |
| `OPEN_QUILL_DB` | `default` | The database to load. Read at startup, see [Databases](databases.md) |
| `PORT` | `3001` | The port the server listens on |
| `HOST` | `127.0.0.1` | The network address to listen on. Set `0.0.0.0` so other devices on your network can connect |
| `DB_ENCRYPTION_KEY` | empty | One key for every database. Empty means each database uses its own key, stored beside its data |
| `TRUST_PROXY` | off | Set to `1` only when a reverse proxy sets `X-Forwarded-For`. Otherwise the header can be forged |
| `TRUSTED_ORIGINS` | empty | Extra origins allowed to make changes, comma separated. Only needed when a proxy rewrites the `Host` header and the browser is old |

A `.env` in the project root takes precedence over one in `server/`. The server logs which file it is using at startup.

To make a key for `DB_ENCRYPTION_KEY`:

```shell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

A 64-character hex value is used as a raw key. Any other text is used as a passphrase.

## Where your data lives

- The default database is in `server/data/`.
- Other databases are in `server/data/databases/<name>/`.

Everything the app stores for a database is in its folder, including the encrypted database, uploads and sandbox workspaces.

To back up, stop the server and copy the folder. If you use `DB_ENCRYPTION_KEY`, keep that key too, because the copy cannot be opened without it.

## Update

**From a clone:**

```shell
git pull
npm run install:all
npm run build
npm start
```

**From a release:** extract the new release, then copy your `.env` and `server/data/` across. Database changes are applied automatically at startup.

## Troubleshooting

- **Port already in use:** set `PORT` in `.env` and restart.
- **Other devices cannot connect:** set `HOST=0.0.0.0`, restart, and allow the port through your firewall.
- **The page is blank or missing:** run `npm run build`, then `npm start`.
- **Changes to `.env` have no effect:** restart the server.
- **The build fails on an off-origin URL:** something added an external link, script or font. Bundle it instead.

## Releasing (maintainers)

Work goes into `dev` through pull requests. A release is cut by merging `dev` into `main`.

1. Bump the version to a bare number, such as `28.1.0`, in the root, `server/` and `client/` `package.json` files and their lockfiles.
2. Add a `release/<major>/` folder with `release.json` and `notes.md`.
3. Add a `## [28.1.0]` section to `CHANGELOG.md`.
4. Run `npm run check:release`. Add `-- --final` before merging into `main`, which also requires dates.
5. Open a pull request into `main`. The version guard fails unless the version is newer than `main`.
6. When it merges, the Release workflow drafts a GitHub release with the zipped app and the changelog section. Publish the draft, which creates the tag.

Do not create tags by hand. The tag guard rejects tags with a `v` prefix.