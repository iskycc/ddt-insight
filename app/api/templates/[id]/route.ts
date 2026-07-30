import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import {
  deleteCaseTemplate,
  getCaseTemplate,
  updateCaseTemplate,
} from "@/lib/case-management";
import { errorResponse, requireApiSession } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await requireApiSession())) return errorResponse("请先登录", 401);
  const { id } = await context.params;
  const template = getCaseTemplate(id);
  return template
    ? NextResponse.json(template)
    : errorResponse("未找到模板", 404);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  const { id } = await context.params;
  let body: {
    srNum?: string;
    name?: string;
    description?: string;
    rules?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }
  try {
    const template = updateCaseTemplate(
      id,
      {
        srNum: body.srNum ?? "",
        name: body.name ?? "",
        description: body.description,
        rules: body.rules ?? [],
      },
      session.username,
    );
    if (!template) return errorResponse("未找到模板", 404);
    auditRequest(request, session, {
      action: "case.template.update",
      resourceType: "case_template",
      resourceId: template.id,
      detail: { srNum: template.srNum, ruleCount: template.rules.length },
    });
    return NextResponse.json(template);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "保存模板失败",
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
  const { id } = await context.params;
  const template = getCaseTemplate(id);
  if (!template || !deleteCaseTemplate(id)) {
    return errorResponse("未找到模板", 404);
  }
  auditRequest(request, session, {
    action: "case.template.delete",
    resourceType: "case_template",
    resourceId: id,
    detail: { srNum: template.srNum },
  });
  return NextResponse.json({ success: true, id });
}
