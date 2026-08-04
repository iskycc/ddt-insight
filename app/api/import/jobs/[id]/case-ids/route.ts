import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireEditorSession } from "@/lib/http";
import {
  getImportJobCaseIdExport,
  streamImportJobCaseIds,
} from "@/lib/import-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireEditorSession();
  if (session instanceof NextResponse) return session;

  const { id } = await context.params;
  const caseIdExport = getImportJobCaseIdExport(id, session);
  if (!caseIdExport) return errorResponse("导入任务不存在", 404);
  if (!["completed", "failed", "cancelled"].includes(caseIdExport.status)) {
    return errorResponse("导入任务尚未结束，暂不能导出 CaseID", 409);
  }
  if (!caseIdExport.canExport) {
    return errorResponse("该任务没有成功处理的 CaseID 可导出", 409);
  }

  auditRequest(request, session, {
    action: "case.export",
    resourceType: "import_job",
    resourceId: caseIdExport.id,
    detail: {
      scope: "import_job_case_ids",
      status: caseIdExport.status,
    },
  });

  const fileName = `ddt-import-${caseIdExport.id.slice(0, 8)}-caseids.txt`;
  const body = Readable.toWeb(
    Readable.from(streamImportJobCaseIds(caseIdExport.id)),
  ) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
