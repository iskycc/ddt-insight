import { NextRequest, NextResponse } from "next/server";
import {
  extractSpreadsheetsFromZip,
  isZipFile,
} from "@/lib/archive";
import { errorResponse, requireApiSession } from "@/lib/http";
import {
  createImportPreview,
  type ImportFileError,
  type ImportUpload,
} from "@/lib/import-jobs";
import { getSystemSettings } from "@/lib/system-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function requestAddress(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    ""
  );
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);

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
  const spreadsheets: ImportUpload[] = [];
  const errors: ImportFileError[] = [];

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
        error: error instanceof Error ? error.message : "预检失败",
      });
    }
  }

  try {
    const job = await createImportPreview({
      spreadsheets,
      extractionErrors: errors,
      actor: session,
      requestIp: requestAddress(request),
      requestUserAgent: request.headers.get("user-agent") ?? "",
    });
    const response = NextResponse.json(job, {
      status: job.status === "failed" ? 400 : 200,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "无法创建导入预检",
      500,
    );
  }
}
