import { NextRequest, NextResponse } from "next/server";
import { bulkUpdateCases } from "@/lib/case-management";
import { errorResponse, requireApiSession } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);

  let body: { caseIds?: unknown; changes?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }

  try {
    return NextResponse.json(
      bulkUpdateCases({
        caseIds: body.caseIds,
        changes: body.changes,
        actor: session,
      }),
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "批量修改失败",
    );
  }
}
