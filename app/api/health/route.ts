import { NextResponse } from "next/server";
import { recordApiCall } from "@/lib/api-stats";

export async function GET() {
  recordApiCall("open");
  return NextResponse.json({
    status: "ok",
    mode: "offline",
    timestamp: new Date().toISOString(),
  });
}
