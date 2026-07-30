import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireApiSession } from "@/lib/http";
import { listGroups } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requireApiSession())) {
    return errorResponse("请先登录", 401);
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const items = listGroups(
    request.nextUrl.searchParams.get("query") ?? "",
    Number.isFinite(limit) ? limit : 100,
  );
  return NextResponse.json({ items });
}
