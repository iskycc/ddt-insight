import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordApiCall } from "@/lib/api-stats";
import { canEditCases, canManageSystem } from "@/lib/permissions";
import type { AuthSession } from "@/lib/types";

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireApiSession() {
  const session = await getSession();
  recordApiCall(
    session ? "authenticated" : "anonymous",
    session?.userId,
  );
  return session;
}

export async function requireAuthenticatedSession(): Promise<
  AuthSession | NextResponse
> {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  return session;
}

export async function requireEditorSession(): Promise<
  AuthSession | NextResponse
> {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (!canEditCases(session.role)) {
    return errorResponse("需要编辑权限", 403);
  }
  return session;
}

export async function requireAdminSession(): Promise<
  AuthSession | NextResponse
> {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (!canManageSystem(session.role)) {
    return errorResponse("需要管理员权限", 403);
  }
  return session;
}
