"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  FileVideo,
  HardDrive,
  RefreshCw,
  Upload
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type StorageSummary = {
  storage: {
    connected: boolean;
    driver: "s3" | "r2";
    bucket: string;
    endpointHost: string;
    error?: string;
  };
  usage: {
    usedBytes: string;
    capacityBytes: string | null;
    percent: number | null;
    objectCount: number;
    activeUploads: number;
  };
  byRole: Array<{ role: string; bytes: string; count: number }>;
  videosByStatus: Array<{ status: string; count: number }>;
  recentFiles: Array<{
    id: string;
    filename: string;
    role: string;
    mimeType: string;
    sizeBytes: string;
    createdAt: string;
    video: { id: string; title: string };
  }>;
};

const roleLabels: Record<string, string> = {
  ORIGINAL: "ไฟล์ต้นฉบับ",
  PLAYBACK: "ไฟล์สำหรับเล่น",
  POSTER: "ภาพปก",
  HLS_MANIFEST: "HLS Manifest",
  HLS_SEGMENT: "HLS Segment"
};

function formatBytes(value: string | number) {
  const bytes = Number(value);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 2 : 0)} ${units[index]}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(new Date(value));
}

export function StorageOverview() {
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSummary(await apiRequest<StorageSummary>("/storage/summary"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "ตรวจสอบพื้นที่จัดเก็บไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">STORAGE OPERATIONS / OBJECT STORE</span>
          <h1>พื้นที่จัดเก็บ</h1>
          <p>สถานะการเชื่อมต่อ การใช้งานจริง และไฟล์ล่าสุดใน private bucket</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" disabled={loading} onClick={() => void load()} type="button">
            <RefreshCw />ตรวจสอบใหม่
          </button>
        </div>
      </header>

      {error && <div className="notice error-notice"><AlertTriangle />{error}</div>}
      {loading && !summary ? (
        <div className="loading-state"><span className="spinner" />กำลังตรวจพื้นที่จัดเก็บ…</div>
      ) : summary ? (
        <>
          <section className={`storage-status-banner ${summary.storage.connected ? "connected" : "disconnected"}`}>
            <span className="storage-status-icon">
              {summary.storage.connected ? <CheckCircle2 /> : <AlertTriangle />}
            </span>
            <div>
              <span className="section-number">CONNECTION STATUS</span>
              <h2>
                {summary.storage.connected
                  ? "เชื่อมต่อพื้นที่จัดเก็บแล้ว"
                  : "ไม่สามารถเชื่อมต่อพื้นที่จัดเก็บ"}
              </h2>
              <p>
                {summary.storage.driver.toUpperCase()} • {summary.storage.bucket} •{" "}
                {summary.storage.endpointHost}
              </p>
            </div>
            <strong>{summary.storage.connected ? "ONLINE" : "OFFLINE"}</strong>
          </section>

          <section className="metrics storage-metrics">
            <article>
              <div className="metric-top"><span>พื้นที่ใช้งานจริง</span><HardDrive /></div>
              <strong>{formatBytes(summary.usage.usedBytes)}</strong>
              <p>
                {summary.usage.capacityBytes
                  ? `จาก ${formatBytes(summary.usage.capacityBytes)}`
                  : "Object storage ไม่ได้รายงานโควตา"}
              </p><em>01</em>
            </article>
            <article>
              <div className="metric-top"><span>จำนวนออบเจ็กต์</span><Database /></div>
              <strong>{new Intl.NumberFormat("th-TH").format(summary.usage.objectCount)}</strong>
              <p>รายการที่ลงทะเบียนใน PostgreSQL</p><em>02</em>
            </article>
            <article>
              <div className="metric-top"><span>กำลังอัปโหลด</span><Upload /></div>
              <strong>{summary.usage.activeUploads}</strong>
              <p>เซสชันที่ยังไม่หมดอายุ</p><em>03</em>
            </article>
            <article>
              <div className="metric-top"><span>Storage Driver</span><Cloud /></div>
              <strong>{summary.storage.driver.toUpperCase()}</strong>
              <p>Private bucket • direct multipart</p><em>04</em>
            </article>
          </section>

          <section className="storage-grid">
            <article className="panel">
              <span className="section-number">FILE DISTRIBUTION</span>
              <h2>พื้นที่แยกตามประเภทไฟล์</h2>
              <div className="storage-role-list">
                {summary.byRole.length ? summary.byRole.map(item => {
                  const total = Number(summary.usage.usedBytes);
                  const percent = total ? (Number(item.bytes) / total) * 100 : 0;
                  return (
                    <div key={item.role}>
                      <div>
                        <span>{roleLabels[item.role] || item.role}</span>
                        <b>{formatBytes(item.bytes)} • {item.count} ไฟล์</b>
                      </div>
                      <div className="role-meter"><i style={{ width: `${percent}%` }} /></div>
                    </div>
                  );
                }) : <p className="empty-copy">ยังไม่มีไฟล์ในพื้นที่จัดเก็บ</p>}
              </div>
            </article>
            <article className="panel">
              <span className="section-number">VIDEO RECORDS</span>
              <h2>วิดีโอแยกตามสถานะ</h2>
              <div className="storage-status-list">
                {summary.videosByStatus.length ? summary.videosByStatus.map(item => (
                  <div key={item.status}>
                    <span><i className={`dot-${item.status.toLowerCase()}`} />{item.status}</span>
                    <strong>{item.count}</strong>
                  </div>
                )) : <p className="empty-copy">ยังไม่มีรายการวิดีโอ</p>}
              </div>
            </article>
          </section>

          <section className="panel recent-files-panel">
            <div className="panel-heading">
              <div><span className="section-number">RECENT OBJECTS</span><h2>ไฟล์ที่เพิ่มล่าสุด</h2></div>
            </div>
            {summary.recentFiles.length ? (
              <div className="library-table-wrap">
                <table className="library-table storage-file-table">
                  <thead>
                    <tr>
                      <th>ชื่อไฟล์</th><th>วิดีโอ</th><th>ประเภท</th>
                      <th>MIME</th><th>ขนาด</th><th>วันที่เพิ่ม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recentFiles.map(file => (
                      <tr key={file.id}>
                        <td><span className="file-name-cell"><FileVideo />{file.filename}</span></td>
                        <td>{file.video.title}</td>
                        <td>{roleLabels[file.role] || file.role}</td>
                        <td><code>{file.mimeType}</code></td>
                        <td>{formatBytes(file.sizeBytes)}</td>
                        <td>{formatDate(file.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <HardDrive /><strong>ยังไม่มีไฟล์</strong>
                <p>ไฟล์ที่อัปโหลดสำเร็จจะปรากฏในรายการนี้</p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
