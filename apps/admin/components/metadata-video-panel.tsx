"use client";
import type { useMetadataVideoScan } from "./metadata-video-scan";
import styles from "./metadata-import-manager.module.css";

export function MetadataVideoPanel({ scan, samples, setSamples }: {
  scan: ReturnType<typeof useMetadataVideoScan>; samples: number;
  setSamples: (n: number) => void;
}) {
  const { job, loading, busy, error } = scan;
  const running = job?.status === "RUNNING", disabled = loading || busy;
  const stale = running && Date.now() - new Date(job.lastActivityAt).getTime() > 90_000;
  return <section className={styles.note} aria-label="ตรวจจับด้วยวิดีโอ">
    <h3>ตรวจจับด้วยวิดีโอ</h3>
    <p>ตรวจวิดีโอที่ไม่มีรูปปกเป็นงานเบื้องหลัง ปิดแท็บได้ เปิด batch เดิมเพื่อดูผลหรือทำต่อ ข้อมูลเฟรมที่อ่านแล้วใช้ซ้ำได้ใน batch อื่นเมื่อไฟล์วิดีโอยังเป็นเวอร์ชันเดิม</p>
    <p>คะแนนผ่าน 80/100 จะบันทึกชื่อเรื่อง/คำอธิบายทันที ไม่ต้องเล่นตรวจหรืออนุมัติ ใช้คู่แรกที่ผ่านเกณฑ์ ไม่รอคู่คะแนนสูงสุดทั่วคลัง แล้วหยุดอ่านเฟรมที่เหลือของคลิปนั้น</p>
    <div className={styles.controls}>
      <p>เกณฑ์บันทึกอัตโนมัติ: 80/100 (คะแนนความคล้าย ไม่ใช่ % ความถูกต้อง)</p>
      <label>จำนวนเฟรมต่อวิดีโอสำหรับรอบใหม่<select aria-label="จำนวนเฟรม" value={samples} disabled={disabled || running} onChange={e => setSamples(Number(e.target.value))}>{[12,30,60].map(n => <option key={n} value={n}>{n} เฟรม</option>)}</select></label>
    </div>
    <p>30 เฟรมคือ 30 จุดตลอดคลิป ไม่ใช่ 30 วินาที การลดจำนวนเฟรมอาจพลาดภาพที่อยู่ระหว่างจุดตรวจ</p>
    {loading && <p role="status">กำลังโหลดงานเดิม…</p>}
    {job && <>
      <p role="status">{running ? "กำลังตรวจเบื้องหลัง" : job.status === "PAUSED" ? "พักงานแล้ว" : "จบรอบตรวจแล้ว"} • บันทึกแล้วใน batch {job.applied} • ตัดออกจากคิว {job.skipped} • รูปต้นทาง {job.loaded}/{job.sourceTotal} • วิดีโอ {job.scanned}/{job.total} • เฟรมที่ตรวจ {job.frames} • ใช้เฟรมที่เก็บไว้ {job.cached} • วิดีโอผิดพลาด {job.failed} • รูปต้นทางผิดพลาด {job.sourceFailed}</p>
      <p>รอบนี้ใช้ {job.samples} เฟรม/คลิป และคะแนนขั้นต่ำ {job.threshold}/100 • Job ID: {job.id}</p>
      {job.current.map(video => <p key={video.refId}>{video.refId}: {video.framesDone}/{job.samples} เฟรม</p>)}
    </>}
    {stale && <p role="alert">ยังไม่มีความคืบหน้าใหม่เกิน 90 วินาที ตรวจสถานะบริการ metadata-worker งานและเฟรมที่เสร็จแล้วจะยังอยู่</p>}
    {error && <p role="alert">{error}</p>}
    <div className={styles.controls}>
      {!job && <button disabled={disabled} onClick={() => void scan.start(80, samples)}>เริ่มตรวจจับด้วยวิดีโอ</button>}
      {running && <button disabled={disabled} onClick={() => void scan.control("pause")}>พักงานตรวจวิดีโอ</button>}
      {job?.status === "PAUSED" && <button disabled={disabled} onClick={() => void scan.control("resume")}>ทำต่อจากงานเดิม</button>}
      {job && !running && <button disabled={disabled} onClick={() => void scan.start(80, samples, true)}>เริ่มรอบใหม่ด้วยค่าที่เลือก</button>}
      {job && !running && !!(job.failed + job.sourceFailed) && <button disabled={disabled} onClick={() => void scan.control("retry")}>ลองรายการที่ผิดพลาดอีกครั้ง</button>}
      <button disabled={disabled} onClick={scan.refresh}>โหลดความคืบหน้าใหม่</button>
    </div>
    <p>รายการที่บันทึกแล้วจะไม่ถูกเปรียบเทียบซ้ำ เมื่อจับคู่ครบจะข้ามคิวที่เหลือ เก็บประวัติก่อน–หลังและย้อนคืนได้ เริ่มรอบใหม่ไม่ลบประวัติหรือเฟรมที่เก็บไว้</p>
    {!!job?.failures.length && <details><summary>รายการที่ผิดพลาด (ล่าสุดไม่เกิน 100 รายการ)</summary>{job.failures.map((failure,i) => <p key={i}>{failure.kind === "SOURCE" ? "รูปต้นทาง" : "วิดีโอ"} {failure.refId}: {failure.error}</p>)}</details>}
  </section>;
}
