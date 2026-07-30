import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { writeAudit } from "@/lib/audit";
import {
  createJourneyCase,
  getCaseCell,
  getJourneySteps,
  isJourneyCase,
  sortStepNames,
} from "@/lib/case-data";
import {
  getCaseTemplateForSrNum,
  validateCaseAgainstTemplate,
  type CaseTemplate,
} from "@/lib/case-management";
import { dataDirectory, db } from "@/lib/db";
import {
  importParsedSpreadsheet,
  parseSpreadsheet,
  type ParsedSpreadsheet,
} from "@/lib/spreadsheet";
import type {
  AuthSession,
  CaseData,
  CaseStepData,
  ImportResult,
} from "@/lib/types";

export type ImportConflictStrategy = "overwrite" | "skip" | "error";
export type ImportJobStatus =
  | "previewing"
  | "previewed"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ImportUpload {
  fileName: string;
  buffer: Buffer;
}

export interface ImportFileError {
  fileName: string;
  error: string;
}

interface PreviewFile {
  id: string;
  fileName: string;
  storedName: string;
  sizeBytes: number;
  status: string;
  totalRows: number;
  newRows: number;
  changedRows: number;
  unchangedRows: number;
  importedRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  error: string;
}

type ImportFileView = Omit<PreviewFile, "storedName">;

interface StoredJob {
  id: string;
  status: ImportJobStatus;
  strategy: ImportConflictStrategy;
  actorUserId: string;
  actorUsername: string;
  actorDisplayName: string;
  actorProvider: string;
  totalFiles: number;
  totalRows: number;
  processedFiles: number;
  processedRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  unchangedRows: number;
  failedFiles: number;
  cancelRequested: number;
  errorsJson: string;
  requestIp: string;
  requestUserAgent: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
}

export interface ImportJobView {
  id: string;
  status: ImportJobStatus;
  strategy: ImportConflictStrategy;
  actor: {
    userId: string;
    username: string;
    displayName: string;
    provider: string;
  };
  totals: {
    files: number;
    rows: number;
    newRows: number;
    changedRows: number;
    unchangedRows: number;
  };
  progress: {
    files: number;
    rows: number;
    percent: number;
  };
  result: {
    inserted: number;
    updated: number;
    skipped: number;
    unchanged: number;
    failedFiles: number;
  };
  files: ImportFileView[];
  errors: ImportFileError[];
  canStart: boolean;
  canCancel: boolean;
  createdAt: string;
  startedAt: string;
  completedAt: string;
}

const uploadRoot = path.join(dataDirectory, "import-jobs");
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1_000;
const CASE_QUERY_CHUNK = 400;
const MAX_CONFLICT_EXAMPLES = 30;

const globalForImports = globalThis as unknown as {
  ddtImportWorker?: {
    active: boolean;
    recovered: boolean;
  };
};

const workerState =
  globalForImports.ddtImportWorker ??
  (globalForImports.ddtImportWorker = {
    active: false,
    recovered: false,
  });

function ensureImportTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      strategy TEXT NOT NULL DEFAULT 'overwrite',
      actor_user_id TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      actor_display_name TEXT NOT NULL DEFAULT '',
      actor_provider TEXT NOT NULL DEFAULT '',
      total_files INTEGER NOT NULL DEFAULT 0,
      total_rows INTEGER NOT NULL DEFAULT 0,
      processed_files INTEGER NOT NULL DEFAULT 0,
      processed_rows INTEGER NOT NULL DEFAULT 0,
      inserted_rows INTEGER NOT NULL DEFAULT 0,
      updated_rows INTEGER NOT NULL DEFAULT 0,
      skipped_rows INTEGER NOT NULL DEFAULT 0,
      unchanged_rows INTEGER NOT NULL DEFAULT 0,
      failed_files INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      request_ip TEXT NOT NULL DEFAULT '',
      request_user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_import_jobs_created
      ON import_jobs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_import_jobs_status
      ON import_jobs (status, created_at);
    CREATE INDEX IF NOT EXISTS idx_import_jobs_actor
      ON import_jobs (actor_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS import_job_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      stored_name TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      total_rows INTEGER NOT NULL DEFAULT 0,
      new_rows INTEGER NOT NULL DEFAULT 0,
      changed_rows INTEGER NOT NULL DEFAULT 0,
      unchanged_rows INTEGER NOT NULL DEFAULT 0,
      imported_rows INTEGER NOT NULL DEFAULT 0,
      inserted_rows INTEGER NOT NULL DEFAULT 0,
      updated_rows INTEGER NOT NULL DEFAULT 0,
      skipped_rows INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (job_id) REFERENCES import_jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_import_job_files_job
      ON import_job_files (job_id, ordinal);
  `);
}

function jobDirectory(jobId: string) {
  if (!/^[0-9a-f-]{36}$/.test(jobId)) {
    throw new Error("无效的导入任务标识");
  }
  return path.join(uploadRoot, jobId);
}

function parseErrors(value: string): ImportFileError[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ImportFileError[]) : [];
  } catch {
    return [];
  }
}

function sameCaseData(left: CaseData, right: CaseData) {
  return isDeepStrictEqual(left, right);
}

export function validateImportSpreadsheet(parsed: ParsedSpreadsheet) {
  const templates = new Map<string, CaseTemplate | null>();
  const invalid: string[] = [];
  let invalidCount = 0;
  const rows = parsed.rows.map((row) => {
    const srNum = String(getCaseCell(row, "srNum") ?? "");
    const key = srNum.toLocaleLowerCase("en-US");
    if (!templates.has(key)) {
      templates.set(key, getCaseTemplateForSrNum(srNum));
    }

    if (isJourneyCase(row)) {
      const steps = getJourneySteps(row)!;
      const validatedSteps = Object.fromEntries(
        sortStepNames(Object.keys(steps)).map((stepName) => {
          const validation = validateCaseAgainstTemplate(
            steps[stepName],
            templates.get(key) ?? null,
            { applyDefaults: true },
          );
          if (!validation.valid) {
            invalidCount += 1;
            if (invalid.length < 20) {
              invalid.push(
                `CaseID ${String(getCaseCell(row, "CaseID"))} / ${stepName}：${validation.errors
                  .map((issue) => issue.message)
                  .join("；")}`,
              );
            }
          }
          return [stepName, validation.data as CaseStepData];
        }),
      );
      return createJourneyCase(
        String(getCaseCell(row, "CaseID") ?? ""),
        srNum,
        validatedSteps,
      );
    }

    const validation = validateCaseAgainstTemplate(
      row,
      templates.get(key) ?? null,
      { applyDefaults: true },
    );
    if (!validation.valid) {
      invalidCount += 1;
      if (invalid.length < 20) {
        invalid.push(
          `CaseID ${String(getCaseCell(row, "CaseID"))}：${validation.errors
            .map((issue) => issue.message)
            .join("；")}`,
        );
      }
    }
    return validation.data;
  });
  if (invalidCount) {
    const remainder = invalidCount > invalid.length
      ? `；另有 ${invalidCount - invalid.length} 行`
      : "";
    throw new Error(`模板校验未通过：${invalid.join("；")}${remainder}`);
  }

  const columns = [...parsed.columns];
  for (const row of rows) {
    const steps = getJourneySteps(row);
    if (steps) {
      for (const stepName of sortStepNames(Object.keys(steps))) {
        for (const column of Object.keys(steps[stepName])) {
          const qualifiedColumn = `${stepName}.${column}`;
          if (!columns.includes(qualifiedColumn)) {
            columns.push(qualifiedColumn);
          }
        }
      }
    } else {
      for (const column of Object.keys(row)) {
        if (!columns.includes(column)) columns.push(column);
      }
    }
  }
  return { ...parsed, columns, rows };
}

function loadExistingCases(caseIds: string[]) {
  const result = new Map<string, CaseData>();
  const unique = [...new Set(caseIds.map((value) => value.toLocaleLowerCase("en-US")))];

  for (let start = 0; start < unique.length; start += CASE_QUERY_CHUNK) {
    const chunk = unique.slice(start, start + CASE_QUERY_CHUNK);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(`
        SELECT case_id AS caseId, data_json AS dataJson
        FROM cases
        WHERE case_id IN (${placeholders})
      `)
      .all(...chunk) as Array<{ caseId: string; dataJson: string }>;
    for (const row of rows) {
      result.set(
        row.caseId.toLocaleLowerCase("en-US"),
        JSON.parse(row.dataJson) as CaseData,
      );
    }
  }
  return result;
}

function classifyRows(
  rows: CaseData[],
  current: Map<string, CaseData>,
  updateVirtualState = false,
) {
  const added: CaseData[] = [];
  const changed: CaseData[] = [];
  const unchanged: CaseData[] = [];

  for (const row of rows) {
    const key = String(row.CaseID).toLocaleLowerCase("en-US");
    const before = current.get(key);
    if (!before) added.push(row);
    else if (sameCaseData(before, row)) unchanged.push(row);
    else changed.push(row);
    if (updateVirtualState) current.set(key, row);
  }

  return { added, changed, unchanged };
}

function getStoredJob(jobId: string) {
  ensureImportTables();
  return db
    .prepare(`
      SELECT
        id, status, strategy,
        actor_user_id AS actorUserId,
        actor_username AS actorUsername,
        actor_display_name AS actorDisplayName,
        actor_provider AS actorProvider,
        total_files AS totalFiles,
        total_rows AS totalRows,
        processed_files AS processedFiles,
        processed_rows AS processedRows,
        inserted_rows AS insertedRows,
        updated_rows AS updatedRows,
        skipped_rows AS skippedRows,
        unchanged_rows AS unchangedRows,
        failed_files AS failedFiles,
        cancel_requested AS cancelRequested,
        errors_json AS errorsJson,
        request_ip AS requestIp,
        request_user_agent AS requestUserAgent,
        created_at AS createdAt,
        started_at AS startedAt,
        completed_at AS completedAt
      FROM import_jobs
      WHERE id = ?
      LIMIT 1
    `)
    .get(jobId) as StoredJob | undefined;
}

function listJobFiles(jobId: string) {
  return db
    .prepare(`
      SELECT
        id, file_name AS fileName, stored_name AS storedName,
        size_bytes AS sizeBytes, status, total_rows AS totalRows,
        new_rows AS newRows, changed_rows AS changedRows,
        unchanged_rows AS unchangedRows, imported_rows AS importedRows,
        inserted_rows AS insertedRows, updated_rows AS updatedRows,
        skipped_rows AS skippedRows, error
      FROM import_job_files
      WHERE job_id = ?
      ORDER BY ordinal
    `)
    .all(jobId) as PreviewFile[];
}

function toJobView(job: StoredJob): ImportJobView {
  const files = listJobFiles(job.id);
  const publicFiles = files.map(({ storedName: _storedName, ...file }) => file);
  const newRows = files.reduce((total, file) => total + file.newRows, 0);
  const changedRows = files.reduce(
    (total, file) => total + file.changedRows,
    0,
  );
  const unchangedRows = files.reduce(
    (total, file) => total + file.unchangedRows,
    0,
  );
  const percent =
    job.totalRows > 0
      ? Math.min(100, Math.round((job.processedRows / job.totalRows) * 100))
      : job.status === "completed"
        ? 100
        : 0;

  return {
    id: job.id,
    status: job.status,
    strategy: job.strategy,
    actor: {
      userId: job.actorUserId,
      username: job.actorUsername,
      displayName: job.actorDisplayName,
      provider: job.actorProvider,
    },
    totals: {
      files: job.totalFiles,
      rows: job.totalRows,
      newRows,
      changedRows,
      unchangedRows,
    },
    progress: {
      files: job.processedFiles,
      rows: job.processedRows,
      percent,
    },
    result: {
      inserted: job.insertedRows,
      updated: job.updatedRows,
      skipped: job.skippedRows,
      unchanged: job.unchangedRows,
      failedFiles: job.failedFiles,
    },
    files: publicFiles,
    errors: parseErrors(job.errorsJson),
    canStart:
      job.status === "previewed" &&
      job.failedFiles === 0 &&
      files.some((file) => file.storedName),
    canCancel: ["previewed", "queued", "running"].includes(job.status),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

async function cleanupJobUploads(jobId: string) {
  await rm(jobDirectory(jobId), { recursive: true, force: true });
}

async function cleanupExpiredPreviews() {
  ensureImportTables();
  const cutoff = new Date(Date.now() - PREVIEW_TTL_MS).toISOString();
  const expired = db
    .prepare(`
      SELECT id
      FROM import_jobs
      WHERE status IN ('previewing', 'previewed')
        AND created_at < ?
      LIMIT 100
    `)
    .all(cutoff) as Array<{ id: string }>;

  if (!expired.length) return;
  const completedAt = new Date().toISOString();
  const mark = db.prepare(`
    UPDATE import_jobs
    SET status = 'cancelled', completed_at = ?,
        errors_json = '[{"fileName":"导入任务","error":"预检结果已过期"}]'
    WHERE id = ? AND status IN ('previewing', 'previewed')
  `);
  db.transaction(() => {
    for (const item of expired) mark.run(completedAt, item.id);
  })();
  await Promise.allSettled(expired.map((item) => cleanupJobUploads(item.id)));
}

export async function createImportPreview(input: {
  spreadsheets: ImportUpload[];
  extractionErrors?: ImportFileError[];
  actor: Pick<
    AuthSession,
    "userId" | "username" | "displayName" | "provider"
  >;
  requestIp?: string;
  requestUserAgent?: string;
}) {
  ensureImportTables();
  await cleanupExpiredPreviews();

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const directory = jobDirectory(id);
  const parsedFiles: Array<{
    id: string;
    storedName: string;
    parsed: ParsedSpreadsheet;
  }> = [];
  const errors = [...(input.extractionErrors ?? [])];

  db.prepare(`
    INSERT INTO import_jobs (
      id, status, strategy, actor_user_id, actor_username,
      actor_display_name, actor_provider, total_files, failed_files,
      errors_json, request_ip, request_user_agent, created_at
    ) VALUES (?, 'previewing', 'overwrite', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.actor.userId,
    input.actor.username,
    input.actor.displayName,
    input.actor.provider,
    input.spreadsheets.length + errors.length,
    errors.length,
    JSON.stringify(errors),
    (input.requestIp ?? "").slice(0, 128),
    (input.requestUserAgent ?? "").slice(0, 512),
    createdAt,
  );

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const upload of input.spreadsheets) {
      try {
        const parsed = validateImportSpreadsheet(
          parseSpreadsheet(upload.buffer, upload.fileName),
        );
        const fileId = randomUUID();
        const storedName = `${fileId}.sheet`;
        await writeFile(path.join(directory, storedName), upload.buffer, {
          flag: "wx",
          mode: 0o600,
        });
        parsedFiles.push({ id: fileId, storedName, parsed });
      } catch (error) {
        errors.push({
          fileName: upload.fileName,
          error: error instanceof Error ? error.message : "预检失败",
        });
      }
    }

    const allCaseIds = parsedFiles.flatMap(({ parsed }) =>
      parsed.rows.map((row) => String(row.CaseID)),
    );
    const virtualCases = loadExistingCases(allCaseIds);
    const previews = parsedFiles.map((file) => ({
      ...file,
      classification: classifyRows(file.parsed.rows, virtualCases, true),
    }));
    const totalRows = previews.reduce(
      (total, file) => total + file.parsed.rows.length,
      0,
    );
    const status: ImportJobStatus = parsedFiles.length ? "previewed" : "failed";
    const completedAt = status === "failed" ? createdAt : "";

    db.transaction(() => {
      db.prepare(`
        UPDATE import_jobs
        SET status = ?, total_files = ?, total_rows = ?,
            processed_files = ?, failed_files = ?, errors_json = ?,
            completed_at = ?
        WHERE id = ?
      `).run(
        status,
        parsedFiles.length + errors.length,
        totalRows,
        errors.length,
        errors.length,
        JSON.stringify(errors),
        completedAt,
        id,
      );

      const insertFile = db.prepare(`
        INSERT INTO import_job_files (
          id, job_id, ordinal, file_name, stored_name, size_bytes, status,
          total_rows, new_rows, changed_rows, unchanged_rows
        ) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)
      `);
      previews.forEach((file, index) => {
        insertFile.run(
          file.id,
          id,
          index,
          file.parsed.fileName,
          file.storedName,
          file.parsed.sizeBytes,
          file.parsed.rows.length,
          file.classification.added.length,
          file.classification.changed.length,
          file.classification.unchanged.length,
        );
      });
      const insertError = db.prepare(`
        INSERT INTO import_job_files (
          id, job_id, ordinal, file_name, status, error
        ) VALUES (?, ?, ?, ?, 'failed', ?)
      `);
      errors.forEach((error, index) => {
        insertError.run(
          randomUUID(),
          id,
          previews.length + index,
          error.fileName,
          error.error,
        );
      });
    })();

    if (status === "failed") await cleanupJobUploads(id);
    return toJobView(getStoredJob(id)!);
  } catch (error) {
    db.prepare(`
      UPDATE import_jobs
      SET status = 'failed', completed_at = ?, errors_json = ?
      WHERE id = ?
    `).run(
      new Date().toISOString(),
      JSON.stringify([
        ...errors,
        {
          fileName: "导入预检",
          error: error instanceof Error ? error.message : "预检失败",
        },
      ]),
      id,
    );
    await cleanupJobUploads(id);
    throw error;
  }
}

