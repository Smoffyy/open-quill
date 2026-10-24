# Databases

Open Quill can run several completely separate databases. Each one has its own users, chats, preferences, models, artifacts, uploads, sandbox, project files and memory. Nothing is shared between them.

The active database is set by `OPEN_QUILL_DB` in `.env`. It is read once at startup, so change it and restart to switch.

## Setup

The server creates `.env` the first time it starts, from `.env.example`. To set it up ahead of time, copy the example:

```shell
cp .env.example .env
```

Then choose a database name:

```shell
OPEN_QUILL_DB=default
```

- `default` uses `server/data/`, the original location. Existing installs are not affected.
- Any other name lives in `server/data/databases/<name>/` and is created the first time it loads.
- Names may use lowercase letters, numbers, dashes and underscores. They can be up to 40 characters.

The `.env` belongs in the **project root**. If there is also a `server/.env`, the project-root one wins and the other is ignored.

On startup the server logs which database and which file are in use:

```
[db] active database "default" -> .../server/data
[db] database selector: .../.env (edit OPEN_QUILL_DB, then restart to switch)
```

## Switching or creating databases

Both methods take effect on the next restart.

- **Edit `.env`**: set `OPEN_QUILL_DB` to any name and restart. A new name starts as an empty database.
- **Admin Panel → Storage**: create named databases, see which one is running and which will load next, and pick one with **Use next start**. Unused databases can be deleted. The running database cannot be deleted.

## Encryption

Each database is encrypted with its own key, stored beside its data. To use one key for every database, set `DB_ENCRYPTION_KEY` in `.env`. See [Building and running](building.md#configure).

## Resetting a database

Stop the server and delete the database's folder. It is recreated empty the next time that name is loaded.