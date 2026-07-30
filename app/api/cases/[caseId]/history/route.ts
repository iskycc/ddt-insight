import { NextRequest, NextResponse } from "next/server";
import { listCaseHistory } from "@/lib/case-history";
import { errorResponse, requireApiSession } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);

  const { caseId } = await context.params;
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 15);
  const beforeId = Number(
    request.nextUrl.searchParams.get("beforeId") ?? 0,
  );
  const history = listCaseHistory(caseId, {
    limit: Number.isFinite(limit) ? limit : 15,
    beforeId:
      Number.isSafeInteger(beforeId) && beforeId > 0
        ? beforeId
        : undefined,
  });

  if (!history) return errorResponse("未找到该 CaseID", 404);

  const response = NextResponse.json(history);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
