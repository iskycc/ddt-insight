import { NextResponse } from "next/server";
import { recordApiCall } from "@/lib/api-stats";
import { getDashboardStats } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  recordApiCall("open");
  const response = NextResponse.json(getDashboardStats());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
