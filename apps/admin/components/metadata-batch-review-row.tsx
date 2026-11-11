"use client";

import { useState } from "react";
import { SecureVideoPlayer } from "@video/player";
import { apiRequest } from "@/lib/api-client";
import styles from "./metadata-import-manager.module.css";
import type { CoverResult } from "./metadata-cover-scan";

export type Candidate = { id: string; publicId: string; title: string; evidence: string[]; cover?: { score: number; exact: boolean; thumbnail: string }; fileIdentity?: string; _count?: { files: number }; files?: { id: string; filename: string; sizeBytes: string; mimeType: string; width: number | null; height: number | null }[] };
export type TextField = "title" | "description";
export type BatchReviewRow = {
  id: string; ordinal: number; siteUrl: string | null; postId: string | null; status: string;
  normalizedJson: { title?: string; description?: string; descriptionOptions?: { source: string; value: string }[] };
  errorsJson: string[]; warningsJson: string[];
  discovery: { candidates: Candidate[]; warnings: string[]; truncated: boolean } | null;
  discoveryError: string | null;
};
type Preview = { title: string; url: string; mimeType: string; posterUrl: string | null };
const statuses: Record<string, string> = { PENDING: "รอตรวจและอนุมัติ", INVALID: "ข้อมูลไม่ถูกต้อง", APPLIED: "บันทึกแล้ว", NOOP: "ข้อมูลเดิม ไม่เปลี่ยนซ้ำ", ROLLED_BACK: "ย้อนคืนแล้ว" };

