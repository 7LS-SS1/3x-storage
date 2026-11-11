import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { MetadataImportManager } from "@/components/metadata-import-manager";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export default async function MetadataImportPage() {
  const session = await requireSession();
  if (session.user.role === "STAFF") redirect("/dashboard");
  return <AdminShell user={session.user}><MetadataImportManager /></AdminShell>;
}
