import { randomUUID } from "node:crypto";
import { appendCaseHistory } from "@/lib/case-history";
import { db } from "@/lib/db";
import { invalidateCaseCache } from "@/lib/repository";
import type { AuthSession, CaseData, CellValue } from "@/lib/types";

export type TemplateFieldType = "string" | "number" | "boolean" | "date";

export interface TemplateFieldRule {
  field: string;
  required: boolean;
  type: TemplateFieldType;
  enumValues?: CellValue[];
  defaultValue?: CellValue;
}

export interface CaseTemplate {
  id: string;
  srNum: string;
  name: string;
  description: string;
  rules: TemplateFieldRule[];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaseValidationIssue {
  field: string;
  code:
    | "required"
    | "type"
    | "enum"
    | "case_id"
    | "sr_num";
  message: string;
}

export interface CaseValidationResult {
  valid: boolean;
  templateId: string | null;
  templateName: string | null;
  data: CaseData;
  errors: CaseValidationIssue[];
}

export type SearchFieldOperator =
  | "eq"
  | "ne"
  | "contains"
  | "prefix"
  | "exists"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export interface SearchFieldFilter {
  field: string;
  operator: SearchFieldOperator;
  value?: CellValue;
}

type HistoryActor = Pick<
  AuthSession,
  "userId" | "username" | "displayName" | "provider"
>;

const FIELD_TYPES = new Set<TemplateFieldType>([
  "string",
  "number",
  "boolean",
  "date",
]);
const SEARCH_OPERATORS = new Set<SearchFieldOperator>([
  "eq",
  "ne",
  "contains",
  "prefix",
  "exists",
  "gt",
  "gte",
  "lt",
  "lte",
]);

let schemaReady = false;

export function ensureCaseManagementSchema() {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_templates (
      id TEXT PRIMARY KEY,
      sr_num TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      rules_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_case_templates_updated
      ON case_templates (updated_at DESC);
  `);
  schemaReady = true;
}

ensureCaseManagementSchema();

function isCellValue(value: unknown): value is CellValue {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function parseRules(value: string): TemplateFieldRule[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as TemplateFieldRule[]) : [];
  } catch {
    return [];
  }
}

function mapTemplateRow(row: {
  id: string;
  srNum: string;
  name: string;
  description: string;
  rulesJson: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}): CaseTemplate {
  const { rulesJson, ...template } = row;
  return { ...template, rules: parseRules(rulesJson) };
}

export function normalizeTemplateRules(
  input: unknown,
): TemplateFieldRule[] {
  if (!Array.isArray(input)) {
    throw new Error("字段规则必须是数组");
  }
  if (input.length > 200) {
    throw new Error("每个模板最多配置 200 条字段规则");
  }

  const fields = new Set<string>();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`第 ${index + 1} 条字段规则格式不正确`);
    }
    const record = raw as Record<string, unknown>;
    const field = typeof record.field === "string" ? record.field.trim() : "";
    const type =
      typeof record.type === "string"
        ? (record.type as TemplateFieldType)
        : "string";
    if (!field) throw new Error(`第 ${index + 1} 条字段规则缺少字段名`);
    if (field.length > 256) throw new Error(`字段“${field}”名称过长`);
    const normalizedField = field.toLocaleLowerCase("en-US");
    if (fields.has(normalizedField)) {
      throw new Error(`字段“${field}”存在重复规则`);
    }
    fields.add(normalizedField);
    if (!FIELD_TYPES.has(type)) {
      throw new Error(`字段“${field}”使用了不支持的类型`);
    }

    let enumValues: CellValue[] | undefined;
    if (record.enumValues !== undefined) {
      if (!Array.isArray(record.enumValues)) {
        throw new Error(`字段“${field}”的枚举值必须是数组`);
      }
      if (record.enumValues.length > 100) {
        throw new Error(`字段“${field}”最多配置 100 个枚举值`);
      }
      if (!record.enumValues.every(isCellValue)) {
        throw new Error(`字段“${field}”包含无效枚举值`);
      }
      enumValues = record.enumValues;
    }

    const hasDefault = Object.hasOwn(record, "defaultValue");
    if (hasDefault && !isCellValue(record.defaultValue)) {
      throw new Error(`字段“${field}”的默认值格式不正确`);
    }

    return {
      field,
      required: record.required === true,
      type,
      ...(enumValues ? { enumValues } : {}),
      ...(hasDefault
        ? { defaultValue: record.defaultValue as CellValue }
        : {}),
    };
  });
}

export function listCaseTemplates() {
  const rows = db
    .prepare(`
      SELECT
        id, sr_num AS srNum, name, description, rules_json AS rulesJson,
        created_by AS createdBy, updated_by AS updatedBy,
        created_at AS createdAt, updated_at AS updatedAt
      FROM case_templates
      ORDER BY sr_num COLLATE NOCASE
    `)
    .all() as Parameters<typeof mapTemplateRow>[0][];
  return rows.map(mapTemplateRow);
}

export function getCaseTemplate(id: string) {
  const row = db
    .prepare(`
      SELECT
        id, sr_num AS srNum, name, description, rules_json AS rulesJson,
        created_by AS createdBy, updated_by AS updatedBy,
        created_at AS createdAt, updated_at AS updatedAt
      FROM case_templates
      WHERE id = ?
      LIMIT 1
    `)
    .get(id) as Parameters<typeof mapTemplateRow>[0] | undefined;
  return row ? mapTemplateRow(row) : null;
}

export function getCaseTemplateForSrNum(srNum: string) {
  const row = db
    .prepare(`
      SELECT
        id, sr_num AS srNum, name, description, rules_json AS rulesJson,
        created_by AS createdBy, updated_by AS updatedBy,
        created_at AS createdAt, updated_at AS updatedAt
      FROM case_templates
      WHERE sr_num = ? COLLATE NOCASE
      LIMIT 1
    `)
    .get(srNum.trim()) as Parameters<typeof mapTemplateRow>[0] | undefined;
  return row ? mapTemplateRow(row) : null;
}

export function createCaseTemplate(
  input: {
    srNum: string;
    name: string;
    description?: string;
    rules: unknown;
  },
  actorUsername: string,
) {
  const srNum = input.srNum.trim();
  const name = input.name.trim();
  if (!srNum) throw new Error("srNum 不能为空");
  if (!name) throw new Error("模板名称不能为空");
  if (srNum.length > 256 || name.length > 256) {
    throw new Error("srNum 或模板名称过长");
  }
  const rules = normalizeTemplateRules(input.rules);
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO case_templates (
        id, sr_num, name, description, rules_json,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      srNum,
      name,
      (input.description ?? "").trim().slice(0, 2_000),
      JSON.stringify(rules),
      actorUsername.slice(0, 128),
      actorUsername.slice(0, 128),
      now,
      now,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed")
    ) {
      throw new Error(`srNum “${srNum}”已经配置模板`);
    }
    throw error;
  }
  return getCaseTemplate(id)!;
}

export function updateCaseTemplate(
  id: string,
  input: {
    srNum: string;
    name: string;
    description?: string;
    rules: unknown;
  },
  actorUsername: string,
) {
  if (!getCaseTemplate(id)) return null;
  const srNum = input.srNum.trim();
  const name = input.name.trim();
  if (!srNum) throw new Error("srNum 不能为空");
  if (!name) throw new Error("模板名称不能为空");
  if (srNum.length > 256 || name.length > 256) {
    throw new Error("srNum 或模板名称过长");
  }
  const rules = normalizeTemplateRules(input.rules);
  try {
    db.prepare(`
      UPDATE case_templates
      SET sr_num = ?, name = ?, description = ?, rules_json = ?,
          updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      srNum,
      name,
      (input.description ?? "").trim().slice(0, 2_000),
      JSON.stringify(rules),
      actorUsername.slice(0, 128),
      new Date().toISOString(),
      id,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed")
    ) {
      throw new Error(`srNum “${srNum}”已经配置模板`);
    }
    throw error;
  }
  return getCaseTemplate(id);
}

