import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireApiSession } from "@/lib/http";
import { kickImportWorker, listImportSources } from "@/lib/import-jobs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  kickImportWorker();
  const parameters = request.nextUrl.searchParams;
  const limit = Number(parameters.get("limit") ?? 30);
  const offset = Number(parameters.get("offset") ?? 0);
  const result = listImportSources({
    query: parameters.get("query") ?? "",
    status: parameters.get("status") ?? "",
    strategy: parameters.get("strategy") ?? "",
    limit: Number.isFinite(limit) ? limit : 30,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  const response = NextResponse.json(result);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
