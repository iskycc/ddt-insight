import { db } from "@/lib/db";
import {
  getJourneySteps,
  isCellValue,
  sortStepNames,
} from "@/lib/case-data";
import type {
  AuthSession,
  CaseData,
  CaseHistoryChange,
  CaseHistoryItem,
  CaseHistoryKind,
  CellValue,
  UserProvider,
} from "@/lib/types";

type HistoryActor = Pick<
  AuthSession,
  "userId" | "username" | "displayName" | "provider"
>;

const insertHistoryStatement = db.prepare(`
  INSERT INTO case_history (
    case_record_id, case_id, change_type,
    actor_user_id, actor_username, actor_display_name, actor_provider,
    source_name, before_json, after_json, changes_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function diffCaseData(
  before: CaseData,
  after: CaseData,
): CaseHistoryChange[] {
  const flatten = (data: CaseData) => {
    const values = new Map<string, CellValue>();
    for (const [column, value] of Object.entries(data)) {
      if (isCellValue(value)) values.set(column, value);
    }
    const steps = getJourneySteps(data);
    if (steps) {
      for (const stepName of sortStepNames(Object.keys(steps))) {
        for (const [column, value] of Object.entries(steps[stepName])) {
          values.set(`${stepName}.${column}`, value);
        }
      }
    }
    return values;
  };
  const beforeValues = flatten(before);
  const afterValues = flatten(after);
  const columns = [
    ...beforeValues.keys(),
    ...[...afterValues.keys()].filter(
      (column) => !beforeValues.has(column),
    ),
  ];

  return columns.flatMap((column) => {
    const beforeExists = beforeValues.has(column);
    const afterExists = afterValues.has(column);
    const beforeValue = beforeValues.get(column) ?? null;
    const afterValue = afterValues.get(column) ?? null;

    if (
      beforeExists === afterExists &&
      Object.is(beforeValue, afterValue)
    ) {
      return [];
    }

    return [{
      column,
      beforeExists,
      afterExists,
      before: beforeValue,
      after: afterValue,
    }];
  });
}

export function appendCaseHistory(input: {
  caseRecordId: string;
  caseId: string;
  changeType: CaseHistoryKind;
  actor: HistoryActor;
  sourceName?: string;
  before: CaseData;
  after: CaseData;
  createdAt?: string;
}) {
  const changes = diffCaseData(input.before, input.after);
  const sourceName = Array.from((input.sourceName ?? "").toWellFormed())
    .slice(0, 512)
    .join("");

  insertHistoryStatement.run(
    input.caseRecordId,
    input.caseId,
    input.changeType,
    input.actor.userId,
    input.actor.username.slice(0, 128),
    input.actor.displayName.slice(0, 128),
    input.actor.provider,
    sourceName,
    JSON.stringify(input.before),
    JSON.stringify(input.after),
    JSON.stringify(changes),
    input.createdAt ?? new Date().toISOString(),
  );

  return changes;
}

export function listCaseHistory(
  caseId: string,
  options: { limit?: number; beforeId?: number } = {},
) {
  const current = db
    .prepare(`
      SELECT record_id AS recordId
      FROM cases
      WHERE case_id = ?
      LIMIT 1
    `)
    .get(caseId) as { recordId: string } | undefined;

  if (!current) return null;

  const limit = Math.min(Math.max(options.limit ?? 15, 1), 50);
  const beforeId =
    Number.isSafeInteger(options.beforeId) && Number(options.beforeId) > 0
      ? Number(options.beforeId)
      : null;
  const rows = db
    .prepare(`
      SELECT
        id,
        case_id AS caseId,
        change_type AS changeType,
        actor_user_id AS actorUserId,
        actor_username AS actorUsername,
        actor_display_name AS actorDisplayName,
        actor_provider AS actorProvider,
        source_name AS sourceName,
        changes_json AS changesJson,
        created_at AS createdAt
      FROM case_history
      WHERE case_record_id = ?
        AND (? IS NULL OR id < ?)
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(current.recordId, beforeId, beforeId, limit + 1) as Array<{
    id: number;
    caseId: string;
    changeType: CaseHistoryKind;
    actorUserId: string;
    actorUsername: string;
    actorDisplayName: string;
    actorProvider: UserProvider;
    sourceName: string;
    changesJson: string;
    createdAt: string;
  }>;

  const items: CaseHistoryItem[] = rows.slice(0, limit).map(
    ({ changesJson, ...row }) => ({
      ...row,
      changes: JSON.parse(changesJson) as CaseHistoryChange[],
    }),
  );
  const hasMore = rows.length > limit;

  return {
    items,
    hasMore,
    nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
  };
}

