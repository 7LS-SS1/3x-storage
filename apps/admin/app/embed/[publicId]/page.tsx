import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { EmbedPlayer } from "@/components/embed-player";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type PlaybackGrant = {
  playbackSessionId: string;
  expires: number;
  mediaUrl: string;
  eventToken: string;
  mediaType?: string;
  posterUrl?: string | null;
};

type PlayableFile = {
  id: string;
  role: string;
};

function preferredFile(files: PlayableFile[]) {
  return files.find(file => file.role === "HLS_MANIFEST") ?? files.find(file => file.role === "PLAYBACK") ?? files.find(file => file.role === "ORIGINAL");
}

function EmbedError({ message }: { message: string }) {
  return (
    <main className="embed-page">
      <section className="embed-error">
        <strong>ไม่สามารถเล่นวิดีโอได้</strong>
        <p>{message}</p>
      </section>
    </main>
  );
}

export default async function EmbedPage({
  params
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  if (!/^[a-zA-Z0-9_-]{10,128}$/.test(publicId)) notFound();

  const video = await prisma.video.findFirst({
    where: {
      publicId,
      status: { in: ["UPLOADED", "READY"] },
      deletedAt: null
    },
    select: {
      title: true,
      files: {
        where: { role: { in: ["HLS_MANIFEST", "PLAYBACK", "ORIGINAL"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, role: true }
      }
    }
  });
  const file = video ? preferredFile(video.files) : undefined;
  if (!video || !file) notFound();

  const requestHeaders = await headers();
  const parentReferer = requestHeaders.get("referer");

  const apiBaseUrl = new URL(process.env.API_URL || "http://localhost:4000").origin;
  const authorizationHeaders: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (parentReferer) authorizationHeaders.Referer = parentReferer;
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/playback/authorize`, {
    method: "POST",
    cache: "no-store",
    headers: authorizationHeaders,
    body: JSON.stringify({
      videoPublicId: publicId,
      fileId: file.id
    }),
    signal: AbortSignal.timeout(15_000)
    });
  } catch {
    console.error("[embed-authorize]", { publicId, code: "API_UNREACHABLE" });
    return <EmbedError message="เชื่อมต่อระบบเล่นวิดีโอไม่ได้ กรุณาลองใหม่ (API_UNREACHABLE)" />;
  }
  if (!response.ok) {
    console.error("[embed-authorize]", { publicId, status: response.status });
    const message = response.status === 429
      ? "มีคำขอรับชมจำนวนมาก กรุณารอประมาณ 1 นาทีแล้วลองใหม่"
      : response.status === 403
        ? "ระบบไม่อนุญาตคำขอรับชมนี้ กรุณาติดต่อผู้ดูแล"
        : response.status >= 500
          ? "ระบบเล่นวิดีโอขัดข้องชั่วคราว กรุณาลองใหม่"
          : "ไม่สามารถขอสิทธิ์รับชมได้ กรุณาติดต่อผู้ดูแล";
    return (
      <EmbedError message={`${message} (HTTP ${response.status})`} />
    );
  }
  const grant = await response.json() as PlaybackGrant;

  return (
    <main className="embed-page">
      <EmbedPlayer initialGrant={grant} title={video.title} />
    </main>
  );
}