export function getImportJob(
  jobId: string,
  session: Pick<AuthSession, "userId" | "role">,
) {
  const job = getStoredJob(jobId);
  if (!job) return null;
  if (session.role !== "admin" && job.actorUserId !== session.userId) return null;
  return toJobView(job);
}

export function enqueueImportJob(
  jobId: string,
  strategy: ImportConflictStrategy,
  session: Pick<AuthSession, "userId" | "role">,
) {
  const job = getStoredJob(jobId);
  if (!job) return null;
  if (session.role !== "admin" && job.actorUserId !== session.userId) return null;
  if (job.status !== "previewed") {
    throw new Error("该预检任务当前无法开始导入");
  }

  const changedRows = listJobFiles(jobId).reduce(
    (total, file) => total + file.changedRows,
    0,
  );
  if (strategy === "error" && changedRows > 0) {
    throw new Error(`检测到 ${changedRows} 条覆盖冲突，已按策略终止`);
  }

  db.prepare(`
    UPDATE import_jobs
    SET status = 'queued', strategy = ?, cancel_requested = 0
    WHERE id = ? AND status = 'previewed'
  `).run(strategy, jobId);
  kickImportWorker();
  return toJobView(getStoredJob(jobId)!);
}

export async function cancelImportJob(
  jobId: string,
  session: Pick<AuthSession, "userId" | "role">,
) {
  const job = getStoredJob(jobId);
  if (!job) return null;
  if (session.role !== "admin" && job.actorUserId !== session.userId) return null;

  const now = new Date().toISOString();
  if (job.status === "running") {
    db.prepare(`
      UPDATE import_jobs
      SET cancel_requested = 1
      WHERE id = ? AND status = 'running'
    `).run(jobId);
  } else if (job.status === "previewed" || job.status === "queued") {
    const result = db.prepare(`
      UPDATE import_jobs
      SET status = 'cancelled', cancel_requested = 1, completed_at = ?
      WHERE id = ? AND status IN ('previewed', 'queued')
    `).run(now, jobId);
    if (result.changes) {
      await cleanupJobUploads(jobId);
    } else {
      db.prepare(`
        UPDATE import_jobs
        SET cancel_requested = 1
        WHERE id = ? AND status = 'running'
      `).run(jobId);
    }
  }
  return toJobView(getStoredJob(jobId)!);
}

