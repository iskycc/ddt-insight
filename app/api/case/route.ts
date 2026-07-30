import { NextRequest, NextResponse } from "next/server";
import { getCase } from "@/lib/repository";

export const dynamic = "force-dynamic";

function withOpenHeaders(response: NextResponse, startedAt: number) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("X-Response-Time", `${performance.now() - startedAt}ms`);
  return response;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  const caseId = request.nextUrl.searchParams.get("caseId")?.trim();

  if (!caseId) {
    return withOpenHeaders(
      NextResponse.json(
        { error: "请通过 caseId 参数传入 CaseID" },
        { status: 400 },
      ),
      startedAt,
    );
  }

  const data = getCase(caseId);
  if (!data) {
    return withOpenHeaders(
      NextResponse.json({ error: "未找到该 CaseID" }, { status: 404 }),
      startedAt,
    );
  }

  return withOpenHeaders(NextResponse.json(data), startedAt);
}
