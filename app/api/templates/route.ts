import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import {
  createCaseTemplate,
  listCaseTemplates,
} from "@/lib/case-management";
import { errorResponse, requireApiSession } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireApiSession())) return errorResponse("请先登录", 401);
  const response = NextResponse.json({ items: listCaseTemplates() });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (!session) return errorResponse("请先登录", 401);
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
    const template = createCaseTemplate(
      {
        srNum: body.srNum ?? "",
        name: body.name ?? "",
        description: body.description,
        rules: body.rules ?? [],
      },
      session.username,
    );
    auditRequest(request, session, {
      action: "case.template.create",
      resourceType: "case_template",
      resourceId: template.id,
      detail: { srNum: template.srNum, ruleCount: template.rules.length },
    });
    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "创建模板失败",
    );
  }
}
