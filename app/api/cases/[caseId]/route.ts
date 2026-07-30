import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireApiSession } from "@/lib/http";
import { getCase, updateCaseColumn } from "@/lib/repository";

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
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }

  const column = body.column?.trim() ?? "";
  if (!column || !Object.hasOwn(body, "value")) {
    return errorResponse("column 和 value 为必填项");
  }

  try {
    const updated = updateCaseColumn(caseId, column, body.value ?? null);
    if (!updated) return errorResponse("未找到该 CaseID", 404);
    auditRequest(request, session, {
      action: "case.update",
      resourceType: "case",
      resourceId: caseId,
      detail: {
        column,
        nextCaseId:
          column === "CaseID" ? String(body.value ?? "") : undefined,
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    auditRequest(request, session, {
      action: "case.update",
      resourceType: "case",
      resourceId: caseId,
      result: "failure",
      detail: {
        column,
        reason: error instanceof Error ? error.message : "unknown",
      },
    });
    return errorResponse(
      error instanceof Error ? error.message : "修改用例失败",
    );
  }
}
