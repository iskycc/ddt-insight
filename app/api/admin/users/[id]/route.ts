import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import { deleteUser, updateUser } from "@/lib/users";
import type { UserRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);
  const { id } = await context.params;

  let body: {
    displayName?: string;
    role?: UserRole;
    enabled?: boolean;
    password?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }

  try {
    if (
      id === session.userId &&
      ((body.role !== undefined && body.role !== "admin") ||
        body.enabled === false)
    ) {
      throw new Error("不能降低当前账户的权限或停用当前账户");
    }
    const user = updateUser(id, body);
    auditRequest(request, session, {
      action: body.password === undefined ? "user.update" : "user.password",
      resourceType: "user",
      resourceId: user.username,
      detail: {
        role: user.role,
        enabled: user.enabled,
        passwordChanged: body.password !== undefined,
      },
    });
    return NextResponse.json(user);
  } catch (error) {
    auditRequest(request, session, {
      action: body.password === undefined ? "user.update" : "user.password",
      resourceType: "user",
      resourceId: id,
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "更新用户失败",
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);
  const { id } = await context.params;

  try {
    const user = deleteUser(id, session.userId);
    auditRequest(request, session, {
      action: "user.delete",
      resourceType: "user",
      resourceId: user.username,
      detail: { role: user.role, provider: user.provider },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    auditRequest(request, session, {
      action: "user.delete",
      resourceType: "user",
      resourceId: id,
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "删除用户失败",
    );
  }
}
