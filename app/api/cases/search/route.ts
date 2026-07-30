import { NextRequest, NextResponse } from "next/server";
import { searchCases } from "@/lib/case-management";
import { errorResponse, requireApiSession } from "@/lib/http";

export const dynamic = "force-dynamic";

function numberOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  if (!(await requireApiSession())) return errorResponse("请先登录", 401);
  const query = request.nextUrl.searchParams;
  try {
    const result = searchCases({
      caseIdPrefix: query.get("caseIdPrefix") ?? "",
      text: query.get("text") ?? "",
      srNum: query.get("srNum") ?? "",
      sourceName: query.get("sourceName") ?? "",
      filters: query.get("filters") ?? "",
      cursor: query.get("cursor") ?? "",
      limit: numberOrDefault(query.get("limit"), 50),
    });
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "搜索用例失败",
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireApiSession())) return errorResponse("请先登录", 401);
  let body: {
    caseIdPrefix?: string;
    text?: string;
    srNum?: string;
    sourceName?: string;
    filters?: unknown;
    cursor?: string;
    limit?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }
  try {
    const result = searchCases({
      ...body,
      limit: numberOrDefault(body.limit, 50),
    });
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "搜索用例失败",
    );
  }
}
