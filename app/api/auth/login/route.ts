import { NextRequest, NextResponse } from "next/server";
import {
  authenticateCredentials,
  authenticationProviderFor,
  setSessionCookie,
} from "@/lib/auth";
import { recordApiCall } from "@/lib/api-stats";
import { auditRequest } from "@/lib/audit";
import { errorResponse } from "@/lib/http";

export async function POST(request: NextRequest) {
  let body: { username?: string; password?: string };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    recordApiCall("anonymous");
    return errorResponse("请求格式不正确");
  }

  const username = body.username?.trim() ?? "";
  const password = body.password ?? "";

  if (!username || username.length > 128 || password.length > 512) {
    recordApiCall("anonymous");
    auditRequest(request, null, {
      actorUsername: username || "anonymous",
      action: "auth.login",
      resourceType: "session",
      result: "failure",
      detail: { reason: "invalid_input" },
    });
    return errorResponse("用户名或密码不正确", 401);
  }

  const user = await authenticateCredentials(username, password);
  if (!user) {
    recordApiCall("anonymous");
    auditRequest(request, null, {
      actorUsername: username || "anonymous",
      actorProvider: authenticationProviderFor(username),
      action: "auth.login",
      resourceType: "session",
      result: "failure",
      detail: { reason: "invalid_credentials" },
    });
    return errorResponse("用户名或密码不正确", 401);
  }

  await setSessionCookie(user);
  recordApiCall("authenticated", user.id);
  auditRequest(request, user, {
    action: "auth.login",
    resourceType: "session",
    result: "success",
  });
  return NextResponse.json({
    ok: true,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    groups: user.groups,
    role: user.role,
    provider: user.provider,
  });
}
