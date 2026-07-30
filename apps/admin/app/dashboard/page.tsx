import {
  Activity,
  CirclePlay,
  Film,
  Gauge,
  HardDrive,
  Upload,
  Video
} from "lucide-react";
import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const statusLabels = {
  UPLOADING: "กำลังอัปโหลด",
  UPLOADED: "อัปโหลดแล้ว",
  INSPECTING: "กำลังตรวจสอบ",
  PROCESSING: "กำลังประมวลผล",
  READY: "พร้อมใช้งาน",
  UNPLAYABLE: "ไม่รองรับการเล่น",
  FAILED: "ล้มเหลว",
  DELETING: "กำลังลบ",
  DELETED: "ลบแล้ว"
};

function formatBytes(value: bigint | null | undefined) {
  const bytes = Number(value || 0n);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatNumber(value: bigint | number) {
  return new Intl.NumberFormat("th-TH").format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(value);
}

export default async function DashboardPage() {
  const session = await requireSession();
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [
    videoCount,
    storageAggregate,
    playAggregate,
    bandwidthAggregate,
    statuses,
    recentVideos,
    failedJobs
  ] = await Promise.all([
    prisma.video.count({ where: { deletedAt: null } }),
    prisma.videoFile.aggregate({ _sum: { sizeBytes: true } }),
    prisma.video.aggregate({
      where: { deletedAt: null },
      _sum: { playCount: true }
    }),
    prisma.bandwidthDaily.aggregate({
      where: { date: { gte: startOfMonth } },
      _sum: { bytesServed: true }
    }),
    prisma.video.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { id: true }
    }),
    prisma.video.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        title: true,
        status: true,
        fileSize: true,
        playCount: true,
        uploadedAt: true,
        createdAt: true,
        category: { select: { name: true } }
      }
    }),
    prisma.video.count({
      where: { status: "FAILED", deletedAt: null }
    })
  ]);

  const analyticsConfigured = Boolean(process.env.ANALYTICS_ENGINE_DATASET);
  const bandwidth = bandwidthAggregate._sum.bytesServed || 0n;

  return (
    <AdminShell user={session.user}>
      <header>
        <div>
          <span className="eyebrow">ศูนย์บัญชาการวิดีโอ</span>
          <h1>ภาพรวมระบบ</h1>
          <p>ข้อมูลจริงจากคลังวิดีโอและฐานข้อมูล ณ เวลาปัจจุบัน</p>
        </div>
        <div className="header-actions">
          <Link className="primary action-link" href="/upload">
            <Upload />อัปโหลดวิดีโอ
          </Link>
        </div>
      </header>

      <section className="ticker">
        <span><i /> ระบบฐานข้อมูลพร้อมใช้งาน</span>
        <b>LIVE STORAGE</b>
        <p>
          วิดีโอที่ล้มเหลว <strong>{failedJobs}</strong>
        </p>
        <p>
          สถานะทั้งหมด <strong>{statuses.length}</strong>
        </p>
      </section>

      <section className="metrics">
        <article>
          <div className="metric-top"><span>วิดีโอทั้งหมด</span><Film /></div>
          <strong>{formatNumber(videoCount)}</strong>
          <p>ไม่นับรายการที่ลบแล้ว</p><em>01</em>
        </article>
        <article>
          <div className="metric-top"><span>พื้นที่ใช้งาน</span><HardDrive /></div>
          <strong>{formatBytes(storageAggregate._sum.sizeBytes)}</strong>
          <p>รวมไฟล์ต้นฉบับและไฟล์อนุพันธ์</p><em>02</em>
        </article>
        <article>
          <div className="metric-top"><span>จำนวนการเล่นทั้งหมด</span><CirclePlay /></div>
          <strong>{formatNumber(playAggregate._sum.playCount || 0n)}</strong>
          <p>นับจาก playback event ที่ผ่านการยืนยัน</p><em>03</em>
        </article>
        <article>
          <div className="metric-top"><span>แบนด์วิดท์เดือนนี้</span><Gauge /></div>
          <strong>{analyticsConfigured ? formatBytes(bandwidth) : "ยังไม่มีข้อมูล"}</strong>
          <p>
            {analyticsConfigured
              ? "ข้อมูลสะสมจาก BandwidthDaily"
              : "ยังไม่ได้ตั้งค่า Cloudflare Analytics"}
          </p><em>04</em>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel status-summary">
          <span className="section-number">02 / สถานะวิดีโอ</span>
          <h2>รายการแยกตามสถานะ</h2>
          <div className="status-grid">
            {statuses.length ? statuses.map(item => (
              <div key={item.status}>
                <span>{statusLabels[item.status]}</span>
                <strong>{item._count.id}</strong>
              </div>
            )) : <p className="empty-copy">ยังไม่มีวิดีโอในระบบ</p>}
          </div>
        </article>
        <article className="panel health">
          <span className="section-number">03 / การดำเนินงาน</span>
          <h2>ทางลัด</h2>
          <Link href="/videos"><Film /> เปิดคลังวิดีโอ</Link>
          <Link href="/upload"><Upload /> อัปโหลดไฟล์ใหม่</Link>
          <Link href="/storage"><Activity /> ตรวจพื้นที่จัดเก็บ</Link>
        </article>
      </section>

      <section className="panel recent">
        <div className="panel-heading">
          <div>
            <span className="section-number">04 / คลังล่าสุด</span>
            <h2>วิดีโอที่เพิ่มล่าสุด</h2>
          </div>
          <Link href="/videos">ดูทั้งหมด</Link>
        </div>
        {recentVideos.length ? (
          <div className="table dashboard-table">
            <div className="tr th">
              <span>ชื่อวิดีโอ</span><span>หมวดหมู่</span><span>ขนาด</span>
              <span>ยอดรับชม</span><span>สถานะ</span><span />
            </div>
            {recentVideos.map(item => (
              <div className="tr" key={item.id}>
                <span className="video-title">
                  <div className="thumb"><Video /></div>
                  <b>{item.title}<small>{formatDate(item.uploadedAt || item.createdAt)}</small></b>
                </span>
                <span><mark>{item.category?.name || "ไม่มีหมวดหมู่"}</mark></span>
                <span>{formatBytes(item.fileSize)}</span>
                <span>{formatNumber(item.playCount)}</span>
                <span className={item.status === "READY" ? "ready" : "processing"}>
                  <i />{statusLabels[item.status]}
                </span>
                <span />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Film />
            <strong>ยังไม่มีวิดีโอ</strong>
            <p>เริ่มต้นด้วยการอัปโหลดไฟล์วิดีโอเข้าสู่พื้นที่จัดเก็บ</p>
            <Link className="primary action-link" href="/upload">อัปโหลดวิดีโอ</Link>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
