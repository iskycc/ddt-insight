import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireApiSession } from "@/lib/http";
import { listCases } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requireApiSession())) {
    return errorResponse("请先登录", 401);
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = Number(searchParams.get("limit") ?? 50);
  const offset = Number(searchParams.get("offset") ?? 0);

  const result = listCases({
    query: searchParams.get("query") ?? "",
    srNum: searchParams.get("srNum") ?? "",
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
  });

  const response = NextResponse.json(result);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
