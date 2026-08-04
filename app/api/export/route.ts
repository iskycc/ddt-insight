import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import { buildExportWorkbook } from "@/lib/spreadsheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeExportName(value: string) {
  return Array.from(
    value
      .toWellFormed()
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_"),
  )
    .slice(0, 80)
    .join("");
}

function encodeContentDispositionFileName(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) {
    return errorResponse("请先登录", 401);
  }

  const searchParams = request.nextUrl.searchParams;
  const srNum = searchParams.get("srNum")?.trim() || undefined;
  const caseIds = searchParams.getAll("caseId").filter(Boolean);

  try {
    const buffer = buildExportWorkbook({ srNum, caseIds });
    const exportDate = new Date().toISOString().slice(0, 10);
    const suffix = srNum ? `-${safeExportName(srNum)}` : "";
    const fileName = `ddt-cases${suffix}-${exportDate}.xlsx`;
    const fallbackFileName = `ddt-cases-${exportDate}.xlsx`;
    auditRequest(request, session, {
      action: "case.export",
      resourceType: "export",
      resourceId: srNum ?? "",
      detail: {
        scope: caseIds.length ? "selected" : srNum ? "group" : "all",
        selectedCases: caseIds.length,
      },
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeContentDispositionFileName(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    auditRequest(request, session, {
      action: "case.export",
      resourceType: "export",
      resourceId: srNum ?? "",
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "导出失败",
    );
  }
}
