"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { MetadataBatchReviewRow, type BatchReviewRow, type TextField } from "./metadata-batch-review-row";
import styles from "./metadata-import-manager.module.css";
import { useMetadataCoverScan } from "./metadata-cover-scan";

type Field = "title" | "description" | "categoryId" | "imageUrl";
type Values = { title: string; description: string | null; categoryId: string | null; imageUrl: string | null };
type Batch = { id: string; filename: string; createdAt: string; _count?: { rows: number } };
type Plan = { rowId: string; token: string; targetVideoId: string; publicId: string; before: Values; after: Values; fields: Field[]; warnings: string[]; contentReviewedAt?: string };
type Change = { id: string; videoId: string; actorName: string; actorUserId: string; createdAt: string; revertedAt: string | null; revertedById: string | null; fieldsJson: Field[]; beforeJson: Values; afterJson: Values; row: { batchId: string; siteUrl: string; postId: string } };
const labels: Record<Field, string> = { title: "ชื่อเรื่อง", description: "คำอธิบาย", categoryId: "หมวดหมู่ใน App", imageUrl: "URL รูป metadata" };
const statusLabels: Record<string, string> = { APPLIED: "บันทึกแล้ว", NOOP: "ข้อมูลเดิม ไม่เปลี่ยนซ้ำ" };
const show = (value: unknown) => value === null || value === undefined ? "(ไม่มีค่า)" : String(value);
const date = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });

