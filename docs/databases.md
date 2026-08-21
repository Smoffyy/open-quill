# Databases

Open Quill can run multiple, fully isolated databases and switch between them with a single line in a `.env` file. Each database keeps its own users, chats, preferences, interface and model configuration, artifacts, uploaded content, sandbox, project files and memory. Nothing is shared between them.

The active database is chosen by `OPEN_QUILL_DB` and is read **once at startup**. For safety it can never be switched while the server is running. Change the value and restart to switch.

## First-time setup

You don't have to create the `.env` yourself. The server writes one automatically the first time it starts, so a fresh clone just works. To set it up ahead of time, copy the example that ships in the project root:

```bash
cp .env.example .env
```

Then pick a database name:

```bash
# .env  (in the project root, the folder you run npm from)
OPEN_QUILL_DB=default
```

`default` uses `server/data/`, the original location, so existing installs are untouched. Any other name lives in its own folder under `server/data/databases/<name>/` and is created automatically the first time it loads. Names may use lowercase letters, numbers, dashes and underscores.

## Where the selector lives

The `.env` belongs in the **project root**. If both a project-root `.env` and a `server/.env` exist, the project-root one wins and the other is ignored.

On startup the server prints exactly which database and which file are in effect:

```
[db] active database "default" -> .../server/data
[db] database selector: .../.env (edit OPEN_QUILL_DB, then restart to switch)
```

If you are ever unsure which database you are looking at, that line is the authority.

## Switching or creating databases

Two ways, both taking effect on the next restart:

- **Edit `.env`**: set `OPEN_QUILL_DB` to any name and restart. A brand-new name starts as a fresh, empty database.
- **Admin panel**: sign in as the admin and open **Admin Panel → Databases**. Create named databases, see which one is running versus which loads next, choose the one to load, and delete unused ones. Your choice is marked pending and applied on the next restart.

## Encryption

Each database is encrypted at rest with its own key, stored beside its data. To use one key for every database instead, set `DB_ENCRYPTION_KEY` in your `.env`.

## Resetting a database

Stop the server and delete the database's folder. It will be recreated, empty, the next time that name is loaded.
