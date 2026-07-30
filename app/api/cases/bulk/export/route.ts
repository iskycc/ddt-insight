import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { normalizeBulkCaseIds } from "@/lib/case-management";
import { errorResponse, requireApiSession } from "@/lib/http";
import { buildExportWorkbook } from "@/lib/spreadsheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  let body: { caseIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }

  let caseIds: string[] = [];
  try {
    caseIds = normalizeBulkCaseIds(body.caseIds, 2_000);
    const buffer = buildExportWorkbook({ caseIds });
    auditRequest(request, session, {
      action: "case.export",
      resourceType: "export",
      resourceId: "selected",
      detail: { scope: "selected", selectedCases: caseIds.length },
    });
    const fileName = `ddt-selected-cases-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    auditRequest(request, session, {
      action: "case.export",
      resourceType: "export",
      resourceId: "selected",
      result: "failure",
      detail: {
        selectedCases: caseIds.length,
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "导出失败",
    );
  }
}
