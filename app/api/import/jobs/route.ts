import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireApiSession } from "@/lib/http";
import {
  enqueueImportJob,
  type ImportConflictStrategy,
} from "@/lib/import-jobs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);

  let body: { jobId?: unknown; strategy?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求内容不是有效 JSON");
  }

  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const strategy =
    typeof body.strategy === "string" ? body.strategy : "overwrite";
  if (!jobId) return errorResponse("缺少预检任务标识");
  if (!["overwrite", "skip", "error"].includes(strategy)) {
    return errorResponse("不支持该冲突处理策略");
  }

  try {
    const job = enqueueImportJob(
      jobId,
      strategy as ImportConflictStrategy,
      session,
    );
    if (!job) return errorResponse("导入预检不存在", 404);
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "无法启动导入任务",
      409,
    );
  }
}
