import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import { getLdapConfig, saveLdapConfig } from "@/lib/ldap";
import type { UserRole } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);
  return NextResponse.json(getLdapConfig());
}

export async function PUT(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  let body: {
    enabled?: boolean;
    url?: string;
    bindDn?: string;
    bindPassword?: string;
    clearBindPassword?: boolean;
    userBaseDn?: string;
    userFilter?: string;
    displayNameAttribute?: string;
    defaultRole?: UserRole;
    tlsRejectUnauthorized?: boolean;
    connectTimeoutMs?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }

  try {
    const config = saveLdapConfig(
      {
        enabled: Boolean(body.enabled),
        url: body.url ?? "",
        bindDn: body.bindDn ?? "",
        bindPassword: body.bindPassword,
        clearBindPassword: body.clearBindPassword,
        userBaseDn: body.userBaseDn ?? "",
        userFilter: body.userFilter ?? "(uid={{username}})",
        displayNameAttribute: body.displayNameAttribute ?? "displayName",
        defaultRole: body.defaultRole ?? "editor",
        tlsRejectUnauthorized: body.tlsRejectUnauthorized !== false,
        connectTimeoutMs: Number(body.connectTimeoutMs ?? 5000),
      },
      session.username,
    );
    auditRequest(request, session, {
      action: "ldap.update",
      resourceType: "ldap_config",
      resourceId: config.url,
      detail: {
        enabled: config.enabled,
        defaultRole: config.defaultRole,
        tlsVerification: config.tlsRejectUnauthorized,
      },
    });
    return NextResponse.json(config);
  } catch (error) {
    auditRequest(request, session, {
      action: "ldap.update",
      resourceType: "ldap_config",
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "保存 LDAP 配置失败",
    );
  }
}
