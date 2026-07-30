import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { normalizeBulkCaseIds } from "@/lib/case-management";
import { errorResponse, requireApiSession } from "@/lib/http";
import { trashCases } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);

  let body: { caseIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }

  let caseIds: string[] = [];
  try {
    caseIds = normalizeBulkCaseIds(body.caseIds);
    const result = trashCases(caseIds, session);
    auditRequest(request, session, {
      action: "case.delete",
      resourceType: "case_batch",
      resourceId: `batch:${result.deleted.length}`,
      detail: {
        mode: "recycle_bin",
        requested: caseIds.length,
        deleted: result.deleted.length,
        caseIds: result.deleted.map((item) => item.caseId),
        notFound: result.notFound,
      },
    });
    return NextResponse.json({
      requested: caseIds.length,
      deleted: result.deleted.length,
      recycleItems: result.deleted,
      notFound: result.notFound,
    });
  } catch (error) {
    auditRequest(request, session, {
      action: "case.delete",
      resourceType: "case_batch",
      resourceId: "batch",
      result: "failure",
      detail: {
        requested: caseIds.length,
        mode: "recycle_bin",
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "批量移至回收站失败",
    );
  }
}
