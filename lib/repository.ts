import { randomUUID } from "node:crypto";
import { appendCaseHistory } from "@/lib/case-history";
import { db } from "@/lib/db";
import type {
  AuthSession,
  CaseData,
  CaseListItem,
  DashboardStats,
  ImportResult,
} from "@/lib/types";

interface ImportPayload {
  fileName: string;
  sizeBytes: number;
  columns: string[];
  rows: CaseData[];
  startedAt: number;
  actor: Pick<
    AuthSession,
    "userId" | "username" | "displayName" | "provider"
  >;
}

const caseCache = new Map<string, CaseData>();
const CASE_CACHE_LIMIT = 2_000;

function cacheKey(caseId: string) {
  return caseId.toLocaleLowerCase("en-US");
}

function putCaseInCache(caseId: string, data: CaseData) {
  const key = cacheKey(caseId);
  caseCache.delete(key);
  caseCache.set(key, data);

  if (caseCache.size > CASE_CACHE_LIMIT) {
    const oldest = caseCache.keys().next().value;
    if (oldest) caseCache.delete(oldest);
  }
}

export function invalidateCaseCache(caseId: string) {
  caseCache.delete(cacheKey(caseId));
}

export function importCases(payload: ImportPayload): ImportResult {
  const now = new Date().toISOString();
  const fileId = randomUUID();
  const uniqueSrNums = new Set(
    payload.rows.map((row) => String(row.srNum ?? "")),
  );

  const existingStatement = db.prepare(`
    SELECT record_id AS recordId, data_json AS dataJson
    FROM cases
    WHERE case_id = ?
    LIMIT 1
  `);
  const insertFileStatement = db.prepare(`
    INSERT INTO source_files (
      id, original_name, imported_at, row_count, column_count,
      columns_json, sr_nums_json, size_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertCaseStatement = db.prepare(`
    INSERT INTO cases (
      case_id, record_id, sr_num, data_json, source_file_id, source_name,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(case_id) DO UPDATE SET
      case_id = excluded.case_id,
      sr_num = excluded.sr_num,
      data_json = excluded.data_json,
      source_file_id = excluded.source_file_id,
      source_name = excluded.source_name,
      updated_at = excluded.updated_at
  `);
  const activityStatement = db.prepare(`
    INSERT INTO activity (kind, detail, amount, created_at)
    VALUES ('import', ?, ?, ?)
  `);

  let inserted = 0;
  let updated = 0;

  const transaction = db.transaction(() => {
    insertFileStatement.run(
      fileId,
      payload.fileName,
      now,
      payload.rows.length,
      payload.columns.length,
      JSON.stringify(payload.columns),
      JSON.stringify([...uniqueSrNums]),
      payload.sizeBytes,
    );

    for (const row of payload.rows) {
      const caseId = String(row.CaseID);
      const srNum = String(row.srNum);
      const existing = existingStatement.get(caseId) as
        | { recordId: string; dataJson: string }
        | undefined;
      const recordId = existing?.recordId ?? randomUUID();

      upsertCaseStatement.run(
        caseId,
        recordId,
        srNum,
        JSON.stringify(row),
        fileId,
        payload.fileName,
        now,
        now,
      );

      if (existing) {
        updated += 1;
        appendCaseHistory({
          caseRecordId: existing.recordId,
          caseId,
          changeType: "import_overwrite",
          actor: payload.actor,
          sourceName: payload.fileName,
          before: JSON.parse(existing.dataJson) as CaseData,
          after: row,
          createdAt: now,
        });
      } else {
        inserted += 1;
      }
      invalidateCaseCache(caseId);
    }

    activityStatement.run(payload.fileName, payload.rows.length, now);
  });

  transaction();

  return {
    fileName: payload.fileName,
    imported: payload.rows.length,
    inserted,
    updated,
    srNums: uniqueSrNums.size,
    durationMs: Date.now() - payload.startedAt,
  };
}

export function getCase(caseId: string): CaseData | null {
  const key = cacheKey(caseId);
  const cached = caseCache.get(key);

  if (cached) {
    caseCache.delete(key);
    caseCache.set(key, cached);
    return cached;
  }

  const row = db
    .prepare("SELECT data_json FROM cases WHERE case_id = ? LIMIT 1")
    .get(caseId) as { data_json: string } | undefined;

  if (!row) return null;

  const data = JSON.parse(row.data_json) as CaseData;
  putCaseInCache(caseId, data);
  return data;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function listCases(options: {
  query?: string;
  srNum?: string;
  limit?: number;
  offset?: number;
}) {
  const query = options.query?.trim() ?? "";
  const srNum = options.srNum?.trim() ?? "";
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where: string[] = [];
  const parameters: Array<string | number> = [];

  if (query) {
    where.push("case_id LIKE ? ESCAPE '\\'");
    parameters.push(`${escapeLike(query)}%`);
  }

  if (srNum) {
    where.push("sr_num = ? COLLATE NOCASE");
    parameters.push(srNum);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`
      SELECT
        case_id AS caseId,
        sr_num AS srNum,
        updated_at AS updatedAt,
        source_name AS sourceName
      FROM cases
      ${whereClause}
      ORDER BY case_id COLLATE NOCASE
      LIMIT ? OFFSET ?
    `)
    .all(...parameters, limit + 1, offset) as CaseListItem[];

  return {
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
    offset,
    limit,
  };
}

export function listGroups(query = "", limit = 100) {
  const trimmedQuery = query.trim();
  const parameters: Array<string | number> = [];
  const whereClause = trimmedQuery
    ? "WHERE sr_num LIKE ? ESCAPE '\\'"
    : "";

  if (trimmedQuery) parameters.push(`${escapeLike(trimmedQuery)}%`);
  parameters.push(Math.min(Math.max(limit, 1), 500));

  return db
    .prepare(`
      SELECT sr_num AS srNum, COUNT(*) AS count
      FROM cases
      ${whereClause}
      GROUP BY sr_num COLLATE NOCASE
      ORDER BY count DESC, sr_num COLLATE NOCASE
      LIMIT ?
    `)
    .all(...parameters) as Array<{ srNum: string; count: number }>;
}

export function updateCaseColumn(
  caseId: string,
  column: string,
  value: string | number | boolean | null,
  actor: Pick<
    AuthSession,
    "userId" | "username" | "displayName" | "provider"
  >,
) {
  const stored = db
    .prepare(`
      SELECT record_id AS recordId, data_json AS dataJson
      FROM cases
      WHERE case_id = ?
      LIMIT 1
    `)
    .get(caseId) as { recordId: string; dataJson: string } | undefined;
  if (!stored) return null;

  const existing = JSON.parse(stored.dataJson) as CaseData;
  if (!(column in existing)) {
    throw new Error(`列“${column}”不存在`);
  }

  const next: CaseData = { ...existing, [column]: value };
  if (Object.is(existing[column], value)) return existing;

  const now = new Date().toISOString();

  if (column === "CaseID") {
    const nextCaseId = String(value ?? "").trim();
    if (!nextCaseId) throw new Error("CaseID 不能为空");
    if (nextCaseId.length > 512) throw new Error("CaseID 不能超过 512 个字符");

    const duplicate = db
      .prepare(`
        SELECT case_id FROM cases
        WHERE case_id = ? COLLATE NOCASE
          AND record_id != ?
        LIMIT 1
      `)
      .get(nextCaseId, stored.recordId);
    if (duplicate) throw new Error(`CaseID “${nextCaseId}”已经存在`);

    next.CaseID = nextCaseId;

    try {
      db.transaction(() => {
        db.prepare(`
          UPDATE cases
          SET case_id = ?, data_json = ?, updated_at = ?
          WHERE case_id = ?
        `).run(nextCaseId, JSON.stringify(next), now, caseId);
        db.prepare(`
          INSERT INTO activity (kind, detail, amount, created_at)
          VALUES ('edit', ?, 1, ?)
        `).run(`${caseId} → ${nextCaseId}`, now);
        appendCaseHistory({
          caseRecordId: stored.recordId,
          caseId: nextCaseId,
          changeType: "edit",
          actor,
          sourceName: "工作台编辑",
          before: existing,
          after: next,
          createdAt: now,
        });
      })();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed")
      ) {
        throw new Error(`CaseID “${nextCaseId}”已经存在`);
      }
      throw error;
    }

    invalidateCaseCache(caseId);
    putCaseInCache(nextCaseId, next);
    return next;
  }

  if (column === "srNum" && !String(value ?? "").trim()) {
    throw new Error("srNum 不能为空");
  }

  const srNum =
    column === "srNum" ? String(value ?? "") : String(next.srNum ?? "");

  db.transaction(() => {
    db.prepare(`
      UPDATE cases
      SET sr_num = ?, data_json = ?, updated_at = ?
      WHERE case_id = ?
    `).run(srNum, JSON.stringify(next), now, caseId);
    db.prepare(`
      INSERT INTO activity (kind, detail, amount, created_at)
      VALUES ('edit', ?, 1, ?)
    `).run(caseId, now);
    appendCaseHistory({
      caseRecordId: stored.recordId,
      caseId,
      changeType: "edit",
      actor,
      sourceName: "工作台编辑",
      before: existing,
      after: next,
      createdAt: now,
    });
  })();

  putCaseInCache(caseId, next);
  return next;
}

export function deleteCase(caseId: string) {
  const existing = db
    .prepare(`
      SELECT
        case_id AS caseId,
        sr_num AS srNum,
        source_name AS sourceName
      FROM cases
      WHERE case_id = ?
      LIMIT 1
    `)
    .get(caseId) as
    | { caseId: string; srNum: string; sourceName: string }
    | undefined;

  if (!existing) return null;

  db.prepare("DELETE FROM cases WHERE case_id = ?").run(caseId);
  invalidateCaseCache(caseId);
  return existing;
}

export function getCasesForExport(options: {
  srNum?: string;
  caseIds?: string[];
}) {
  const srNum = options.srNum?.trim();
  const caseIds = options.caseIds?.filter(Boolean) ?? [];

  let rows: Array<{ data_json: string }>;

  if (caseIds.length) {
    const placeholders = caseIds.map(() => "?").join(",");
    rows = db
      .prepare(`
        SELECT data_json FROM cases
        WHERE case_id IN (${placeholders})
        ORDER BY case_id COLLATE NOCASE
      `)
      .all(...caseIds) as Array<{ data_json: string }>;
  } else if (srNum) {
    rows = db
      .prepare(`
        SELECT data_json FROM cases
        WHERE sr_num = ? COLLATE NOCASE
        ORDER BY case_id COLLATE NOCASE
      `)
      .all(srNum) as Array<{ data_json: string }>;
  } else {
    rows = db
      .prepare(`
        SELECT data_json FROM cases
        ORDER BY case_id COLLATE NOCASE
      `)
      .all() as Array<{ data_json: string }>;
  }

  return rows.map((row) => JSON.parse(row.data_json) as CaseData);
}

function localDateKey(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getDashboardStats(): DashboardStats {
  const totals = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM cases) AS totalCases,
        (SELECT COUNT(DISTINCT sr_num) FROM cases) AS totalGroups,
        (SELECT COUNT(*) FROM source_files) AS totalFiles,
        (SELECT COUNT(*) FROM source_files
          WHERE date(imported_at, 'localtime') = date('now', 'localtime')
        ) AS importedToday,
        (SELECT COUNT(*) FROM cases
          WHERE date(updated_at, 'localtime') = date('now', 'localtime')
        ) AS updatedToday
    `)
    .get() as {
    totalCases: number;
    totalGroups: number;
    totalFiles: number;
    importedToday: number;
    updatedToday: number;
  };

  const groups = db
    .prepare(`
      SELECT sr_num AS srNum, COUNT(*) AS count
      FROM cases
      GROUP BY sr_num COLLATE NOCASE
      ORDER BY count DESC
      LIMIT 6
    `)
    .all() as Array<{ srNum: string; count: number }>;

  const recentImports = db
    .prepare(`
      SELECT
        id,
        original_name AS fileName,
        row_count AS rowCount,
        imported_at AS importedAt
      FROM source_files
      ORDER BY imported_at DESC
      LIMIT 5
    `)
    .all() as DashboardStats["recentImports"];

  const start = new Date();
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  const dailyRows = db
    .prepare(`
      SELECT substr(imported_at, 1, 10) AS date, SUM(row_count) AS count
      FROM source_files
      WHERE imported_at >= ?
      GROUP BY substr(imported_at, 1, 10)
    `)
    .all(start.toISOString()) as Array<{ date: string; count: number }>;
  const dailyMap = new Map(dailyRows.map((row) => [row.date, row.count]));
  const timeline: DashboardStats["timeline"] = [];

  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const key = localDateKey(date);
    timeline.push({ date: key, count: dailyMap.get(key) ?? 0 });
  }

  return { ...totals, groups, timeline, recentImports };
}
