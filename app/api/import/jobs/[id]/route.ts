import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireApiSession } from "@/lib/http";
import { getImportJob, kickImportWorker } from "@/lib/import-jobs";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  const { id } = await context.params;
  kickImportWorker();
  const job = getImportJob(id, session);
  if (!job) return errorResponse("导入任务不存在", 404);
  const response = NextResponse.json(job);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