export function deleteCaseTemplate(id: string) {
  return db.prepare("DELETE FROM case_templates WHERE id = ?").run(id)
    .changes > 0;
}

function valueMatchesType(value: CellValue, type: TemplateFieldType) {
  if (type === "string") return typeof value === "string";
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "boolean") return typeof value === "boolean";
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Date.parse(value))
  );
}

export function validateCaseAgainstTemplate(
  input: CaseData,
  template: CaseTemplate | null = getCaseTemplateForSrNum(
    String(input.srNum ?? ""),
  ),
  options: { applyDefaults?: boolean } = {},
): CaseValidationResult {
  const data = { ...input };
  const errors: CaseValidationIssue[] = [];
  if (!String(data.CaseID ?? "").trim()) {
    errors.push({
      field: "CaseID",
      code: "case_id",
      message: "CaseID 不能为空",
    });
  }
  if (!String(data.srNum ?? "").trim()) {
    errors.push({
      field: "srNum",
      code: "sr_num",
      message: "srNum 不能为空",
    });
  }

  if (template) {
    for (const rule of template.rules) {
      const exists = Object.hasOwn(data, rule.field);
      const currentValue = data[rule.field];
      const empty =
        !exists ||
        currentValue === null ||
        (typeof currentValue === "string" && currentValue.trim() === "");

      if (
        empty &&
        options.applyDefaults !== false &&
        Object.hasOwn(rule, "defaultValue")
      ) {
        data[rule.field] = rule.defaultValue ?? null;
      }

      const value = data[rule.field];
      const valueIsEmpty =
        !Object.hasOwn(data, rule.field) ||
        value === null ||
        (typeof value === "string" && value.trim() === "");
      if (rule.required && valueIsEmpty) {
        errors.push({
          field: rule.field,
          code: "required",
          message: `字段“${rule.field}”为必填项`,
        });
        continue;
      }
      if (valueIsEmpty) continue;
      if (!valueMatchesType(value, rule.type)) {
        errors.push({
          field: rule.field,
          code: "type",
          message: `字段“${rule.field}”必须是${{
            string: "文本",
            number: "数字",
            boolean: "布尔值",
            date: "有效日期",
          }[rule.type]}`,
        });
        continue;
      }
      if (
        rule.enumValues?.length &&
        !rule.enumValues.some((candidate) => Object.is(candidate, value))
      ) {
        errors.push({
          field: rule.field,
          code: "enum",
          message: `字段“${rule.field}”不在允许值范围内`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    templateId: template?.id ?? null,
    templateName: template?.name ?? null,
    data,
    errors,
  };
}

function normalizeCaseIds(input: unknown, maximum = 500) {
  if (!Array.isArray(input)) throw new Error("caseIds 必须是数组");
  const caseIds = [
    ...new Set(
      input
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  if (!caseIds.length) throw new Error("请至少选择一个用例");
  if (caseIds.length > maximum) {
    throw new Error(`单次最多处理 ${maximum} 个用例`);
  }
  return caseIds;
}

export function normalizeBulkCaseIds(input: unknown, maximum = 500) {
  return normalizeCaseIds(input, maximum);
}

export function bulkUpdateCases(input: {
  caseIds: unknown;
  changes: unknown;
  actor: HistoryActor;
}) {
  const caseIds = normalizeCaseIds(input.caseIds);
  if (!input.changes || typeof input.changes !== "object") {
    throw new Error("changes 格式不正确");
  }
  const changes = input.changes as Record<string, unknown>;
  const entries = Object.entries(changes);
  if (!entries.length) throw new Error("请至少提供一个修改字段");
  if (entries.length > 50) throw new Error("单次最多修改 50 个字段");
  if (entries.some(([field]) => field.trim() === "CaseID")) {
    throw new Error("批量操作不支持修改 CaseID");
  }
  for (const [rawField, value] of entries) {
    const field = rawField.trim();
    if (!field || field.length > 256) throw new Error("字段名格式不正确");
    if (!isCellValue(value)) {
      throw new Error(`字段“${field}”的值格式不正确`);
    }
    if (field === "srNum" && !String(value ?? "").trim()) {
      throw new Error("srNum 不能为空");
    }
  }

  const getStatement = db.prepare(`
    SELECT record_id AS recordId, data_json AS dataJson
    FROM cases
    WHERE case_id = ?
    LIMIT 1
  `);
  const updateStatement = db.prepare(`
    UPDATE cases
    SET sr_num = ?, data_json = ?, updated_at = ?
    WHERE case_id = ?
  `);
  const now = new Date().toISOString();
  const missing: string[] = [];
  const changed: string[] = [];
  const skipped: string[] = [];

  db.transaction(() => {
    for (const caseId of caseIds) {
      const row = getStatement.get(caseId) as
        | { recordId: string; dataJson: string }
        | undefined;
      if (!row) {
        missing.push(caseId);
        continue;
      }
      const before = JSON.parse(row.dataJson) as CaseData;
      const candidate = { ...before };
      for (const [rawField, value] of entries) {
        candidate[rawField.trim()] = value as CellValue;
      }
      const template = getCaseTemplateForSrNum(
        String(candidate.srNum ?? ""),
      );
      const validation = validateCaseAgainstTemplate(candidate, template);
      if (!validation.valid) {
        const reason = validation.errors.map((item) => item.message).join("；");
        throw new Error(`用例“${caseId}”未通过模板校验：${reason}`);
      }
      const after = validation.data;
      if (JSON.stringify(before) === JSON.stringify(after)) {
        skipped.push(caseId);
        continue;
      }
      updateStatement.run(
        String(after.srNum ?? ""),
        JSON.stringify(after),
        now,
        caseId,
      );
      appendCaseHistory({
        caseRecordId: row.recordId,
        caseId,
        changeType: "edit",
        actor: input.actor,
        sourceName: "批量编辑",
        before,
        after,
        createdAt: now,
      });
      invalidateCaseCache(caseId);
      changed.push(caseId);
    }
    if (changed.length) {
      db.prepare(`
        INSERT INTO activity (kind, detail, amount, created_at)
        VALUES ('edit', ?, ?, ?)
      `).run(`批量编辑 ${changed.length} 个用例`, changed.length, now);
    }
  })();

  return {
    requested: caseIds.length,
    changed: changed.length,
    skipped: skipped.length,
    missing,
  };
}

export function normalizeSearchFilters(input: unknown): SearchFieldFilter[] {
  if (input === undefined || input === null || input === "") return [];
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      throw new Error("字段条件不是有效 JSON");
    }
  }
  if (!Array.isArray(parsed)) throw new Error("字段条件必须是数组");
  if (parsed.length > 10) throw new Error("最多配置 10 个字段条件");
  return parsed.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`第 ${index + 1} 个字段条件格式不正确`);
    }
    const item = raw as Record<string, unknown>;
    const field = typeof item.field === "string" ? item.field.trim() : "";
    const operator = item.operator as SearchFieldOperator;
    if (!field || field.length > 256) {
      throw new Error(`第 ${index + 1} 个字段条件缺少有效字段名`);
    }
    if (!SEARCH_OPERATORS.has(operator)) {
      throw new Error(`第 ${index + 1} 个字段条件使用了无效操作符`);
    }
    if (
      operator !== "exists" &&
      (!Object.hasOwn(item, "value") || !isCellValue(item.value))
    ) {
      throw new Error(`第 ${index + 1} 个字段条件缺少有效值`);
    }
    return {
      field,
      operator,
      ...(Object.hasOwn(item, "value")
        ? { value: item.value as CellValue }
        : {}),
    };
  });
}

