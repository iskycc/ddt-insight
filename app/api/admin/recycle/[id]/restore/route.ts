import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireAdminSession } from "@/lib/http";
import { restoreDeletedCase } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

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