function appendJobError(jobId: string, error: ImportFileError) {
  const job = getStoredJob(jobId);
  if (!job) return;
  const errors = parseErrors(job.errorsJson);
  errors.push(error);
  db.prepare("UPDATE import_jobs SET errors_json = ? WHERE id = ?").run(
    JSON.stringify(errors),
    jobId,
  );
}

function claimNextJob() {
  ensureImportTables();
  return db.transaction(() => {
    const next = db
      .prepare(`
        SELECT id FROM import_jobs
        WHERE status = 'queued'
        ORDER BY created_at
        LIMIT 1
      `)
      .get() as { id: string } | undefined;
    if (!next) return null;
    const result = db
      .prepare(`
        UPDATE import_jobs
        SET status = 'running', started_at = ?
        WHERE id = ? AND status = 'queued'
      `)
      .run(new Date().toISOString(), next.id);
    return result.changes ? next.id : null;
  })();
}

async function loadParsedFile(jobId: string, file: PreviewFile) {
  const buffer = await readFile(path.join(jobDirectory(jobId), file.storedName));
  return validateImportSpreadsheet(parseSpreadsheet(buffer, file.fileName));
}

function markJobTerminal(
  job: StoredJob,
  status: "completed" | "failed" | "cancelled",
  error?: string,
) {
  const now = new Date().toISOString();
  if (error) {
    appendJobError(job.id, { fileName: "导入任务", error });
  }
  db.prepare(`
    UPDATE import_jobs
    SET status = ?, completed_at = ?
    WHERE id = ?
  `).run(status, now, job.id);

  const result = getStoredJob(job.id)!;
  writeAudit({
    actorUsername: result.actorUsername,
    actorProvider: result.actorProvider,
    action: "case.import",
    resourceType: "import_job",
    resourceId: result.id,
    result: status === "completed" ? "success" : "failure",
    ipAddress: result.requestIp,
    userAgent: result.requestUserAgent,
    detail: {
      status,
      strategy: result.strategy,
      files: result.totalFiles,
      rows: result.totalRows,
      insertedRows: result.insertedRows,
      updatedRows: result.updatedRows,
      skippedRows: result.skippedRows,
      unchangedRows: result.unchangedRows,
      failedFiles: result.failedFiles,
    },
  });
}

