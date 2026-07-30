import { unzip } from "fflate";
import { isSupportedSpreadsheetFile } from "@/lib/spreadsheet";

export interface ExtractedSpreadsheet {
  fileName: string;
  buffer: Buffer;
}

interface ExtractZipOptions {
  archiveName: string;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxEntries?: number;
}

const DEFAULT_MAX_ARCHIVE_ENTRIES = 500;

class ZipImportError extends Error {}

function normalizedEntryName(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function entryPathParts(value: string) {
  const normalized = normalizedEntryName(value);
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return null;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (
    parts.some((part) => part === "." || part === "..") ||
    parts.some((part) => part === "__MACOSX") ||
    parts.at(-1)?.startsWith("._")
  ) {
    return null;
  }

  return { normalized, parts };
}

export function isZipFile(fileName: string) {
  return fileName.toLocaleLowerCase("en-US").endsWith(".zip");
}

export async function extractSpreadsheetsFromZip(
  archive: Buffer,
  options: ExtractZipOptions,
) {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES;
  let inspectedEntries = 0;
  let selectedEntries = 0;
  let declaredBytes = 0;
  let validationError: ZipImportError | null = null;

  const unzipped = await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) => {
      try {
        unzip(
          new Uint8Array(archive),
          {
            filter(file) {
              inspectedEntries += 1;
              if (inspectedEntries > maxEntries) {
                validationError ??= new ZipImportError(
                  `ZIP 内条目过多，最多检查 ${maxEntries} 个条目`,
                );
                return false;
              }

              const path = entryPathParts(file.name);
              const isDirectory =
                file.name.endsWith("/") || file.name.endsWith("\\");

              if (
                validationError ||
                !path ||
                isDirectory ||
                path.parts.length > 2 ||
                !isSupportedSpreadsheetFile(path.normalized)
              ) {
                return false;
              }

              if (selectedEntries >= options.maxFiles) {
                validationError = new ZipImportError(
                  "ZIP 中可导入的表格超过本次剩余额度",
                );
                return false;
              }
              if (file.originalSize > options.maxFileBytes) {
                validationError = new ZipImportError(
                  `ZIP 中的 ${path.normalized} 解压后超过单文件大小上限`,
                );
                return false;
              }
              if (
                declaredBytes + file.originalSize >
                options.maxTotalBytes
              ) {
                validationError = new ZipImportError(
                  "ZIP 解压后的表格总大小超过允许上限",
                );
                return false;
              }

              selectedEntries += 1;
              declaredBytes += file.originalSize;
              return true;
            },
          },
          (error, data) => {
            if (validationError) {
              reject(validationError);
              return;
            }
            if (error) {
              reject(
                new Error(
                  error.message
                    ? `无法解压 ZIP：${error.message}`
                    : "无法解压 ZIP，请确认压缩包未损坏",
                ),
              );
              return;
            }
            resolve(data);
          },
        );
      } catch (error) {
        reject(
          error instanceof ZipImportError
            ? error
            : new Error(
                error instanceof Error && error.message
                  ? `无法解压 ZIP：${error.message}`
                  : "无法解压 ZIP，请确认压缩包未损坏",
              ),
        );
      }
    },
  );

  const extracted: ExtractedSpreadsheet[] = [];
  let actualBytes = 0;

  for (const [entryName, data] of Object.entries(unzipped)) {
    const path = entryPathParts(entryName);
    if (!path) {
      throw new ZipImportError("ZIP 中包含无效文件路径");
    }
    if (data.byteLength > options.maxFileBytes) {
      throw new ZipImportError(
        `ZIP 中的 ${path.normalized} 解压后超过单文件大小上限`,
      );
    }

    actualBytes += data.byteLength;
    if (actualBytes > options.maxTotalBytes) {
      throw new ZipImportError("ZIP 解压后的表格总大小超过允许上限");
    }

    extracted.push({
      fileName: `${options.archiveName} / ${path.normalized}`,
      buffer: Buffer.from(data),
    });
  }

  if (!extracted.length) {
    throw new ZipImportError(
      "ZIP 根目录或一层子目录中未找到支持的表格，未执行导入",
    );
  }

  return extracted;
}
