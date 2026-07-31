import Database from "better-sqlite3";
import {
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const dataDirectory = process.env.DDT_DATA_DIR
  ? path.resolve(process.env.DDT_DATA_DIR)
  : path.join(process.cwd(), "data");

mkdirSync(dataDirectory, { recursive: true });

const databasePath = path.join(dataDirectory, "ddt-insight.sqlite");
const pendingRestorePath = path.join(
  dataDirectory,
  ".ddt-insight.restore-pending.sqlite",
);
const pendingSecretPath = path.join(
  dataDirectory,
  ".session-secret.restore-pending",
);
const pendingRestoreMarkerPath = path.join(
  dataDirectory,
  ".restore-pending.json",
);

function fileSha256(filePath: string) {
  const hash = createHash("sha256");
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(
        descriptor,
        buffer,
        0,
        buffer.length,
        null,
      );
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

const globalForDatabase = globalThis as unknown as {
  ddtInsightDatabase?: Database.Database;
};

/**
 * A restore is staged by the maintenance API and activated before SQLite is
 * opened on the next process start. This avoids replacing a live database
 * underneath prepared statements and gives every restore a recoverable,
 * pre-restore copy.
 */
function activatePendingRestore() {
  if (!existsSync(pendingRestoreMarkerPath)) return;

  try {
    const marker = JSON.parse(
      readFileSync(pendingRestoreMarkerPath, "utf8"),
    ) as {
      databaseSha256?: string;
      secretSha256?: string;
      stagedAt?: string;
    };
    if (!marker.databaseSha256) return;

    const suffix = (marker.stagedAt ?? new Date().toISOString())
      .replace(/[:.]/g, "-");
    const recoveryBase = path.join(
      dataDirectory,
      `.pre-restore-${suffix}`,
    );
    const recoveryDatabase = `${recoveryBase}.sqlite`;
    const rollBackDatabaseActivation = () => {
      if (
        !existsSync(databasePath) ||
        fileSha256(databasePath) !== marker.databaseSha256 ||
        !existsSync(recoveryDatabase)
      ) {
        return;
      }
      if (existsSync(pendingRestorePath)) unlinkSync(pendingRestorePath);
      renameSync(databasePath, pendingRestorePath);
      renameSync(recoveryDatabase, databasePath);
      for (const extension of ["-wal", "-shm"]) {
        const current = `${databasePath}${extension}`;
        const recovery = `${recoveryDatabase}${extension}`;
        if (!existsSync(current) && existsSync(recovery)) {
          renameSync(recovery, current);
        }
      }
    };
    const databaseAlreadyActivated =
      existsSync(databasePath) &&
      fileSha256(databasePath) === marker.databaseSha256;

    if (!databaseAlreadyActivated) {
      if (
        !existsSync(pendingRestorePath) ||
        fileSha256(pendingRestorePath) !== marker.databaseSha256
      ) {
        return;
      }

      if (existsSync(databasePath) && !existsSync(recoveryDatabase)) {
        renameSync(databasePath, recoveryDatabase);
      }
      for (const extension of ["-wal", "-shm"]) {
        const current = `${databasePath}${extension}`;
        const recovery = `${recoveryDatabase}${extension}`;
        if (existsSync(current) && !existsSync(recovery)) {
          renameSync(current, recovery);
        }
      }

      try {
        renameSync(pendingRestorePath, databasePath);
      } catch {
        // Roll back a partially started activation so SQLite is never opened
        // against an empty path if the staged rename unexpectedly fails.
        if (!existsSync(databasePath) && existsSync(recoveryDatabase)) {
          renameSync(recoveryDatabase, databasePath);
        }
        for (const extension of ["-wal", "-shm"]) {
          const current = `${databasePath}${extension}`;
          const recovery = `${recoveryDatabase}${extension}`;
          if (!existsSync(current) && existsSync(recovery)) {
            renameSync(recovery, current);
          }
        }
        return;
      }
    } else if (existsSync(pendingRestorePath)) {
      // A crash may happen after the atomic database rename but before the
      // marker is removed. The current hash proves activation already won.
      unlinkSync(pendingRestorePath);
    }

    if (marker.secretSha256) {
      const currentSecret = path.join(dataDirectory, ".session-secret");
      const secretAlreadyActivated =
        existsSync(currentSecret) &&
        fileSha256(currentSecret) === marker.secretSha256;
      if (!secretAlreadyActivated) {
        if (
          !existsSync(pendingSecretPath) ||
          fileSha256(pendingSecretPath) !== marker.secretSha256
        ) {
          rollBackDatabaseActivation();
          return;
        }
        const recoverySecret = `${recoveryBase}.session-secret`;
        if (existsSync(currentSecret) && !existsSync(recoverySecret)) {
          renameSync(currentSecret, recoverySecret);
        }
        try {
          renameSync(pendingSecretPath, currentSecret);
        } catch {
          if (!existsSync(currentSecret) && existsSync(recoverySecret)) {
            renameSync(recoverySecret, currentSecret);
          }
          rollBackDatabaseActivation();
          return;
        }
      } else if (existsSync(pendingSecretPath)) {
        unlinkSync(pendingSecretPath);
      }
    }
    unlinkSync(pendingRestoreMarkerPath);
  } catch {
    // Leave the staged files in place. Diagnostics exposes the pending state
    // so an administrator can retry or inspect it without losing live data.
  }
}

if (!globalForDatabase.ddtInsightDatabase) activatePendingRestore();

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
      email TEXT NOT NULL DEFAULT '',
      groups_json TEXT NOT NULL DEFAULT '[]',
      provider TEXT NOT NULL CHECK (provider IN ('local', 'ldap')),
      role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      is_bootstrap_admin INTEGER NOT NULL DEFAULT 0
        CHECK (is_bootstrap_admin IN (0, 1)),
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
      mail_attribute TEXT NOT NULL DEFAULT 'mail',
      group_attribute TEXT NOT NULL DEFAULT 'memberOf',
      group_search_base TEXT NOT NULL DEFAULT '',
      group_search_filter TEXT NOT NULL DEFAULT '(member={{userDn}})',
      group_name_attribute TEXT NOT NULL DEFAULT 'cn',
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

    CREATE TABLE IF NOT EXISTS api_call_counters (
      day TEXT NOT NULL,
      category TEXT NOT NULL
        CHECK (category IN ('open', 'authenticated', 'anonymous')),
      user_id TEXT NOT NULL DEFAULT '',
      call_count INTEGER NOT NULL DEFAULT 0 CHECK (call_count >= 0),
      last_called_at TEXT NOT NULL,
      PRIMARY KEY (day, category, user_id)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_api_call_counters_user
      ON api_call_counters (user_id, day);
  `);

  const userColumns = database
    .prepare("PRAGMA table_info(users)")
    .all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "email")) {
    database.exec(
      "ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''",
    );
  }
  if (!userColumns.some((column) => column.name === "groups_json")) {
    database.exec(
      "ALTER TABLE users ADD COLUMN groups_json TEXT NOT NULL DEFAULT '[]'",
    );
  }
  if (!userColumns.some((column) => column.name === "is_bootstrap_admin")) {
    database.exec(`
      ALTER TABLE users
      ADD COLUMN is_bootstrap_admin INTEGER NOT NULL DEFAULT 0
        CHECK (is_bootstrap_admin IN (0, 1))
    `);
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_bootstrap_admin
      ON users (is_bootstrap_admin)
      WHERE is_bootstrap_admin = 1
  `);

  const ldapColumns = database
    .prepare("PRAGMA table_info(ldap_config)")
    .all() as Array<{ name: string }>;
  if (!ldapColumns.some((column) => column.name === "mail_attribute")) {
    database.exec(`
      ALTER TABLE ldap_config
      ADD COLUMN mail_attribute TEXT NOT NULL DEFAULT 'mail'
    `);
  }
  if (!ldapColumns.some((column) => column.name === "group_attribute")) {
    database.exec(`
      ALTER TABLE ldap_config
      ADD COLUMN group_attribute TEXT NOT NULL DEFAULT 'memberOf'
    `);
  }
  if (!ldapColumns.some((column) => column.name === "group_search_base")) {
    database.exec(`
      ALTER TABLE ldap_config
      ADD COLUMN group_search_base TEXT NOT NULL DEFAULT ''
    `);
  }
  if (!ldapColumns.some((column) => column.name === "group_search_filter")) {
    database.exec(`
      ALTER TABLE ldap_config
      ADD COLUMN group_search_filter TEXT NOT NULL DEFAULT '(member={{userDn}})'
    `);
  }
  if (!ldapColumns.some((column) => column.name === "group_name_attribute")) {
    database.exec(`
      ALTER TABLE ldap_config
      ADD COLUMN group_name_attribute TEXT NOT NULL DEFAULT 'cn'
    `);
  }

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

    CREATE TABLE IF NOT EXISTS deleted_cases (
      id TEXT PRIMARY KEY,
      case_record_id TEXT NOT NULL,
      case_id TEXT NOT NULL COLLATE NOCASE,
      sr_num TEXT NOT NULL COLLATE NOCASE,
      data_json TEXT NOT NULL,
      source_file_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      deleted_by_user_id TEXT NOT NULL DEFAULT '',
      deleted_by_username TEXT NOT NULL,
      deleted_by_display_name TEXT NOT NULL DEFAULT '',
      deleted_by_provider TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_deleted_cases_deleted_at
      ON deleted_cases (deleted_at DESC, id);
    CREATE INDEX IF NOT EXISTS idx_deleted_cases_case_id
      ON deleted_cases (case_id COLLATE NOCASE, deleted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_deleted_cases_sr_num
      ON deleted_cases (sr_num COLLATE NOCASE, deleted_at DESC);
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

export {
  dataDirectory,
  databasePath,
  pendingRestoreMarkerPath,
  pendingRestorePath,
  pendingSecretPath,
};
