import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireAuthenticatedSession } from "@/lib/http";
import { listDeletedCases } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (session instanceof NextResponse) return session;

  const parameters = request.nextUrl.searchParams;
  const limit = Number(parameters.get("limit") ?? 30);
  const offset = Number(parameters.get("offset") ?? 0);
  const result = listDeletedCases({
    query: parameters.get("query") ?? "",
    limit: Number.isFinite(limit) ? limit : 30,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  const response = NextResponse.json(result);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
