import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireAdminSession } from "@/lib/http";
import { testLdapConnection } from "@/lib/ldap";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

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
