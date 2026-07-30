import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireApiSession } from "@/lib/http";
import { cancelImportJob } from "@/lib/import-jobs";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  const { id } = await context.params;
  const job = await cancelImportJob(id, session);
  if (!job) return errorResponse("导入任务不存在", 404);
  return NextResponse.json(job);
}
