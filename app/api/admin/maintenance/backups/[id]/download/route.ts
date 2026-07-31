import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireAuthenticatedSession } from "@/lib/http";
import { getMaintenanceBackup } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAuthenticatedSession();
  if (session instanceof NextResponse) return session;

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
