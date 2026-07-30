import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { AuditViewer } from "@/components/audit-viewer";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await requireSession();
  if (session.user.role === "STAFF") redirect("/dashboard");

  return (
    <AdminShell user={session.user}>
      <AuditViewer />
    </AdminShell>
  );
}
