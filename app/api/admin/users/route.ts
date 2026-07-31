import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireAdminSession, requireAuthenticatedSession } from "@/lib/http";
import { createLocalUser, listUsers } from "@/lib/users";
import type { UserRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthenticatedSession();
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ items: listUsers() });
}

export async function POST(request: NextRequest) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  let body: {
    username?: string;
    displayName?: string;
    password?: string;
    role?: UserRole;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }

  try {
    const user = createLocalUser({
      username: body.username ?? "",
      displayName: body.displayName,
      password: body.password ?? "",
      role: body.role ?? "editor",
    });
    auditRequest(request, session, {
      action: "user.create",
      resourceType: "user",
      resourceId: user.username,
      detail: { role: user.role, provider: user.provider },
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    auditRequest(request, session, {
      action: "user.create",
      resourceType: "user",
      resourceId: body.username ?? "",
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "创建用户失败",
    );
  }
}
