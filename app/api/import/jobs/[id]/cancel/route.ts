import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireEditorSession } from "@/lib/http";
import { cancelImportJob } from "@/lib/import-jobs";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireEditorSession();
  if (session instanceof NextResponse) return session;
  const { id } = await context.params;
  const job = await cancelImportJob(id, session);
  if (!job) return errorResponse("导入任务不存在", 404);
  return NextResponse.json(job);
}
