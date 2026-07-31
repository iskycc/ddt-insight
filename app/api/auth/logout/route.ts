import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/auth";
import { recordApiCall } from "@/lib/api-stats";
import { auditRequest } from "@/lib/audit";

export async function POST(request: NextRequest) {
  const session = await getSession();
  recordApiCall(
    session ? "authenticated" : "anonymous",
    session?.userId,
  );
  if (session) {
    auditRequest(request, session, {
      action: "auth.logout",
      resourceType: "session",
    });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
