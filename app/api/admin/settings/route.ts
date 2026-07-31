import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireAdminSession, requireAuthenticatedSession } from "@/lib/http";
import {
  getSystemSettings,
  updateSystemSettings,
  type SystemSettings,
} from "@/lib/system-settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireAuthenticatedSession();
  if (session instanceof NextResponse) return session;

  try {
    const response = NextResponse.json(getSystemSettings());
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "读取系统配置失败",
      500,
    );
  }
}

export async function PUT(request: NextRequest) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  let body: Partial<SystemSettings>;
  try {
    body = (await request.json()) as Partial<SystemSettings>;
  } catch {
    return errorResponse("请求体必须是 JSON");
  }

  try {
    const settings = updateSystemSettings(body, session.username);
    auditRequest(request, session, {
      action: "system.settings.update",
      resourceType: "system_settings",
      result: "success",
      detail: { updated: body },
    });
    const response = NextResponse.json(settings);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    auditRequest(request, session, {
      action: "system.settings.update",
      resourceType: "system_settings",
      result: "failure",
      detail: {
        updated: body,
        error: error instanceof Error ? error.message : "",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "更新系统配置失败",
      400,
    );
  }
}
