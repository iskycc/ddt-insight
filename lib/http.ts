import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordApiCall } from "@/lib/api-stats";

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
