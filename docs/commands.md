# Commands

Run these from the repository root unless a row says otherwise.

## Everyday

| Command | What it does |
| --- | --- |
| `npm run install:all` | Install dependencies for the root, `server/` and `client/` |
| `npm run dev` | Start the server on `:3001` and the client on `:5173`, both with hot reloading |
| `npm run build` | Build the client into `client/dist`, then check that it only talks to its own origin |
| `npm start` | Run the production server on `:3001`, which serves `client/dist` |

## Checks

| Command | What it does |
| --- | --- |
| `npm run lint` | Run ESLint across the repository |
| `npm run lint:fix` | Run ESLint and fix what it can |
| `npm run test:client` | Run the client tests in `client/test/` |
| `npm run smoke` | Render every admin section and modal, catching errors that only appear at runtime |
| `npm run i18n:check` | List missing and unused translation keys. Add `-- --json` for machine-readable output |
| `npm run i18n:sync` | Remove unused keys, merge a translation patch, or create a new language |
| `npm run check:release` | Check that the version, release folder and changelog agree. Add `-- --final` to also require dates |
| `cd server && npm test` | Run the server test suite |

## Server tests

`npm test` runs every `*.test.js` file under `server/test/`.

Run one file:

```shell
cd server
node --test test/logic.test.js
```

Run one test by name:

```shell
cd server
node --test --test-name-pattern "name of the test" test/logic.test.js
```

## Server scripts

Run these in `server/`.

| Command | What it does |
| --- | --- |
| `npm start` | Run the server |
| `npm run dev` | Run the server and restart it when files change |
| `npm test` | Run the server tests |

## Client scripts

Run these in `client/`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Run only the Vite dev server on `:5173` |
| `npm run build` | Build `dist/` and check it |
| `npm run preview` | Serve the built `dist/` with Vite |
| `npm run check:local` | Run the off-origin check against an existing `dist/` |
| `npm run dead:css` | Report unused CSS classes. This is advisory, since a library can still emit a class with no matches |
| `npm run test` | Run the client tests |
| `npm run i18n:check`, `npm run i18n:sync` | The same translation commands as the root |
| `npm run smoke` | The same smoke test as the root |

## What CI runs

The workflow in `.github/workflows/ci.yml` runs on every push and pull request to `dev` and `main`, using Node 26. These steps run in order, and all must pass:

1. Syntax-check every server `.js` file
2. `npm run lint -- --quiet`
3. `npm run build`
4. `npm run i18n:check`
5. `npm run smoke`
6. `npm run check:release`
7. `npm run test:client`
8. `cd server && npm test`

To run the same checks locally before opening a pull request:

```shell
npm run lint -- --quiet
npm run build
npm run i18n:check
npm run smoke
npm run check:release
npm run test:client
cd server && npm test
```

The lint warnings about `react-hooks/exhaustive-deps` are deliberate, so `npm run lint` shows them while CI runs with `--quiet`.

## Release workflows

- **Version guard**: fails a pull request into `main` unless the version is bumped and newer than `main`.
- **Release**: runs when `dev` is merged into `main`. It checks the release, builds, starts the server once, zips the app and drafts a GitHub release.
- **Tag guard**: rejects tags with a `v` prefix.

See [Building and running](building.md#releasing-maintainers) for the steps.