function appendDynamicFilter(
  where: string[],
  parameters: Array<string | number | null>,
  filter: SearchFieldFilter,
  index: number,
) {
  const alias = `field_${index}`;
  const prefix = `EXISTS (
    SELECT 1 FROM json_each(cases.data_json) AS ${alias}
    WHERE ${alias}.key = ?`;
  parameters.push(filter.field);

  if (filter.operator === "exists") {
    const shouldExist = filter.value !== false;
    where.push(
      shouldExist
        ? `${prefix})`
        : `NOT EXISTS (
            SELECT 1 FROM json_each(cases.data_json) AS ${alias}
            WHERE ${alias}.key = ?
          )`,
    );
    return;
  }

  const value =
    typeof filter.value === "boolean"
      ? Number(filter.value)
      : (filter.value ?? null);
  if (filter.operator === "eq" || filter.operator === "ne") {
    where.push(
      `${prefix} AND ${alias}.value ${
        filter.operator === "eq" ? "IS" : "IS NOT"
      } ?)`,
    );
    parameters.push(value);
    return;
  }
  if (filter.operator === "contains" || filter.operator === "prefix") {
    where.push(
      `${prefix} AND CAST(${alias}.value AS TEXT) LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
    );
    const escaped = escapeLike(String(filter.value ?? ""));
    parameters.push(
      filter.operator === "contains" ? `%${escaped}%` : `${escaped}%`,
    );
    return;
  }
  const comparator = {
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
  }[filter.operator];
  where.push(
    `${prefix} AND CAST(${alias}.value AS REAL) ${comparator} CAST(? AS REAL))`,
  );
  parameters.push(value);
}

export function searchCases(options: {
  caseIdPrefix?: string;
  text?: string;
  srNum?: string;
  sourceName?: string;
  filters?: unknown;
  cursor?: string;
  limit?: number;
}) {
  const caseIdPrefix = options.caseIdPrefix?.trim() ?? "";
  const text = options.text?.trim() ?? "";
  const srNum = options.srNum?.trim() ?? "";
  const sourceName = options.sourceName?.trim() ?? "";
  const cursor = options.cursor?.trim() ?? "";
  const filters = normalizeSearchFilters(options.filters);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const where: string[] = [];
  const parameters: Array<string | number | null> = [];

  if (caseIdPrefix) {
    where.push("cases.case_id LIKE ? ESCAPE '\\'");
    parameters.push(`${escapeLike(caseIdPrefix)}%`);
  }
  if (cursor) {
    where.push("cases.case_id > ? COLLATE NOCASE");
    parameters.push(cursor);
  }
  if (srNum) {
    where.push("cases.sr_num = ? COLLATE NOCASE");
    parameters.push(srNum);
  }
  if (sourceName) {
    where.push("cases.source_name = ? COLLATE NOCASE");
    parameters.push(sourceName);
  }
  if (text) {
    const match = `%${escapeLike(text)}%`;
    where.push(`(
      cases.case_id LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      cases.sr_num LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      cases.source_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR
      cases.data_json LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`);
    parameters.push(match, match, match, match);
  }
  filters.forEach((filter, index) => {
    appendDynamicFilter(where, parameters, filter, index);
  });

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(`
      SELECT
        case_id AS caseId,
        sr_num AS srNum,
        source_name AS sourceName,
        updated_at AS updatedAt
      FROM cases
      ${whereClause}
      ORDER BY case_id COLLATE NOCASE
      LIMIT ?
    `)
    .all(...parameters, limit + 1) as Array<{
    caseId: string;
    srNum: string;
    sourceName: string;
    updatedAt: string;
  }>;
  const items = rows.slice(0, limit);
  return {
    items,
    hasMore: rows.length > limit,
    nextCursor:
      rows.length > limit ? items.at(-1)?.caseId ?? null : null,
    limit,
  };
}
