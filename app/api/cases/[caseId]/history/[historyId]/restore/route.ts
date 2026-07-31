import { NextRequest, NextResponse } from "next/server";
import { restoreCaseHistoryVersion } from "@/lib/case-history";
import { errorResponse, requireEditorSession } from "@/lib/http";
import { invalidateCaseCache } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{ caseId: string; historyId: string }>;
  },
) {
  const session = await requireEditorSession();
  if (session instanceof NextResponse) return session;

  const { caseId, historyId: rawHistoryId } = await context.params;
  const historyId = Number(rawHistoryId);
  let snapshot: "before" | "after" = "before";
  try {
    const body = (await request.json()) as { snapshot?: unknown };
    if (body.snapshot === "after") snapshot = "after";
  } catch {
    // Empty bodies intentionally restore the state immediately before the
    // selected change, making the earliest recorded version recoverable.
  }

  try {
    const restored = restoreCaseHistoryVersion(
      caseId,
      historyId,
      session,
      snapshot,
    );
    if (!restored) {
      return errorResponse("未找到该 CaseID", 404);
    }

    invalidateCaseCache(caseId);
    invalidateCaseCache(restored.caseId);
    const response = NextResponse.json(restored);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "历史版本回滚失败",
    );
  }
}
