import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordApiCall, getApiCallStatistics } from "@/lib/api-stats";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireEditorSession } from "@/lib/http";
import { findUserById, updateOwnProfile } from "@/lib/users";

export async function GET() {
  const session = await getSession();
  recordApiCall(
    session ? "authenticated" : "anonymous",
    session?.userId,
  );
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  const user = findUserById(session.userId);
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    ...user,
    apiStats: getApiCallStatistics(session.userId),
  });
}

export async function PATCH(request: NextRequest) {
  const session = await requireEditorSession();
  if (session instanceof NextResponse) return session;

  const failure = (message: string) => {
    auditRequest(request, session, {
      action: "user.profile.update",
      resourceType: "user",
      resourceId: session.username,
      result: "failure",
      detail: { reason: message },
    });
    return errorResponse(message);
  };

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return failure("请求格式不正确");
  }

  const allowedFields = new Set(["displayName", "email"]);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    return failure("个人资料只允许修改显示名称和邮箱");
  }
  if (
    (body.displayName !== undefined && typeof body.displayName !== "string") ||
    (body.email !== undefined && typeof body.email !== "string")
  ) {
    return failure("个人资料字段格式不正确");
  }
  if (body.displayName === undefined && body.email === undefined) {
    return failure("没有需要保存的个人资料");
  }

  const before = findUserById(session.userId);
  try {
    const user = updateOwnProfile(session.userId, {
      displayName: body.displayName as string | undefined,
      email: body.email as string | undefined,
    });
    const changedFields = [
      before?.displayName !== user.displayName ? "displayName" : "",
      before?.email !== user.email ? "email" : "",
    ].filter(Boolean);
    auditRequest(request, session, {
      action: "user.profile.update",
      resourceType: "user",
      resourceId: user.username,
      detail: { changedFields },
    });
    return NextResponse.json({
      authenticated: true,
      ...user,
      apiStats: getApiCallStatistics(session.userId),
    });
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "更新个人资料失败",
    );
  }
}