export function MetadataBatchReviewRow({ row, cover, disabled, prepared, onPrepare, onInvalidate }: {
  cover?: CoverResult;
  row: BatchReviewRow; disabled: boolean; prepared: boolean;
  onPrepare: (rowId: string, targetVideoId: string, fields: TextField[]) => Promise<void>;
  onInvalidate: (rowId: string) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [lookup, setLookup] = useState(""), [manual, setManual] = useState<Candidate[]>([]);
  const [target, setTarget] = useState<Candidate | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [played, setPlayed] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [fields, setFields] = useState<TextField[]>(["title", "description"].filter(f => row.normalizedJson[f as TextField]?.trim()) as TextField[]);
  const [raw, setRaw] = useState<unknown>(null);
  const n = row.normalizedJson;
  const candidates = [...new Map([...manual, ...(row.discovery?.candidates || []), ...(cover?.candidates || [])].map(c => [c.id, c])).values()].sort((a, b) => (b.cover?.score || 0) - (a.cover?.score || 0));
  async function action(work: () => Promise<void>) {
    if (busy || disabled) return; setBusy(true); setError("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ"); } finally { setBusy(false); }
  }
  function invalidate() { setConfirmed(false); onInvalidate(row.id); }
  async function play(video: Candidate, original = true) {
    await action(async () => {
      invalidate(); setTarget(video); setPreview(null); setPlayed(false);
      const response = await apiRequest<{ preview: Preview }>(`/videos/${encodeURIComponent(video.id)}/admin-preview-token${original ? "?source=original" : ""}`, { method: "POST", body: JSON.stringify({}) });
      setPreview(response.preview);
    });
  }
  return <article className={styles.reviewRow} aria-label={`ตรวจบทความ ${row.postId}`}>
    <h3>รายการ {row.ordinal} • Post ID {row.postId} — {statuses[cover?.autoStatus || row.status] || row.status}</h3>
    <p>{row.siteUrl}</p>
    <div className={styles.sourceText}>
      <h4>ชื่อเรื่องจากไฟล์</h4><pre>{n.title?.trim() ? n.title : "ไม่มีชื่อเรื่อง — คงค่าเดิมในแอป"}</pre>
      <h4>คำอธิบายจากไฟล์</h4><pre>{n.description?.trim() ? n.description : "ไม่มีคำอธิบาย — คงค่าเดิมในแอป"}</pre>
      {n.description && <small>แหล่งข้อมูล: {n.descriptionOptions?.find(o => o.value === n.description)?.source || "description"}</small>}
    </div>
    {row.errorsJson.map((e, i) => <p className={styles.error} key={i}>{e}</p>)}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {cover?.autoStatus && <p>บันทึกชื่อเรื่อง/คำอธิบายอัตโนมัติจากไฟล์ เพราะรูปปกตรงกันทุก byte — ย้อนคืนได้ในประวัติ</p>}
    {cover?.autoError && <p role="alert" className={styles.error}>ยังไม่ได้บันทึกอัตโนมัติ: {cover.autoError}</p>}
    {row.status === "PENDING" && !cover?.autoStatus && <>
      <h4>รายการวิดีโอที่พบใน 3x-storage ({candidates.length})</h4>
      {cover?.error && <p className={styles.note}>เปรียบเทียบรูปต้นทางไม่ได้: {cover.error}</p>}
      {cover?.source && !cover.candidates.length && <figure className={styles.coverSource}><img src={cover.source} alt="รูปปกต้นทางจากไฟล์นำเข้า" /><figcaption>รูปปกต้นทาง — ยังไม่พบภาพใกล้เคียงในส่วนที่ตรวจแล้ว</figcaption></figure>}
      {row.discoveryError && <p className={styles.error}>{row.discoveryError}</p>}
      {!row.discoveryError && !candidates.length && <p>ไม่พบคู่จากข้อมูลอ้างอิง สามารถค้นหา Video ID หรือ publicId แบบตรงกันด้านล่าง</p>}
      {row.discovery?.warnings.map((w, i) => <p className={styles.note} key={i}>{w}</p>)}
      {row.discovery?.truncated && <p className={styles.note}>แสดง 20 รายการแรก กรุณาค้นหา ID หากยังไม่พบคู่ที่ต้องการ</p>}
      {candidates.map(v => <section className={styles.candidate} key={v.id} aria-label={`วิดีโอ ${v.id}`}>
        <strong>{v.title}</strong><p>Video ID: <code>{v.id}</code> • publicId: <code>{v.publicId}</code></p>
        <ul>{v.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
        {v.cover && cover?.source && <div className={styles.coverPair} aria-label="เปรียบเทียบภาพหน้าปก"><figure><img src={cover.source} alt="รูปปกต้นทางจากไฟล์นำเข้า" /><figcaption>ต้นทาง WordPress</figcaption></figure><figure><img src={v.cover.thumbnail} alt={`รูปปกในแอป ${v.id}`} /><figcaption>รูปปกใน 3x-storage • {v.cover.exact ? "ไฟล์รูปตรงกัน" : `ความคล้าย ${v.cover.score}/100`}</figcaption></figure></div>}
        <details><summary>ข้อมูลไฟล์ในแอป</summary>{v.fileIdentity && <p>{v.fileIdentity}</p>}{v.files?.map(f => <p key={f.id}>{f.filename} • {f.mimeType} • {f.sizeBytes} bytes • {f.width && f.height ? `${f.width} × ${f.height}` : "ไม่ระบุความละเอียด"}</p>)}{(v._count?.files || 0) > (v.files?.length || 0) && <p>แสดง {v.files?.length || 0} จาก {v._count?.files} ไฟล์</p>}</details>
        <button disabled={busy || disabled} onClick={() => void play(v)}>เล่นวิดีโอนี้เพื่อตรวจสอบ</button>
        {target?.id === v.id && <small>กำลังตรวจวิดีโอที่เลือกนี้</small>}
      </section>)}
      <details><summary>ค้นหา Video ID / publicId เอง</summary><label>Video ID หรือ publicId<input value={lookup} disabled={disabled || busy} onChange={e => setLookup(e.target.value)} /></label><button disabled={busy || disabled || !lookup.trim()} onClick={() => void action(async () => {
        const r = await apiRequest<{ videos: { id: string; publicId: string; title: string }[] }>(`/metadata-import/targets?id=${encodeURIComponent(lookup.trim())}`);
        setManual(r.videos.map(v => ({ ...v, evidence: ["ค้นพบจาก ID ที่ระบุแบบตรงกัน"] })));
        if (!r.videos.length) setError("ไม่พบ Video ID / publicId นี้");
      })}>ค้นหา ID</button></details>
      {target && <section className={styles.videoPreview} aria-label="ตรวจเนื้อหาวิดีโอ">
        <h4>ตรวจวิดีโอ: {target.title}</h4><p>Video ID: <code>{target.id}</code></p>
        {preview && <SecureVideoPlayer key={preview.url} source={preview.url} sourceType={preview.mimeType} poster={preview.posterUrl || undefined} title={preview.title} onEvent={event => { if (event === "playing") setPlayed(true); if (event === "error") { setPlayed(false); invalidate(); } }} />}
        <p>ลิงก์เล่นมีอายุประมาณ 5 นาที หากเล่นไม่ได้ให้เปิดใหม่หรือใช้ไฟล์สำหรับเล่น</p>
        <button disabled={busy || disabled} onClick={() => void play(target, false)}>เปิดไฟล์สำหรับเล่นแทนต้นฉบับ</button>
      </section>}
      <fieldset disabled={busy || disabled}><legend>อนุมัติข้อมูลจากไฟล์สำหรับวิดีโอที่ตรวจ</legend>
        {(["title", "description"] as const).map(f => <label key={f} className={styles.check}><input type="checkbox" disabled={!n[f]?.trim()} checked={fields.includes(f)} onChange={e => { invalidate(); setFields(list => e.target.checked ? [...list, f] : list.filter(x => x !== f)); }} />อัปเดต{f === "title" ? "ชื่อเรื่อง" : "คำอธิบาย"}จากไฟล์{!n[f]?.trim() && " (ไม่มีข้อมูล — คงค่าเดิม)"}</label>)}
        <label className={styles.check}><input type="checkbox" disabled={!played || !target} checked={confirmed} onChange={e => { onInvalidate(row.id); setConfirmed(e.target.checked); }} />ฉันเล่นตรวจแล้ว และยืนยันว่าเนื้อหาตรงกับบทความนี้</label>
        {!played && <small>เปิดเล่นวิดีโอที่ต้องการก่อนยืนยันเนื้อหา</small>}
        <button disabled={!confirmed || !target || !fields.length || prepared} onClick={() => { if (target) void onPrepare(row.id, target.id, fields); }}>{prepared ? "รออนุมัติในรายการด้านล่าง" : "ตรวจชื่อเรื่อง/คำอธิบายก่อนอนุมัติ"}</button>
      </fieldset>
    </>}
    <details><summary>ข้อจำกัดและข้อมูลต้นทาง</summary>{row.warningsJson.map((w, i) => <p key={i}>{w}</p>)}<button disabled={busy || disabled} onClick={() => void action(async () => { const r = await apiRequest<{ row: { rawJson: unknown } }>(`/metadata-import/rows/${row.id}`); setRaw(r.row.rawJson); })}>ดูข้อมูลต้นทางครบถ้วน</button>{raw !== null && <pre>{JSON.stringify(raw, null, 2)}</pre>}</details>
  </article>;
}
