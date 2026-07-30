import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { SystemSettings } from "@/components/system-settings";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  if (session.user.role !== "SYSTEM") redirect("/dashboard");

  return (
    <AdminShell user={session.user}>
      <SystemSettings />
    </AdminShell>
  );
}