export function restoreCaseHistoryVersion(
  caseId: string,
  historyId: number,
  actor: HistoryActor,
  snapshot: "before" | "after" = "before",
) {
  if (!Number.isSafeInteger(historyId) || historyId <= 0) {
    throw new Error("历史版本编号无效");
  }

  const current = db
    .prepare(`
      SELECT
        record_id AS recordId,
        data_json AS dataJson
      FROM cases
      WHERE case_id = ?
      LIMIT 1
    `)
    .get(caseId) as
    | { recordId: string; dataJson: string }
    | undefined;
  if (!current) return null;

  const version = db
    .prepare(`
      SELECT before_json AS beforeJson, after_json AS afterJson
      FROM case_history
      WHERE id = ? AND case_record_id = ?
      LIMIT 1
    `)
    .get(historyId, current.recordId) as
    | { beforeJson: string; afterJson: string }
    | undefined;
  if (!version) {
    throw new Error("历史版本不存在或不属于当前用例");
  }

  const before = JSON.parse(current.dataJson) as CaseData;
  const after = JSON.parse(
    snapshot === "after" ? version.afterJson : version.beforeJson,
  ) as CaseData;
  const nextCaseId = String(after.CaseID ?? "").trim();
  const nextSrNum = String(after.srNum ?? "").trim();
  if (!nextCaseId || !nextSrNum) {
    throw new Error("该历史版本缺少 CaseID 或 srNum，无法恢复");
  }
  if (nextCaseId.length > 512) {
    throw new Error("历史版本中的 CaseID 超过 512 个字符");
  }

  const duplicate = db
    .prepare(`
      SELECT case_id AS caseId
      FROM cases
      WHERE case_id = ? COLLATE NOCASE AND record_id != ?
      LIMIT 1
    `)
    .get(nextCaseId, current.recordId) as
    | { caseId: string }
    | undefined;
  if (duplicate) {
    throw new Error(`CaseID “${duplicate.caseId}”已存在，无法回滚`);
  }

  const restoredAt = new Date().toISOString();
  const changes = db.transaction(() => {
    db.prepare(`
      UPDATE cases
      SET case_id = ?, sr_num = ?, data_json = ?, updated_at = ?
      WHERE record_id = ?
    `).run(
      nextCaseId,
      nextSrNum,
      JSON.stringify(after),
      restoredAt,
      current.recordId,
    );
    db.prepare(`
      INSERT INTO activity (kind, detail, amount, created_at)
      VALUES ('restore', ?, 1, ?)
    `).run(`${caseId} ← 历史版本 #${historyId}`, restoredAt);
    return appendCaseHistory({
      caseRecordId: current.recordId,
      caseId: nextCaseId,
      changeType: "edit",
      actor,
      sourceName: `历史版本回滚 #${historyId}（${
        snapshot === "before" ? "修改前" : "修改后"
      }）`,
      before,
      after,
      createdAt: restoredAt,
    });
  })();

  return {
    data: after,
    caseId: nextCaseId,
    restoredFromHistoryId: historyId,
    restoredSnapshot: snapshot,
    changes,
    restoredAt,
  };
}
