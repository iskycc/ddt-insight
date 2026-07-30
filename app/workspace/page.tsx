import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkspaceClient } from "@/components/workspace-client";

export const metadata: Metadata = {
  title: "管理工作台",
};

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <WorkspaceClient
      userId={session.userId}
      username={session.username}
      displayName={session.displayName}
      role={session.role}
      provider={session.provider}
    />
  );
}
