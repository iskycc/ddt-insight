import { db } from "@/lib/db";
import type {
  AuthSession,
  CaseData,
  CaseHistoryChange,
  CaseHistoryItem,
  CaseHistoryKind,
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
  const columns = [
    ...Object.keys(before),
    ...Object.keys(after).filter((column) => !Object.hasOwn(before, column)),
  ];

  return columns.flatMap((column) => {
    const beforeExists = Object.hasOwn(before, column);
    const afterExists = Object.hasOwn(after, column);
    const beforeValue = beforeExists ? before[column] : null;
    const afterValue = afterExists ? after[column] : null;

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

  insertHistoryStatement.run(
    input.caseRecordId,
    input.caseId,
    input.changeType,
    input.actor.userId,
    input.actor.username.slice(0, 128),
    input.actor.displayName.slice(0, 128),
    input.actor.provider,
    (input.sourceName ?? "").slice(0, 512),
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
