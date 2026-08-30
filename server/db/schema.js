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
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id, name);`
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
    sdb.exec(MIGRATIONS[i]);
    sdb.pragma(`user_version = ${version}`);
  }
  return at();
}
