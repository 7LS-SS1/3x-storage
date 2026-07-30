import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { DomainManager } from "@/components/domain-manager";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const session = await requireSession();
  if (session.user.role === "STAFF") redirect("/dashboard");

  return (
    <AdminShell user={session.user}>
      <DomainManager />
    </AdminShell>
  );
}
