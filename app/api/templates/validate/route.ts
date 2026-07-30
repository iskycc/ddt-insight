import { NextRequest, NextResponse } from "next/server";
import {
  getCaseTemplate,
  validateCaseAgainstTemplate,
} from "@/lib/case-management";
import { errorResponse, requireApiSession } from "@/lib/http";
import type { CaseData } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!(await requireApiSession())) return errorResponse("请先登录", 401);
  let body: { data?: unknown; templateId?: string; applyDefaults?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("请求格式不正确");
  }
  if (
    !body.data ||
    typeof body.data !== "object" ||
    Array.isArray(body.data)
  ) {
    return errorResponse("data 必须是用例 Map");
  }
  const template = body.templateId
    ? getCaseTemplate(body.templateId)
    : undefined;
  if (body.templateId && !template) return errorResponse("未找到模板", 404);
  return NextResponse.json(
    validateCaseAgainstTemplate(
      body.data as CaseData,
      template,
      { applyDefaults: body.applyDefaults !== false },
    ),
  );
}
