import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import {
  createMaintenanceBackup,
  listMaintenanceBackups,
} from "@/lib/maintenance";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  const response = NextResponse.json({ items: listMaintenanceBackups() });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  let body: { passphrase?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }

  try {
    const backup = await createMaintenanceBackup(
      body.passphrase ?? "",
      session.username,
    );
    auditRequest(request, session, {
      action: "system.backup.create",
      resourceType: "backup",
      resourceId: backup.id,
      detail: {
        sizeBytes: backup.sizeBytes,
        databaseBytes: backup.databaseBytes,
      },
    });
    return NextResponse.json(backup, { status: 201 });
  } catch (error) {
    auditRequest(request, session, {
      action: "system.backup.create",
      resourceType: "backup",
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "创建备份失败",
      500,
    );
  }
}
