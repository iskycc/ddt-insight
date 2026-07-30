import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const response = NextResponse.json(getDashboardStats());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
