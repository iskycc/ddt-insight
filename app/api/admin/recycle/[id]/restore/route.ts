import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import { restoreDeletedCase } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  const { id } = await context.params;
  try {
    const restored = restoreDeletedCase(id);
    if (!restored) return errorResponse("回收站记录不存在", 404);
    auditRequest(request, session, {
      action: "case.restore",
      resourceType: "case",
      resourceId: restored.caseId,
      detail: {
        recycleId: id,
        srNum: restored.srNum,
      },
    });
    return NextResponse.json(restored);
  } catch (error) {
    auditRequest(request, session, {
      action: "case.restore",
      resourceType: "case",
      resourceId: id,
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "恢复用例失败",
    );
  }
}
