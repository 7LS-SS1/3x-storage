import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { UserManager } from "@/components/user-manager";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await requireSession();
  if (session.user.role === "STAFF") redirect("/dashboard");

  return (
    <AdminShell user={session.user}>
      <UserManager
        currentRole={session.user.role}
        currentUserId={session.user.id}
      />
    </AdminShell>
  );
}
