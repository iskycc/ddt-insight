import { NextResponse } from "next/server";
import { errorResponse, requireAuthenticatedSession } from "@/lib/http";
import { getMaintenanceDiagnostics } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthenticatedSession();
  if (session instanceof NextResponse) return session;

  try {
    const response = NextResponse.json(getMaintenanceDiagnostics());
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "读取运维诊断失败",
      500,
    );
  }
}