async function processClaimedJob(jobId: string) {
  const initial = getStoredJob(jobId);
  if (!initial) return;
  const files = listJobFiles(jobId).filter((file) => file.storedName);

  try {
    let preparedForError:
      | Array<{
          file: PreviewFile;
          parsed: ParsedSpreadsheet;
          classification: ReturnType<typeof classifyRows>;
        }>
      | undefined;

    if (initial.strategy === "error") {
      const parsed = await Promise.all(
        files.map(async (file) => ({
          file,
          parsed: await loadParsedFile(jobId, file),
        })),
      );
      const allCaseIds = parsed.flatMap(({ parsed: spreadsheet }) =>
        spreadsheet.rows.map((row) => String(row.CaseID)),
      );
      const virtual = loadExistingCases(allCaseIds);
      preparedForError = parsed.map((item) => ({
        ...item,
        classification: classifyRows(item.parsed.rows, virtual, true),
      }));
      const conflicts = preparedForError.flatMap((item) =>
        item.classification.changed.map((row) => String(row.CaseID)),
      );
      if (conflicts.length) {
        throw new Error(
          `执行前检测到 ${conflicts.length} 条覆盖冲突（${conflicts
            .slice(0, MAX_CONFLICT_EXAMPLES)
            .join("、")}），未写入任何用例`,
        );
      }
    }

    for (let index = 0; index < files.length; index += 1) {
      const latest = getStoredJob(jobId);
      if (!latest) return;
      if (latest.cancelRequested) {
        db.prepare(`
          UPDATE import_job_files
          SET status = 'cancelled'
          WHERE job_id = ? AND status = 'ready'
        `).run(jobId);
        markJobTerminal(latest, "cancelled");
        return;
      }

      const file = files[index]!;
      db.prepare(`
        UPDATE import_job_files SET status = 'importing' WHERE id = ?
      `).run(file.id);

      try {
        const parsed =
          preparedForError?.[index]?.parsed ??
          (await loadParsedFile(jobId, file));
        const classification =
          preparedForError?.[index]?.classification ??
          classifyRows(
            parsed.rows,
            loadExistingCases(parsed.rows.map((row) => String(row.CaseID))),
          );
        const rows =
          latest.strategy === "overwrite"
            ? [...classification.added, ...classification.changed]
            : classification.added;
        const skipped =
          latest.strategy === "skip" ? classification.changed.length : 0;
        let result: ImportResult | null = null;

        if (rows.length) {
          result = importParsedSpreadsheet(
            { ...parsed, rows, startedAt: Date.now() },
            {
              userId: latest.actorUserId,
              username: latest.actorUsername,
              displayName: latest.actorDisplayName,
              provider:
                latest.actorProvider === "ldap" ? "ldap" : "local",
            },
          );
        }

        db.transaction(() => {
          db.prepare(`
            UPDATE import_job_files
            SET status = 'completed', imported_rows = ?,
                inserted_rows = ?, updated_rows = ?, skipped_rows = ?,
                new_rows = ?, changed_rows = ?, unchanged_rows = ?
            WHERE id = ?
          `).run(
            result?.imported ?? 0,
            result?.inserted ?? 0,
            result?.updated ?? 0,
            skipped,
            classification.added.length,
            classification.changed.length,
            classification.unchanged.length,
            file.id,
          );
          db.prepare(`
            UPDATE import_jobs
            SET processed_files = processed_files + 1,
                processed_rows = processed_rows + ?,
                inserted_rows = inserted_rows + ?,
                updated_rows = updated_rows + ?,
                skipped_rows = skipped_rows + ?,
                unchanged_rows = unchanged_rows + ?
            WHERE id = ?
          `).run(
            parsed.rows.length,
            result?.inserted ?? 0,
            result?.updated ?? 0,
            skipped,
            classification.unchanged.length,
            jobId,
          );
        })();
      } catch (error) {
        const message = error instanceof Error ? error.message : "导入失败";
        db.prepare(`
          UPDATE import_job_files SET status = 'failed', error = ? WHERE id = ?
        `).run(message, file.id);
        db.prepare(`
          UPDATE import_jobs
          SET processed_files = processed_files + 1,
              processed_rows = processed_rows + ?,
              failed_files = failed_files + 1
          WHERE id = ?
        `).run(file.totalRows, jobId);
        appendJobError(jobId, { fileName: file.fileName, error: message });
      }
    }

    const completed = getStoredJob(jobId)!;
    markJobTerminal(
      completed,
      completed.failedFiles > 0 ? "failed" : "completed",
    );
  } catch (error) {
    markJobTerminal(
      getStoredJob(jobId)!,
      "failed",
      error instanceof Error ? error.message : "导入任务失败",
    );
  } finally {
    await cleanupJobUploads(jobId);
  }
}

