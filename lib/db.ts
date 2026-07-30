import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const dataDirectory = process.env.DDT_DATA_DIR
  ? path.resolve(process.env.DDT_DATA_DIR)
  : path.join(process.cwd(), "data");

mkdirSync(dataDirectory, { recursive: true });

const databasePath = path.join(dataDirectory, "ddt-insight.sqlite");

const globalForDatabase = globalThis as unknown as {
  ddtInsightDatabase?: Database.Database;
};

function createDatabase() {
  const database = new Database(databasePath);

  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("foreign_keys = ON");
  database.pragma("temp_store = MEMORY");
  database.pragma("cache_size = -65536");
  database.pragma("busy_timeout = 5000");
  database.pragma("mmap_size = 268435456");

  database.exec(`
    CREATE TABLE IF NOT EXISTS source_files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      column_count INTEGER NOT NULL,
      columns_json TEXT NOT NULL,
      sr_nums_json TEXT NOT NULL,
      size_bytes INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cases (
      case_id TEXT PRIMARY KEY COLLATE NOCASE,
      record_id TEXT NOT NULL,
      sr_num TEXT NOT NULL COLLATE NOCASE,
      data_json TEXT NOT NULL,
      source_file_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_file_id) REFERENCES source_files(id)
    );

    CREATE INDEX IF NOT EXISTS idx_cases_sr_num
      ON cases (sr_num COLLATE NOCASE, case_id COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_cases_updated_at
      ON cases (updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cases_source_file
      ON cases (source_file_id);
    CREATE INDEX IF NOT EXISTS idx_source_files_imported
      ON source_files (imported_at DESC);

    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_created
      ON activity (created_at DESC);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('local', 'ldap')),
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      password_hash TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_provider
      ON users (provider, enabled, username COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS ldap_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      url TEXT NOT NULL DEFAULT '',
      bind_dn TEXT NOT NULL DEFAULT '',
      bind_password_encrypted TEXT NOT NULL DEFAULT '',
      user_base_dn TEXT NOT NULL DEFAULT '',
      user_filter TEXT NOT NULL DEFAULT '(uid={{username}})',
      display_name_attribute TEXT NOT NULL DEFAULT 'displayName',
      default_role TEXT NOT NULL DEFAULT 'editor'
        CHECK (default_role IN ('admin', 'editor')),
      tls_reject_unauthorized INTEGER NOT NULL DEFAULT 1
        CHECK (tls_reject_unauthorized IN (0, 1)),
      connect_timeout_ms INTEGER NOT NULL DEFAULT 5000,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_username TEXT NOT NULL,
      actor_provider TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'system'
        CHECK (category IN ('auth', 'case', 'user', 'ldap', 'system')),
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created
      ON audit_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_actor
      ON audit_logs (actor_username COLLATE NOCASE, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_action
      ON audit_logs (action, created_at DESC);
  `);

  const caseColumns = database
    .prepare("PRAGMA table_info(cases)")
    .all() as Array<{ name: string }>;
  if (!caseColumns.some((column) => column.name === "record_id")) {
    database.exec("ALTER TABLE cases ADD COLUMN record_id TEXT");
  }
  database.exec(`
    UPDATE cases
    SET record_id = lower(hex(randomblob(16)))
    WHERE record_id IS NULL OR record_id = '';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_record_id
      ON cases (record_id);

    CREATE TABLE IF NOT EXISTS case_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_record_id TEXT NOT NULL,
      case_id TEXT NOT NULL COLLATE NOCASE,
      change_type TEXT NOT NULL
        CHECK (change_type IN ('edit', 'import_overwrite')),
      actor_user_id TEXT NOT NULL DEFAULT '',
      actor_username TEXT NOT NULL,
      actor_display_name TEXT NOT NULL DEFAULT '',
      actor_provider TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      changes_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_case_history_record
      ON case_history (case_record_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_case_history_case_id
      ON case_history (case_id COLLATE NOCASE, id DESC);
  `);

  const auditColumns = database
    .prepare("PRAGMA table_info(audit_logs)")
    .all() as Array<{ name: string }>;
  if (!auditColumns.some((column) => column.name === "category")) {
    database.exec(`
      ALTER TABLE audit_logs
      ADD COLUMN category TEXT NOT NULL DEFAULT 'system'
        CHECK (category IN ('auth', 'case', 'user', 'ldap', 'system'))
    `);
  }
  database.exec(`
    UPDATE audit_logs
    SET category = CASE
      WHEN action LIKE 'auth.%' THEN 'auth'
      WHEN action LIKE 'case.%' THEN 'case'
      WHEN action LIKE 'user.%' THEN 'user'
      WHEN action LIKE 'ldap.%' THEN 'ldap'
      ELSE 'system'
    END
    WHERE category = 'system';

    CREATE INDEX IF NOT EXISTS idx_audit_category
      ON audit_logs (category, created_at DESC);
  `);

  return database;
}

export const db =
  globalForDatabase.ddtInsightDatabase ?? createDatabase();

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.ddtInsightDatabase = db;
}

export { dataDirectory, databasePath };
