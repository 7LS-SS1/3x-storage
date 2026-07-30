import { AdminShell } from "@/components/admin-shell";
import { UploadManager } from "@/components/upload-manager";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const session = await requireSession();
  return (
    <AdminShell user={session.user}>
      <UploadManager />
    </AdminShell>
  );
}
