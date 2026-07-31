import { NextRequest, NextResponse } from "next/server";
import { listAuditLogs } from "@/lib/audit";
import { errorResponse, requireAuthenticatedSession } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (session instanceof NextResponse) return session;

  const parameters = request.nextUrl.searchParams;
  const limit = Number(parameters.get("limit") ?? 50);
  const offset = Number(parameters.get("offset") ?? 0);
  const result = listAuditLogs({
    query: parameters.get("query") ?? "",
    category: parameters.get("category") ?? "",
    action: parameters.get("action") ?? "",
    result: parameters.get("result") ?? "",
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  const response = NextResponse.json(result);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
