import { NextResponse } from "next/server";
import { errorResponse, requireApiSession } from "@/lib/http";
import { getMaintenanceDiagnostics } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

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
