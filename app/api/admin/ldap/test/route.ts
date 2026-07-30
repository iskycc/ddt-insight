import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import { testLdapConnection } from "@/lib/ldap";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  if (session.role !== "admin") return errorResponse("需要管理员权限", 403);

  try {
    const result = await testLdapConnection();
    auditRequest(request, session, {
      action: "ldap.test",
      resourceType: "ldap_config",
    });
    return NextResponse.json(result);
  } catch (error) {
    auditRequest(request, session, {
      action: "ldap.test",
      resourceType: "ldap_config",
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "LDAP 连接测试失败",
    );
  }
}