export function kickImportWorker() {
  ensureImportTables();
  if (!workerState.recovered) {
    db.prepare(`
      UPDATE import_jobs
      SET status = 'queued', started_at = ''
      WHERE status = 'running'
    `).run();
    workerState.recovered = true;
  }
  if (workerState.active) return;
  workerState.active = true;

  setImmediate(async () => {
    try {
      while (true) {
        const jobId = claimNextJob();
        if (!jobId) break;
        await processClaimedJob(jobId);
      }
    } finally {
      workerState.active = false;
      const waiting = db
        .prepare("SELECT 1 FROM import_jobs WHERE status = 'queued' LIMIT 1")
        .get();
      if (waiting) kickImportWorker();
    }
  });
}

export function listImportSources(options: {
  query?: string;
  status?: string;
  strategy?: string;
  limit?: number;
  offset?: number;
}) {
  ensureImportTables();
  const query = options.query?.trim() ?? "";
  const status = options.status?.trim() ?? "";
  const strategy = options.strategy?.trim() ?? "";
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const where: string[] = [];
  const parameters: Array<string | number> = [];

  if (query) {
    const escaped = query.replace(/[\\%_]/g, "\\$&");
    where.push(`(
      id LIKE ? ESCAPE '\\'
      OR actor_username LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM import_job_files f
        WHERE f.job_id = import_jobs.id
          AND f.file_name LIKE ? ESCAPE '\\'
      )
    )`);
    parameters.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }
  if (
    ["previewed", "queued", "running", "completed", "failed", "cancelled"].includes(
      status,
    )
  ) {
    where.push("status = ?");
    parameters.push(status);
  }
  if (["overwrite", "skip", "error"].includes(strategy)) {
    where.push("strategy = ?");
    parameters.push(strategy);
  }

  const rows = db
    .prepare(`
      SELECT
        id, status, strategy,
        actor_user_id AS actorUserId,
        actor_username AS actorUsername,
        actor_display_name AS actorDisplayName,
        actor_provider AS actorProvider,
        total_files AS totalFiles,
        total_rows AS totalRows,
        processed_files AS processedFiles,
        processed_rows AS processedRows,
        inserted_rows AS insertedRows,
        updated_rows AS updatedRows,
        skipped_rows AS skippedRows,
        unchanged_rows AS unchangedRows,
        failed_files AS failedFiles,
        cancel_requested AS cancelRequested,
        errors_json AS errorsJson,
        request_ip AS requestIp,
        request_user_agent AS requestUserAgent,
        created_at AS createdAt,
        started_at AS startedAt,
        completed_at AS completedAt
      FROM import_jobs
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...parameters, limit + 1, offset) as StoredJob[];

  return {
    items: rows.slice(0, limit).map(toJobView),
    hasMore: rows.length > limit,
    limit,
    offset,
  };
}
