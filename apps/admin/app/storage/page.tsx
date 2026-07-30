import { AdminShell } from "@/components/admin-shell";
import { StorageOverview } from "@/components/storage-overview";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function StoragePage() {
  const session = await requireSession();
  return (
    <AdminShell user={session.user}>
      <StorageOverview />
    </AdminShell>
  );
}
