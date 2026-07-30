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
};

type PlayableFile = {
  id: string;
  role: string;
};

function preferredFile(files: PlayableFile[]) {
  return files.find(file => file.role === "PLAYBACK") ?? files.find(file => file.role === "ORIGINAL");
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
        where: { role: { in: ["PLAYBACK", "ORIGINAL"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, role: true }
      }
    }
  });
  const file = video ? preferredFile(video.files) : undefined;
  if (!video || !file) notFound();

  const requestHeaders = await headers();
  const parentReferer = requestHeaders.get("referer");
  if (!parentReferer) {
    return (
      <EmbedError message="กรุณาเปิดวิดีโอนี้ผ่าน iframe จากโดเมนที่ได้รับอนุญาต" />
    );
  }

  const apiBaseUrl = new URL(process.env.API_URL || "http://localhost:4000").origin;
  const response = await fetch(`${apiBaseUrl}/api/v1/playback/authorize`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Referer: parentReferer
    },
    body: JSON.stringify({
      videoPublicId: publicId,
      fileId: file.id
    })
  });
  if (!response.ok) {
    return (
      <EmbedError message="โดเมนนี้ไม่ได้รับอนุญาต หรือวิดีโอยังไม่พร้อมรับชม" />
    );
  }
  const grant = await response.json() as PlaybackGrant;

  return (
    <main className="embed-page">
      <EmbedPlayer initialGrant={grant} title={video.title} />
    </main>
  );
}
