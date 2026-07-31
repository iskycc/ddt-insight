import { NextRequest, NextResponse } from "next/server";
import { recordApiCall } from "@/lib/api-stats";
import { auditRequest } from "@/lib/audit";
import { isCellValue } from "@/lib/case-data";
import { errorResponse, requireApiSession } from "@/lib/http";
import { deleteCase, getCase, updateCaseColumn } from "@/lib/repository";

export const dynamic = "force-dynamic";

function openApiHeaders(response: NextResponse, startedAt: number) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("X-Response-Time", `${performance.now() - startedAt}ms`);
  return response;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  recordApiCall("open");
  const startedAt = performance.now();
  const { caseId } = await context.params;
  const data = getCase(caseId);

  if (!data) {
    return openApiHeaders(
      NextResponse.json({ error: "未找到该 CaseID" }, { status: 404 }),
      startedAt,
    );
  }

  return openApiHeaders(NextResponse.json(data), startedAt);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  const session = await requireApiSession();
  if (!session) {
    return errorResponse("请先登录", 401);
  }

  const { caseId } = await context.params;
  let body: {
    column?: string;
    value?: string | number | boolean | null;
    step?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }

  const column = body.column?.trim() ?? "";
  if (
    !column ||
    !Object.hasOwn(body, "value") ||
    !isCellValue(body.value)
  ) {
    return errorResponse("column 和 value 为必填项");
  }

  try {
    const updated = updateCaseColumn(
      caseId,
      column,
      body.value ?? null,
      session,
      body.step?.trim() || undefined,
    );
    if (!updated) return errorResponse("未找到该 CaseID", 404);
    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "修改用例失败",
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  const session = await requireApiSession();
  if (!session) {
    return errorResponse("请先登录", 401);
  }

  const { caseId } = await context.params;

  try {
    const deleted = deleteCase(caseId, session, (current) => {
      auditRequest(request, session, {
        action: "case.delete",
        resourceType: "case",
        resourceId: current.caseId,
        detail: {
          srNum: current.srNum,
          sourceName: current.sourceName,
          recycleId: current.recycleId,
        },
      });
    });

    if (!deleted) {
      auditRequest(request, session, {
        action: "case.delete",
        resourceType: "case",
        resourceId: caseId,
        result: "failure",
        detail: { reason: "not_found" },
      });
      return errorResponse("未找到该 CaseID", 404);
    }

    return NextResponse.json({
      success: true,
      caseId: deleted.caseId,
      recycleId: deleted.recycleId,
    });
  } catch (error) {
    auditRequest(request, session, {
      action: "case.delete",
      resourceType: "case",
      resourceId: caseId,
      result: "failure",
      detail: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "删除用例失败",
      500,
    );
  }
}
