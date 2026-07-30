import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type {
  AuditCategory,
  AuditLogItem,
  AuthSession,
} from "@/lib/types";

function requestAddress(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    ""
  ).slice(0, 128);
}

function auditCategoryForAction(action: string): AuditCategory {
  if (action.startsWith("auth.")) return "auth";
  if (action.startsWith("case.")) return "case";
  if (action.startsWith("user.")) return "user";
  if (action.startsWith("ldap.")) return "ldap";
  return "system";
}

export function writeAudit(input: {
  actorUsername: string;
  actorProvider?: string;
  category?: AuditCategory;
  action: string;
  resourceType: string;
  resourceId?: string;
  result?: "success" | "failure";
  ipAddress?: string;
  userAgent?: string;
  detail?: Record<string, unknown>;
}) {
  db.prepare(`
    INSERT INTO audit_logs (
      actor_username, actor_provider, category, action, resource_type, resource_id,
      result, ip_address, user_agent, detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.actorUsername.slice(0, 128),
    (input.actorProvider ?? "").slice(0, 32),
    input.category ?? auditCategoryForAction(input.action),
    input.action.slice(0, 64),
    input.resourceType.slice(0, 64),
    (input.resourceId ?? "").slice(0, 512),
    input.result ?? "success",
    (input.ipAddress ?? "").slice(0, 128),
    (input.userAgent ?? "").slice(0, 512),
    JSON.stringify(input.detail ?? {}),
    new Date().toISOString(),
  );
}

export function auditRequest(
  request: NextRequest,
  session: Pick<AuthSession, "username" | "provider"> | null,
  input: {
    actorUsername?: string;
    actorProvider?: string;
    category?: AuditCategory;
    action: string;
    resourceType: string;
    resourceId?: string;
    result?: "success" | "failure";
    detail?: Record<string, unknown>;
  },
) {
  writeAudit({
    ...input,
    actorUsername: input.actorUsername ?? session?.username ?? "anonymous",
    actorProvider: input.actorProvider ?? session?.provider ?? "",
    ipAddress: requestAddress(request),
    userAgent: request.headers.get("user-agent") ?? "",
  });
}

export function listAuditLogs(options: {
  query?: string;
  category?: string;
  action?: string;
  result?: string;
  limit?: number;
  offset?: number;
}) {
  const query = options.query?.trim() ?? "";
  const category = options.category?.trim() ?? "";
  const action = options.action?.trim() ?? "";
  const result = options.result?.trim() ?? "";
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where: string[] = [];
  const parameters: Array<string | number> = [];

  if (query) {
    where.push(
      `(actor_username LIKE ? ESCAPE '\\'
        OR resource_id LIKE ? ESCAPE '\\'
        OR resource_type LIKE ? ESCAPE '\\'
        OR action LIKE ? ESCAPE '\\'
        OR ip_address LIKE ? ESCAPE '\\'
        OR detail_json LIKE ? ESCAPE '\\')`,
    );
    const escaped = query.replace(/[\\%_]/g, "\\$&");
    parameters.push(
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
      `%${escaped}%`,
    );
  }
  if (["auth", "case", "user", "ldap", "system"].includes(category)) {
    where.push("category = ?");
    parameters.push(category);
  }
  if (action) {
    where.push("action = ?");
    parameters.push(action);
  }
  if (result === "success" || result === "failure") {
    where.push("result = ?");
    parameters.push(result);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`
      SELECT id, actor_username AS actorUsername,
             actor_provider AS actorProvider, category, action,
             resource_type AS resourceType, resource_id AS resourceId,
             result, ip_address AS ipAddress, user_agent AS userAgent,
             detail_json AS detailJson, created_at AS createdAt
      FROM audit_logs
      ${whereClause}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `)
    .all(...parameters, limit + 1, offset) as Array<
    Omit<AuditLogItem, "detail"> & { detailJson: string }
  >;

  return {
    items: rows.slice(0, limit).map(({ detailJson, ...row }) => ({
      ...row,
      detail: JSON.parse(detailJson) as Record<string, unknown>,
    })),
    hasMore: rows.length > limit,
    offset,
    limit,
  };
}
