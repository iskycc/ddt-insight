import { NextRequest, NextResponse } from "next/server";
import { auditRequest } from "@/lib/audit";
import { errorResponse, requireAdminSession } from "@/lib/http";
import { deleteMaintenanceBackup } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;

  const { id } = await context.params;
  try {
    const deleted = deleteMaintenanceBackup(id);
    if (!deleted) return errorResponse("备份不存在", 404);
    auditRequest(request, session, {
      action: "system.backup.delete",
      resourceType: "backup",
      resourceId: id,
      detail: { createdAt: deleted.createdAt },
    });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "删除备份失败",
      500,
    );
  }
}
