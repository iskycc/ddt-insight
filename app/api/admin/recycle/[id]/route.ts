import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import { purgeDeletedCase } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  const { id } = await context.params;
  try {
    const purged = purgeDeletedCase(id);
    if (!purged) return errorResponse("回收站记录不存在", 404);
    auditRequest(request, session, {
      action: "case.purge",
      resourceType: "case",
      resourceId: purged.caseId,
      detail: {
        recycleId: id,
        srNum: purged.srNum,
        historyRetained: true,
      },
    });
    return NextResponse.json({ success: true, ...purged });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "彻底删除失败",
      500,
    );
  }
}
