import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import { checkpointDatabase } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  try {
    const result = checkpointDatabase();
    auditRequest(request, session, {
      action: "system.database.checkpoint",
      resourceType: "database",
      detail: result,
    });
    return NextResponse.json(result);
  } catch (error) {
    auditRequest(request, session, {
      action: "system.database.checkpoint",
      resourceType: "database",
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "数据库检查点执行失败",
      500,
    );
  }
}
