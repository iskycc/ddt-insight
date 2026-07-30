import { createWriteStream, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { dataDirectory } from "@/lib/db";
import { errorResponse, requireApiSession } from "@/lib/http";
import {
  cancelPendingRestore,
  stageMaintenanceRestore,
} from "@/lib/maintenance";

export const dynamic = "force-dynamic";

async function* requestChunks(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
) {
  const reader = body.getReader();
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) {
        receivedBytes += value.byteLength;
        if (receivedBytes > maximumBytes) {
          throw new Error("备份文件超过恢复上传上限");
        }
        yield Buffer.from(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  const configuredLimitMb = Number(
    process.env.MAX_BACKUP_RESTORE_MB ?? 4_096,
  );
  const maximumBytes =
    (Number.isFinite(configuredLimitMb) && configuredLimitMb > 0
      ? configuredLimitMb
      : 4_096) *
    1024 *
    1024;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    return errorResponse("备份文件超过恢复上传上限", 413);
  }

  let passphrase = "";
  try {
    passphrase = decodeURIComponent(
      request.headers.get("x-ddt-backup-passphrase") ?? "",
    );
  } catch {
    return errorResponse("备份口令编码无效");
  }
  if (!request.body) return errorResponse("请选择备份文件");
  const uploadPath = path.join(
    /* turbopackIgnore: true */ dataDirectory,
    `.restore-upload-${crypto.randomUUID()}.ddtbackup`,
  );

  try {
    await pipeline(
      Readable.from(requestChunks(request.body, maximumBytes)),
      // The stream itself enforces the limit when Content-Length is absent.
      createWriteStream(uploadPath, { mode: 0o600 }),
    );
    const restored = await stageMaintenanceRestore({
      uploadPath,
      passphrase,
      actorUsername: session.username,
    });
    auditRequest(request, session, {
      action: "system.restore.stage",
      resourceType: "database",
      detail: {
        stagedAt: restored.stagedAt,
        backupCreatedAt: restored.backupCreatedAt,
        safetyBackupId: restored.safetyBackup.id,
        restartRequired: true,
      },
    });
    return NextResponse.json(restored, { status: 202 });
  } catch (error) {
    auditRequest(request, session, {
      action: "system.restore.stage",
      resourceType: "database",
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    const message =
      error instanceof Error ? error.message : "恢复备份失败";
    const status = message === "备份文件超过恢复上传上限"
      ? 413
      : message.includes("已有等待生效")
        ? 409
        : /(备份|口令|数据库|密码|管理员|密钥|格式|哈希|完整性|不一致|不支持)/.test(
              message,
            )
          ? 400
          : 500;
    return errorResponse(
      message,
      status,
    );
  } finally {
    if (existsSync(uploadPath)) rmSync(uploadPath);
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  const cancelled = cancelPendingRestore();
  if (!cancelled) return errorResponse("没有等待生效的恢复任务", 404);
  auditRequest(request, session, {
    action: "system.restore.cancel",
    resourceType: "database",
  });
  return NextResponse.json({ success: true });
}
