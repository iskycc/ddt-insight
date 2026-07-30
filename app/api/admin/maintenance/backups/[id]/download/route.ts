import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import { getMaintenanceBackup } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  const { id } = await context.params;
  try {
    const backup = getMaintenanceBackup(id);
    if (!backup) return errorResponse("备份不存在", 404);
    auditRequest(request, session, {
      action: "system.backup.download",
      resourceType: "backup",
      resourceId: id,
    });
    const body = Readable.toWeb(
      createReadStream(backup.filePath),
    ) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${backup.metadata.fileName}"`,
        "Content-Length": String(backup.metadata.sizeBytes),
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "下载备份失败",
      500,
    );
  }
}
