import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, validateCredentials } from "@/lib/auth";
import { errorResponse } from "@/lib/http";

export async function POST(request: NextRequest) {
  let body: { username?: string; password?: string };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }

  const username = body.username?.trim() ?? "";
  const password = body.password ?? "";

  if (!validateCredentials(username, password)) {
    return errorResponse("用户名或密码不正确", 401);
  }

  await setSessionCookie(username);
  return NextResponse.json({ ok: true, username });
}
