import { NextRequest, NextResponse } from "next/server";
import {
  extractSpreadsheetsFromZip,
  isZipFile,
} from "@/lib/archive";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import { validateImportSpreadsheet } from "@/lib/import-jobs";
import {
  importParsedSpreadsheet,
  parseSpreadsheet,
} from "@/lib/spreadsheet";
import { getSystemSettings } from "@/lib/system-settings";
import type { ImportResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) {
    return errorResponse("请先登录", 401);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("无法读取上传内容");
  }

  const files = formData
    .getAll("files")
    .filter((item): item is File => item instanceof File);

  if (!files.length) return errorResponse("请选择至少一个表格或 ZIP 文件");
  const settings = getSystemSettings();
  const maxSizeBytes = settings.maxImportMb * 1024 * 1024;
  const maxArchiveSizeBytes = settings.maxArchiveUncompressedMb * 1024 * 1024;
  const maxImportFiles = settings.maxImportFiles;
  const maxArchiveEntries = settings.maxArchiveEntries;
  const spreadsheets: Array<{ fileName: string; buffer: Buffer }> = [];
  const results: ImportResult[] = [];
  const errors: Array<{ fileName: string; error: string }> = [];

  if (files.length > maxImportFiles) {
    return errorResponse(`单次最多选择 ${maxImportFiles} 个表格或 ZIP 文件`);
  }

  for (const file of files) {
    if (file.size > maxSizeBytes) {
      errors.push({
        fileName: file.name,
        error: `文件超过 ${settings.maxImportMb} MB 上限`,
      });
      continue;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (isZipFile(file.name)) {
        const remainingFiles = maxImportFiles - spreadsheets.length;
        if (remainingFiles <= 0) {
          throw new Error(`单次最多导入 ${maxImportFiles} 个表格文件`);
        }

        const extracted = await extractSpreadsheetsFromZip(buffer, {
          archiveName: file.name,
          maxFiles: remainingFiles,
          maxFileBytes: maxSizeBytes,
          maxTotalBytes: maxArchiveSizeBytes,
          maxEntries: maxArchiveEntries,
        });
        spreadsheets.push(...extracted);
      } else {
        if (spreadsheets.length >= maxImportFiles) {
          throw new Error(`单次最多导入 ${maxImportFiles} 个表格文件`);
        }
        spreadsheets.push({ fileName: file.name, buffer });
      }
    } catch (error) {
      errors.push({
        fileName: file.name,
        error: error instanceof Error ? error.message : "导入失败",
      });
    }
  }

  for (const spreadsheet of spreadsheets) {
    try {
      results.push(
        importParsedSpreadsheet(
          validateImportSpreadsheet(
            parseSpreadsheet(spreadsheet.buffer, spreadsheet.fileName),
          ),
          session,
        ),
      );
    } catch (error) {
      errors.push({
        fileName: spreadsheet.fileName,
        error: error instanceof Error ? error.message : "导入失败",
      });
    }
  }

  auditRequest(request, session, {
    action: "case.import",
    resourceType: "import",
    result: results.length ? "success" : "failure",
    detail: {
      selectedFiles: files.length,
      spreadsheetFiles: spreadsheets.length,
      importedRows: results.reduce((total, result) => total + result.imported, 0),
      insertedRows: results.reduce((total, result) => total + result.inserted, 0),
      updatedRows: results.reduce((total, result) => total + result.updated, 0),
      failedFiles: errors.length,
    },
  });

  return NextResponse.json(
    { results, errors },
    { status: results.length ? 200 : 400 },
  );
}
