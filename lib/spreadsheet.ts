import * as XLSX from "xlsx";
import type { AuthSession, CaseData, CellValue } from "@/lib/types";
import { getCasesForExport, importCases } from "@/lib/repository";

const SUPPORTED_EXTENSIONS = new Set([
  "xlsx",
  "xls",
  "xlsb",
  "csv",
  "ods",
]);

function extensionOf(fileName: string) {
  const extension = fileName.split(".").pop()?.toLocaleLowerCase("en-US");
  return extension ?? "";
}

export function isSupportedSpreadsheetFile(fileName: string) {
  return SUPPORTED_EXTENSIONS.has(extensionOf(fileName));
}

function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function parseAndImportSpreadsheet(
  buffer: Buffer,
  fileName: string,
  actor: Pick<
    AuthSession,
    "userId" | "username" | "displayName" | "provider"
  >,
) {
  const startedAt = Date.now();
  const extension = extensionOf(fileName);

  if (!isSupportedSpreadsheetFile(fileName)) {
    throw new Error(
      "不支持该文件格式。请使用 .xlsx、.xls、.xlsb、.csv 或 .ods 文件",
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      dense: true,
    });
  } catch {
    throw new Error("无法解析该表格，请确认文件未损坏且格式正确");
  }

  const dataSheetName =
    workbook.SheetNames.find(
      (name) => name.trim().toLocaleLowerCase("en-US") === "data",
    ) ?? (extension === "csv" ? workbook.SheetNames[0] : undefined);

  if (!dataSheetName) {
    throw new Error("未找到名为 data 的 Sheet 页");
  }

  const sheet = workbook.Sheets[dataSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  if (matrix.length < 2) {
    throw new Error("data Sheet 中没有可导入的用例数据");
  }

  const columns = matrix[0].map((cell) => String(cell ?? "").trim());
  const emptyHeaderIndex = columns.findIndex((column) => !column);
  if (emptyHeaderIndex >= 0) {
    throw new Error(`第 ${emptyHeaderIndex + 1} 列缺少列名`);
  }

  const normalizedColumnSet = new Set(
    columns.map((column) => column.toLocaleLowerCase("en-US")),
  );
  if (normalizedColumnSet.size !== columns.length) {
    throw new Error("data Sheet 中存在重复列名");
  }

  const caseIdIndex = columns.findIndex((column) => column === "CaseID");
  const srNumIndex = columns.findIndex((column) => column === "srNum");

  if (caseIdIndex < 0) {
    throw new Error("data Sheet 缺少必需列 CaseID");
  }
  if (srNumIndex < 0) {
    throw new Error("data Sheet 缺少必需列 srNum");
  }

  const rows: CaseData[] = [];
  const seenCaseIds = new Set<string>();

  for (let index = 1; index < matrix.length; index += 1) {
    const sourceRow = matrix[index];
    const rowIsEmpty = sourceRow.every(
      (value) => String(value ?? "").trim() === "",
    );
    if (rowIsEmpty) continue;

    const caseId = String(sourceRow[caseIdIndex] ?? "").trim();
    const srNum = String(sourceRow[srNumIndex] ?? "").trim();
    const sheetRow = index + 1;

    if (!caseId) {
      throw new Error(`data Sheet 第 ${sheetRow} 行的 CaseID 为空`);
    }
    if (!srNum) {
      throw new Error(`data Sheet 第 ${sheetRow} 行的 srNum 为空`);
    }

    const normalizedCaseId = caseId.toLocaleLowerCase("en-US");
    if (seenCaseIds.has(normalizedCaseId)) {
      throw new Error(`CaseID “${caseId}”在当前表格中重复`);
    }
    seenCaseIds.add(normalizedCaseId);

    const row: CaseData = {};
    columns.forEach((column, columnIndex) => {
      row[column] = normalizeCell(sourceRow[columnIndex]);
    });
    row.CaseID = caseId;
    row.srNum = srNum;
    rows.push(row);
  }

  if (!rows.length) {
    throw new Error("data Sheet 中没有可导入的有效用例");
  }

  return importCases({
    fileName,
    sizeBytes: buffer.byteLength,
    columns,
    rows,
    startedAt,
    actor,
  });
}

export function buildExportWorkbook(options: {
  srNum?: string;
  caseIds?: string[];
}) {
  const rows = getCasesForExport(options);
  if (!rows.length) throw new Error("没有符合条件的用例可导出");

  const columnSet = new Set<string>(["CaseID", "srNum"]);
  for (const row of rows) {
    for (const column of Object.keys(row)) columnSet.add(column);
  }

  const columns = [...columnSet];
  const sheet = XLSX.utils.json_to_sheet(rows, { header: columns });
  sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1" };
  sheet["!cols"] = columns.map((column) => ({
    wch: Math.min(Math.max(column.length + 2, 14), 42),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "data");
  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }) as Buffer;
}
