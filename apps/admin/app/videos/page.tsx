import { AdminShell } from "@/components/admin-shell";
import { VideoLibraryClient } from "@/components/video-library-client";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const session = await requireSession();
  return (
    <AdminShell user={session.user}>
      <VideoLibraryClient role={session.user.role} />
    </AdminShell>
  );
}
