export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT, created_at INTEGER, data TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY, user_id TEXT, sort_order INTEGER, created_at INTEGER, data TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id, sort_order);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, user_id TEXT, folder_id TEXT, updated_at INTEGER, data TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, chat_id TEXT, parent_id TEXT, created_at INTEGER, data TEXT NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY, sort_order INTEGER, enabled INTEGER, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_models_sort ON models(sort_order);
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY, user_id TEXT, model_id TEXT, created_at INTEGER, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id, created_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
`;

// Each entry brings the database up to the version of its own index + 2, because
// SCHEMA itself is version 1. Append here; never edit an entry that has shipped.
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, user_id TEXT, model_id TEXT, created_at INTEGER, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id, created_at);`,

  `CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, owner_id TEXT, created_at INTEGER, updated_at INTEGER, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_spaces_owner ON spaces(owner_id);
CREATE TABLE IF NOT EXISTS space_messages (id TEXT PRIMARY KEY, space_id TEXT, created_at INTEGER, data TEXT NOT NULL, FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_space_messages_space ON space_messages(space_id, created_at);`,

  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT, last_seen INTEGER, created_at INTEGER, data TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, last_seen);`,

  `CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, ts INTEGER, actor_id TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);`,

  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id TEXT, updated_at INTEGER, created_at INTEGER, data TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at);`,

  `CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, ts INTEGER, user_id TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(ts);`,

  `CREATE INDEX IF NOT EXISTS idx_usage_created ON usage(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(chat_id, parent_id);`,

  `CREATE TABLE IF NOT EXISTS toolstats (id TEXT PRIMARY KEY, ts INTEGER, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_toolstats_ts ON toolstats(ts);`,

  `CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id TEXT, next_run INTEGER, updated_at INTEGER, created_at INTEGER, data TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, next_run);`,

  `CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, updated_at INTEGER, created_at INTEGER, data TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id, name);`,

  // Spaces (shared multi-user chat rooms) was removed as a feature; drop the tables it left behind.
  `DROP TABLE IF EXISTS space_messages;
DROP TABLE IF EXISTS spaces;`,

  `CREATE INDEX IF NOT EXISTS idx_tasks_next ON tasks(next_run);
CREATE INDEX IF NOT EXISTS idx_sessions_seen ON sessions(last_seen);`,

  `CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, version INTEGER, created_at INTEGER, data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_releases_version ON releases(version);
CREATE TABLE IF NOT EXISTS draft_edits (id TEXT PRIMARY KEY, updated_at INTEGER, data TEXT NOT NULL);`,

  `UPDATE models SET data = json_set(data, '$.num_ctx', 0) WHERE json_valid(data) AND json_extract(data, '$.num_ctx') > 0;
UPDATE settings SET value = (
  SELECT json_group_array(json(json_set(e.value, '$.num_ctx', 0)))
  FROM (SELECT value FROM json_each(settings.value) ORDER BY key) e
) WHERE key = 'published_models' AND json_valid(value) AND json_type(value) = 'array' AND json_array_length(value) > 0;`,

  `CREATE TABLE IF NOT EXISTS eval_collections (id TEXT PRIMARY KEY, updated_at INTEGER, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS eval_versions (id TEXT PRIMARY KEY, collection_id TEXT, version INTEGER, created_at INTEGER, data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_versions ON eval_versions(collection_id, version);
CREATE TABLE IF NOT EXISTS eval_runs (id TEXT PRIMARY KEY, collection_id TEXT, created_at INTEGER, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_eval_runs ON eval_runs(collection_id, created_at);
CREATE TABLE IF NOT EXISTS quality_checks (id TEXT PRIMARY KEY, ts INTEGER, criterion_id TEXT, chat_id TEXT, verdict TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_quality_ts ON quality_checks(ts);
CREATE INDEX IF NOT EXISTS idx_quality_criterion ON quality_checks(criterion_id, ts);
CREATE INDEX IF NOT EXISTS idx_quality_chat ON quality_checks(chat_id);`,

  `CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, rank INTEGER, data TEXT NOT NULL);
UPDATE users SET data = json_remove(json_set(data,
    '$.role', CASE
      WHEN json_extract(data, '$.is_owner') THEN 'owner'
      WHEN json_extract(data, '$.is_admin') AND json_extract(data, '$.can_publish') = 0 THEN 'editor'
      WHEN json_extract(data, '$.is_admin') THEN 'admin'
      ELSE 'user' END,
    '$.status', 'active',
    '$.source', 'local'),
  '$.is_admin', '$.is_owner', '$.can_publish')
WHERE json_valid(data) AND json_extract(data, '$.role') IS NULL;
INSERT OR IGNORE INTO roles (id, rank, data)
  SELECT 'editor', 50, json_object('id', 'editor', 'name', 'Editor', 'description', 'Uses the admin panel and stages changes, but cannot publish them.', 'rank', 50, 'permissions', json('[]'), 'preset', 'legacy-editor', 'created_at', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
  WHERE EXISTS (SELECT 1 FROM users WHERE json_extract(data, '$.role') = 'editor');
INSERT OR IGNORE INTO settings (key, value)
  SELECT 'auth_signup_policy', CASE WHEN value = '"0"' THEN '"closed"' ELSE '"open"' END FROM settings WHERE key = 'allow_signups';
DELETE FROM settings WHERE key IN ('allow_signups', 'draft:allow_signups');`,

  `CREATE TABLE IF NOT EXISTS user_groups (id TEXT PRIMARY KEY, name_key TEXT, source TEXT, updated_at INTEGER, data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_groups_name ON user_groups(source, name_key);
CREATE TABLE IF NOT EXISTS group_members (id TEXT PRIMARY KEY, group_id TEXT, member_type TEXT, member_id TEXT, source TEXT, data TEXT NOT NULL, FOREIGN KEY(group_id) REFERENCES user_groups(id) ON DELETE CASCADE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_link ON group_members(group_id, member_type, member_id);
CREATE INDEX IF NOT EXISTS idx_group_members_member ON group_members(member_type, member_id);`
];

export const LATEST_VERSION = MIGRATIONS.length + 1;

export function migrate(sdb) {
  const at = () => sdb.pragma('user_version', { simple: true });
  if (at() === 0) {
    sdb.exec(SCHEMA);
    sdb.pragma('user_version = 1');
  }
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const version = i + 2;
    if (at() >= version) continue;
    sdb.transaction(() => {
      sdb.exec(MIGRATIONS[i]);
      sdb.pragma(`user_version = ${version}`);
    })();
  }
  return at();
}