export function MetadataImportManager() {
  const [batches, setBatches] = useState<Batch[]>([]), [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<BatchReviewRow[]>([]), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]), [confirm, setConfirm] = useState(false);
  const [history, setHistory] = useState<Change[]>([]), [historyPage, setHistoryPage] = useState(1), [historyTotal, setHistoryTotal] = useState(0), [rollbackId, setRollbackId] = useState<string | null>(null);
  const coverScan = useMetadataCoverScan(batch?.id, page, rows.filter(r => r.status === "PENDING").map(r => r.id).join(","));
  async function action(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ"); } finally { setBusy(false); } }
  async function loadBatches() { const r = await apiRequest<{ batches: Batch[] }>("/metadata-import/batches"); setBatches(r.batches); }
  async function loadBatch(id: string, p = 1) {
    setRows([]);
    const r = await apiRequest<{ batch: Batch; rows: BatchReviewRow[]; total: number; page: number }>(`/metadata-import/batches/${encodeURIComponent(id)}/review?page=${p}`);
    setBatch(r.batch); setRows(r.rows); setTotal(r.total); setPage(p);
  }
  async function loadHistory(p = 1) { const r = await apiRequest<{ changes: Change[]; total: number }>(`/metadata-import/history?page=${p}`); setHistory(r.changes); setHistoryTotal(r.total); setHistoryPage(p); }
  useEffect(() => { Promise.all([loadBatches(), loadHistory()]).catch(e => setError(e.message)); }, []);
  function invalidate(rowId: string) { setPlans(list => list.filter(p => p.rowId !== rowId)); setConfirm(false); }
  async function upload() {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("ไฟล์ต้องไม่เกิน 10 MiB"); return; }
    await action(async () => {
      const form = new FormData(); form.append("file", file);
      const r = await apiRequest<{ batch: Batch }>("/metadata-import/batches", { method: "POST", body: form });
      setPlans([]); setConfirm(false); setBatch(r.batch); setTotal(r.batch._count?.rows || 0);
      await loadBatches(); await loadBatch(r.batch.id);
      setNotice("กำลังตรวจรูปปก เมื่อพบรูปตรงกันทุก byte ระบบจะอัปเดตชื่อเรื่อง/คำอธิบายอัตโนมัติทันทีที่พบคู่");
    });
  }
  async function prepare(rowId: string, targetVideoId: string, fields: TextField[]) {
    if (plans.length >= 2 && !plans.some(p => p.rowId === rowId)) { setError("ตรวจและอนุมัติครั้งละไม่เกิน 2 รายการ"); return; }
    await action(async () => {
      const p = await apiRequest<Plan>(`/metadata-import/rows/${encodeURIComponent(rowId)}/review-preview`, { method: "POST", body: JSON.stringify({ targetVideoId, contentConfirmed: true, fields }) });
      setPlans(list => [...list.filter(x => x.rowId !== p.rowId), p]); setConfirm(false);
      setNotice("เพิ่มรายการก่อน–หลังไว้ด้านล่างแล้ว ยังไม่บันทึกจนกว่าจะกดอนุมัติ");
      requestAnimationFrame(() => document.querySelector('[aria-label="อนุมัติข้อมูล"]')?.scrollIntoView({ block: "start" }));
    });
  }
  async function apply() {
    if (!confirm || !plans.length) return;
    await action(async () => {
      const r = await apiRequest<{ results: { rowId: string; success: boolean; status?: string; error?: string }[] }>("/metadata-import/apply", { method: "POST", body: JSON.stringify({ confirm: true, items: plans.map(p => ({ rowId: p.rowId, token: p.token })) }) });
      setNotice(r.results.map(x => `${x.rowId}: ${x.success ? statusLabels[x.status!] || x.status : x.error}`).join("\n"));
      const failures = r.results.filter(x => !x.success); if (failures.length) setError(failures.map(x => `${x.rowId}: ${x.error}`).join("\n"));
      setPlans([]); setConfirm(false); if (batch) await loadBatch(batch.id, page); await loadHistory();
    });
  }
  function comparison(before: Values, after: Values, changed: Field[], onlyText = false) {
    const displayed: Field[] = onlyText ? ["title", "description"] : ["title", "description", "categoryId", "imageUrl"];
    return <div className={styles.tableScroll}><table className={styles.comparison}><thead><tr><th>ฟิลด์</th><th>ข้อมูลปัจจุบัน / ก่อนแก้</th><th>ข้อมูลจากไฟล์ / หลังแก้</th></tr></thead><tbody>{displayed.map(f => <tr key={f} className={changed.includes(f) ? styles.changed : ""}><th>{labels[f]}{changed.includes(f) && <small>เปลี่ยน</small>}</th><td><pre>{show(before[f])}</pre></td><td><pre>{show(after[f])}</pre></td></tr>)}</tbody></table></div>;
  }
  return <section className={styles.root}>
    <header><p className={styles.eyebrow}>WORDPRESS → 3X STORAGE</p><h1>นำเข้าและตรวจสอบ Metadata</h1><p>อัปโหลด batch → ตรวจรูปทั้ง batch ต่อเนื่อง → รูปตรงกันทุก byte: บันทึกชื่อเรื่อง/คำอธิบายอัตโนมัติ</p></header>
    <div className={styles.note}>ระบบอัปเดตชื่อเรื่องและคำอธิบายอัตโนมัติสำหรับรูปปกที่ตรงกันทุก byte ที่ตรวจพบ รายการอื่นยังต้องตรวจและอนุมัติ ค่าว่างคงข้อมูลเดิม ไม่มีการเปลี่ยน Video ID, เจ้าของ, ไฟล์ R2, iframe หรือสิทธิ์สื่อ</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <pre role="status" className={styles.notice}>{notice}</pre>}
    <section className={styles.card}><h2>1. อัปโหลด Batch</h2><p>JSON/CSV UTF-8 สูงสุด 10 MiB / 500 รายการ แนะนำ JSON เพื่อให้ได้คำอธิบายครบถ้วน</p><div className={styles.controls}><input aria-label="ไฟล์ metadata" type="file" accept=".json,.csv" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setError(""); }} /><button disabled={busy || !file} onClick={() => void upload()}>อัปโหลดและค้นหาคู่</button></div>
      <label>เปิด batch เดิม<select aria-label="เลือก batch" disabled={busy} value={batch?.id || ""} onChange={e => { if (e.target.value) void action(async () => { setPlans([]); setConfirm(false); await loadBatch(e.target.value); }); }}><option value="">เลือก batch</option>{batches.map(b => <option key={b.id} value={b.id}>{b.filename} — {date(b.createdAt)} — {b.id}</option>)}</select></label>
    </section>
    {batch && <section className={styles.card} aria-label="รายการตรวจสอบ batch"><h2>2. ผลการจับคู่และอัปเดตข้อมูล</h2><p>Batch ID: <code>{batch.id}</code> • ทั้งหมด {total} บทความ</p><p>ตรวจทั้ง batch ต่อเนื่องในรอบเดียว และบันทึกทันทีที่พบรูปตรงกัน การเปลี่ยนหน้ามีไว้ดูผลเท่านั้น ไม่เริ่มตรวจใหม่</p>
      {busy && !rows.length && <p role="status">กำลังค้นหาวิดีโอในแอปสำหรับหน้านี้…</p>}
      {!!rows.length && <section className={styles.note} aria-label="สถานะเปรียบเทียบรูป"><strong>ค้นหาจากภาพหน้าปกจริง</strong><p role="status">{coverScan.state.running ? "กำลังเทียบภาพ" : coverScan.state.done ? "เทียบภาพเสร็จแล้ว" : "การเทียบภาพยังไม่ครบ"} • อ่านรูปต้นทาง {coverScan.state.sourceRead}/{coverScan.state.sourceTotal} • บันทึกแล้ว {coverScan.state.applied} • บันทึกผิดพลาด {coverScan.state.applyFailed} • เว้นไว้ {coverScan.state.done ? Math.max(0, coverScan.state.sourceTotal - coverScan.state.applied - coverScan.state.applyFailed) : "รอสรุป"} • ตรวจ {coverScan.state.scanned}/{coverScan.state.total} วิดีโอ • เทียบได้ {coverScan.state.compared} • ไม่มีปก {coverScan.state.missing} • อ่านปกไม่ได้ {coverScan.state.failed}</p><p>บันทึกเมื่อพบไฟล์รูปปกตรงกันทุก byte เท่านั้น รูปคล้ายแต่คนละไฟล์จะเว้นไว้ รูปต้นทางซ้ำกันหลายบทความใน batch จะไม่ถูกเขียนทับอัตโนมัติ</p>{coverScan.state.error && <p role="alert">{coverScan.state.error}</p>}{coverScan.state.running ? <button onClick={coverScan.stop}>หยุดเทียบรูป</button> : <button onClick={coverScan.restart}>เทียบรูปใหม่</button>}{!!coverScan.state.reasons.length && <details><summary>รายการปกที่อ่านไม่ได้และเหตุผล</summary>{coverScan.state.reasons.map((r, i) => <p key={`${r.videoId}:${i}`}>{r.videoId}: {r.reason}</p>)}</details>}</section>}
      {rows.map(row => <MetadataBatchReviewRow key={row.id + ":" + row.status} row={row} cover={coverScan.results[row.id]} disabled={busy || coverScan.state.running} prepared={plans.some(p => p.rowId === row.id)} onPrepare={prepare} onInvalidate={invalidate} />)}
      <div className={styles.controls}><button disabled={busy || page === 1} onClick={() => void action(() => loadBatch(batch.id, page - 1))}>ก่อนหน้า</button><span>หน้า {page} / {Math.max(1, Math.ceil(total / 25))}</span><button disabled={busy || page * 25 >= total} onClick={() => void action(() => loadBatch(batch.id, page + 1))}>ถัดไป</button><button disabled={busy} onClick={() => void action(() => loadBatch(batch.id, page))}>ค้นหาคู่หน้านี้ใหม่</button></div>
    </section>}
    {!!plans.length && <section className={styles.card} aria-label="อนุมัติข้อมูล"><h2>3. อนุมัติชื่อเรื่องและคำอธิบาย {plans.length} รายการ</h2>{plans.map(p => <article key={p.rowId}><h3>Video ID: {p.targetVideoId}</h3><p>publicId: {p.publicId}</p>{p.contentReviewedAt && <p>ยืนยันเนื้อหาตรงกันเมื่อ {date(p.contentReviewedAt)}</p>}{comparison(p.before, p.after, p.fields, true)}{!p.fields.length && <p>ชื่อเรื่องและคำอธิบายตรงกับข้อมูลเดิมแล้ว</p>}<button disabled={busy} onClick={() => invalidate(p.rowId)}>นำออกจากรายการอนุมัติ</button></article>)}<label className={styles.check}><input disabled={busy} type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />ฉันอนุมัติให้ 3x-storage อัปเดตชื่อเรื่อง/คำอธิบายตามข้อมูลก่อน–หลังนี้</label><button className={styles.primary} disabled={busy || !confirm} onClick={() => void apply()}>อนุมัติและบันทึก {plans.length} รายการ</button><p>ตัวอย่างมีอายุ 15 นาที หากข้อมูลเปลี่ยนระหว่างนี้ต้องตรวจใหม่</p></section>}
    <section className={styles.card}><h2>ประวัติและย้อนคืน</h2><button disabled={busy} onClick={() => void action(() => loadHistory(historyPage))}>โหลดประวัติใหม่</button>{!history.length && <p>ยังไม่มีการเปลี่ยนแปลง metadata</p>}{history.map(c => <details key={c.id}><summary>{date(c.createdAt)} — {c.actorName} — {c.videoId} — {c.revertedAt ? "ย้อนคืนแล้ว" : "บันทึกแล้ว"}</summary><p>Batch: {c.row.batchId} • {c.row.siteUrl} / Post {c.row.postId}</p><p>Change ID: {c.id} • ผู้ดำเนินการ: {c.actorUserId}</p>{comparison(c.beforeJson, c.afterJson, c.fieldsJson)}{c.revertedAt ? <p>ย้อนคืนเมื่อ {date(c.revertedAt)} โดย {c.revertedById}</p> : rollbackId === c.id ? <div><p>ยืนยันคืนค่าฟิลด์ที่เปลี่ยนกลับเป็นคอลัมน์ก่อนแก้? หากมีงานใหม่ทับอยู่ ระบบจะปฏิเสธ</p><button disabled={busy} onClick={() => void action(async () => { await apiRequest(`/metadata-import/history/${c.id}/rollback`, { method: "POST", body: JSON.stringify({ confirm: true }) }); setRollbackId(null); setPlans([]); setConfirm(false); await loadHistory(historyPage); if (batch) await loadBatch(batch.id, page); setNotice("ย้อนคืนสำเร็จ และบันทึกผู้ดำเนินการ/เวลาแล้ว"); })}>ยืนยันย้อนคืน</button><button disabled={busy} onClick={() => setRollbackId(null)}>ยกเลิก</button></div> : <button disabled={busy} onClick={() => setRollbackId(c.id)}>ตรวจและย้อนคืน</button>}</details>)}<div className={styles.controls}><button disabled={busy || historyPage === 1} onClick={() => void action(() => loadHistory(historyPage - 1))}>ประวัติก่อนหน้า</button><span>{historyPage} / {Math.max(1, Math.ceil(historyTotal / 25))}</span><button disabled={busy || historyPage * 25 >= historyTotal} onClick={() => void action(() => loadHistory(historyPage + 1))}>ประวัติถัดไป</button></div></section>
  </section>;
}
