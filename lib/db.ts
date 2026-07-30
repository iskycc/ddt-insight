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
  `);

  return database;
}

export const db =
  globalForDatabase.ddtInsightDatabase ?? createDatabase();

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.ddtInsightDatabase = db;
}

export { dataDirectory, databasePath };
