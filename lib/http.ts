import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function requireApiSession() {
  const session = await getSession();
  return session;
}
