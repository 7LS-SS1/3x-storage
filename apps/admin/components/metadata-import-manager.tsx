"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { SecureVideoPlayer } from "@video/player";
import styles from "./metadata-import-manager.module.css";

type Field = "title" | "description" | "categoryId" | "imageUrl";
type Values = { title: string; description: string | null; categoryId: string | null; imageUrl: string | null };
type Normalized = { siteUrl?: string; postId?: string; targetVideoId?: string; title?: string; description?: string; imageUrl?: string; categories?: unknown[]; tags?: unknown[]; descriptionOptions?: { source: string; value: string }[]; imageOptions?: { source: string; value: string }[] };
type Row = { id: string; ordinal: number; siteUrl: string | null; postId: string | null; normalizedJson: Normalized; status: string; errorsJson: string[]; warningsJson: string[]; rawJson?: unknown };
type Batch = { id: string; filename: string; createdAt: string; _count?: { rows: number } };
type Plan = { rowId: string; token: string; targetVideoId: string; publicId: string; before: Values; after: Values; fields: Field[]; warnings: string[] };
type Candidate = { id: string; publicId: string; title: string; status: string; originalFilename: string | null; durationSeconds: number | null; evidence: string[]; fileIdentity: string; _count: { files: number }; files: { id: string; filename: string; role: string; sizeBytes: string; mimeType: string; width: number | null; height: number | null }[] };
type Discovery = { candidates: Candidate[]; warnings: string[]; truncated: boolean };
type VideoPreview = { title: string; url: string; mimeType: string; posterUrl: string | null; expiresAt: string };
type Change = { id: string; videoId: string; actorName: string; actorUserId: string; createdAt: string; revertedAt: string | null; revertedById: string | null; fieldsJson: Field[]; beforeJson: Values; afterJson: Values; row: { batchId: string; siteUrl: string; postId: string } };
const labels: Record<Field, string> = { title: "ชื่อวิดีโอ", description: "คำอธิบาย", categoryId: "หมวดหมู่ใน App", imageUrl: "URL รูป metadata" };
const statusLabels: Record<string, string> = { PENDING: "รอตรวจสอบ", INVALID: "ข้อมูลไม่ถูกต้อง", APPLIED: "บันทึกแล้ว", NOOP: "ข้อมูลเดิม ไม่เปลี่ยนซ้ำ", ROLLED_BACK: "ย้อนคืนแล้ว" };
const show = (value: unknown) => value === null || value === undefined ? "(ไม่มีค่า)" : String(value);
const date = (value: string) => new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });

export function MetadataImportManager() {
  const [batches, setBatches] = useState<Batch[]>([]), [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<Row[]>([]), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [editing, setEditing] = useState<Row | null>(null), [mapping, setMapping] = useState<string | null>(null);
  const [lookup, setLookup] = useState(""), [targets, setTargets] = useState<{ id: string; publicId: string; title: string }[]>([]), [target, setTarget] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null), [videoPreview, setVideoPreview] = useState<VideoPreview | null>(null);
  const [values, setValues] = useState<Values>({ title: "", description: "", categoryId: null, imageUrl: "" });
  const [selected, setSelected] = useState<Field[]>(["title", "description"]), [allowEmpty, setAllowEmpty] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]), [confirm, setConfirm] = useState(false);
  const [history, setHistory] = useState<Change[]>([]), [historyPage, setHistoryPage] = useState(1), [historyTotal, setHistoryTotal] = useState(0), [rollbackId, setRollbackId] = useState<string | null>(null);

  async function action(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ"); } finally { setBusy(false); } }
  async function loadBatches() { const r = await apiRequest<{ batches: Batch[] }>("/metadata-import/batches"); setBatches(r.batches); }
  async function loadBatch(id: string, p = 1) {
    const r = await apiRequest<{ batch: Batch; rows: Row[]; total: number; page: number }>(`/metadata-import/batches/${encodeURIComponent(id)}?page=${p}`);
    setBatch(r.batch); setRows(r.rows); setTotal(r.total); setPage(p);
  }
  async function loadHistory(p = 1) { const r = await apiRequest<{ changes: Change[]; total: number }>(`/metadata-import/history?page=${p}`); setHistory(r.changes); setHistoryTotal(r.total); setHistoryPage(p); }
  useEffect(() => { let active = true; Promise.all([loadBatches(), loadHistory(), apiRequest<{ categories: { id: string; name: string; active: boolean }[] }>("/categories").then(r => { if (active) setCategories(r.categories); })]).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);

  async function upload() {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("ไฟล์ต้องไม่เกิน 10 MiB"); return; }
    await action(async () => { const form = new FormData(); form.append("file", file); const r = await apiRequest<{ batch: Batch }>("/metadata-import/batches", { method: "POST", body: form }); setPlans([]); setEditing(null); setConfirm(false); await loadBatches(); await loadBatch(r.batch.id); setNotice("เก็บไฟล์ใน batch แล้ว ยังไม่เปลี่ยนข้อมูลวิดีโอ เลือกตรวจทีละ 1–2 รายการ"); });
  }
  async function openRow(id: string) {
    await action(async () => {
      setDiscovery(null); setVideoPreview(null); setEditing(null);
      const r = await apiRequest<{ row: Row; existingMapping: string | null }>(`/metadata-import/rows/${id}`);
      setEditing(r.row); setMapping(r.existingMapping); setPlans(p => p.filter(x => x.rowId !== id)); setConfirm(false);
      const n = r.row.normalizedJson; setLookup(n.targetVideoId || ""); setTarget(n.targetVideoId || ""); setTargets([]);
      setValues({ title: n.title ?? "", description: n.description ?? "", categoryId: null, imageUrl: n.imageUrl ?? "" });
      setSelected([...(n.title !== undefined ? ["title" as const] : []), ...(n.description !== undefined ? ["description" as const] : [])]); setAllowEmpty(false);
      setDiscovery(await apiRequest<Discovery>(`/metadata-import/rows/${encodeURIComponent(id)}/candidates`));
    });
  }
  async function showVideo(id: string) {
    await action(async () => {
      setVideoPreview(null);
      const response = await apiRequest<{ preview: VideoPreview }>(`/videos/${encodeURIComponent(id)}/admin-preview-token?source=original`, { method: "POST", body: JSON.stringify({}) });
      setVideoPreview(response.preview);
    });
  }
  async function preview() {
    if (!editing) return;
    if (plans.length >= 2) { setError("ตรวจและยืนยันครั้งละไม่เกิน 2 รายการ"); return; }
    await action(async () => {
      const form = new FormData(); form.append("payload", JSON.stringify({ targetVideoId: target, fields: selected, values, allowEmpty }));
      const p = await apiRequest<Plan>(`/metadata-import/rows/${editing.id}/preview`, { method: "POST", body: form });
      setPlans(list => [...list.filter(x => x.rowId !== p.rowId), p]); setEditing(null); setConfirm(false);
    });
  }
  async function apply() {
    if (!confirm || !plans.length) return;
    await action(async () => {
      const r = await apiRequest<{ results: { rowId: string; success: boolean; status?: string; error?: string }[] }>("/metadata-import/apply", { method: "POST", body: JSON.stringify({ confirm: true, items: plans.map(p => ({ rowId: p.rowId, token: p.token })) }) });
      setNotice(r.results.map(x => `${x.rowId}: ${x.success ? statusLabels[x.status!] || x.status : x.error}`).join("\n"));
      const failures = r.results.filter(x => !x.success);
      if (failures.length) setError(failures.map(x => `${x.rowId}: ${x.error}`).join("\n"));
      setPlans([]); setConfirm(false); if (batch) await loadBatch(batch.id, page); await loadHistory();
    });
  }
  const categoryLabel = (id: unknown) => id ? `${categories.find(c => c.id === id)?.name || "หมวดหมู่"} (${id})` : "(ไม่มีหมวดหมู่)";
  function comparison(before: Values, after: Values, changed: Field[]) {
    return <div className={styles.tableScroll}><table className={styles.comparison}><thead><tr><th>ฟิลด์</th><th>ข้อมูลปัจจุบัน / ก่อนแก้</th><th>ข้อมูลหลังแก้</th></tr></thead><tbody>{(Object.keys(labels) as Field[]).map(f => <tr key={f} className={changed.includes(f) ? styles.changed : ""}><th>{labels[f]}{changed.includes(f) && <small>เปลี่ยน</small>}</th><td><pre>{f === "categoryId" ? categoryLabel(before[f]) : show(before[f])}</pre></td><td><pre>{f === "categoryId" ? categoryLabel(after[f]) : show(after[f])}</pre></td></tr>)}</tbody></table></div>;
  }
  return <section className={styles.root}>
    <header><p className={styles.eyebrow}>WORDPRESS → 3X STORAGE</p><h1>นำเข้าและตรวจสอบ Metadata</h1><p>ค้นหาวิดีโอจากต้นทางอัตโนมัติ ตรวจไฟล์ เลือกคู่ และยืนยันครั้งละ 1–2 รายการ</p></header>
    <div className={styles.note}>แก้ได้เฉพาะชื่อ คำอธิบาย หมวดหมู่ที่เลือก และ URL รูป metadata — ไม่เปลี่ยน Video ID, publicId, เจ้าของ, ปกหรือไฟล์ R2, iframe และสิทธิ์เข้าถึงสื่อ</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <pre role="status" className={styles.notice}>{notice}</pre>}
    <section className={styles.card}><h2>1. เลือกไฟล์ต้นทาง</h2><p>JSON เต็มจากปลั๊กอิน RetroTube หรือ CSV UTF-8 • สูงสุด 10 MiB / 500 รายการ • JSON เหมาะสำหรับรักษาเนื้อหาครบถ้วน</p><div className={styles.controls}><input aria-label="ไฟล์ metadata" type="file" accept=".json,.csv" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setError(""); }} /><button disabled={busy || !file} onClick={() => void upload()}>ตรวจไฟล์และสร้าง Batch</button></div>
      <label>เปิด batch เดิม<select aria-label="เลือก batch" disabled={busy} value={batch?.id || ""} onChange={e => { if (e.target.value) void action(async () => { setPlans([]); setEditing(null); setConfirm(false); await loadBatch(e.target.value); }); }}><option value="">เลือก batch</option>{batches.map(b => <option key={b.id} value={b.id}>{b.filename} — {date(b.createdAt)} — {b.id}</option>)}</select></label>
    </section>
    {batch && <section className={styles.card}><h2>2. ตรวจรายการ — {total} รายการ</h2><p>Batch ID: <code>{batch.id}</code></p><div className={styles.tableScroll}><table><thead><tr><th>แถว / Post ID</th><th>เว็บไซต์ / ชื่อ</th><th>ผลตรวจ</th><th>ดำเนินการ</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{r.ordinal} / {r.postId || "—"}</td><td>{r.siteUrl}<br /><strong>{r.normalizedJson.title || "(ไม่มีชื่อ)"}</strong></td><td>{statusLabels[r.status] || r.status}{r.errorsJson.map((e, i) => <p className={styles.error} key={i}>{e}</p>)}</td><td><button disabled={busy} onClick={() => void openRow(r.id)}>{r.status === "PENDING" ? "เลือกคู่ / ตรวจแก้" : "ดูต้นทาง"}</button></td></tr>)}</tbody></table></div><div className={styles.controls}><button disabled={busy || page === 1} onClick={() => void action(() => loadBatch(batch.id, page - 1))}>ก่อนหน้า</button><span>หน้า {page} / {Math.max(1, Math.ceil(total / 25))}</span><button disabled={busy || page * 25 >= total} onClick={() => void action(() => loadBatch(batch.id, page + 1))}>ถัดไป</button></div></section>}
    {editing && <section className={styles.card} aria-label="ตรวจแก้รายการ"><h2>Post ID {editing.postId} — ตรวจต้นทางและเลือกคู่</h2><p>{editing.siteUrl}</p>{editing.warningsJson.map((w, i) => <p className={styles.note} key={i}>{w}</p>)}<details><summary>ข้อมูลต้นทางครบถ้วน (HTML/iframe แสดงเป็นข้อความ)</summary><pre>{JSON.stringify(editing.rawJson, null, 2)}</pre></details>
      <p>หมวดหมู่ต้นทาง: {JSON.stringify(editing.normalizedJson.categories || [])}</p><p>แท็กต้นทาง: {JSON.stringify(editing.normalizedJson.tags || [])}</p>
      {editing.status === "PENDING" && <fieldset disabled={busy}><legend>เลือกข้อมูลที่จะเปลี่ยน</legend>
        <section aria-label="วิดีโอที่ค้นพบอัตโนมัติ">
          <h3>วิดีโอที่ค้นพบอัตโนมัติ</h3>
          <p>เทียบ URL embed กับ publicId และชื่อไฟล์วิดีโอแบบตรงกัน ไม่ใช้ชื่อเรื่องคล้ายกัน ไม่เปิด iframe ต้นทาง</p>
          {!discovery && <p>{busy ? "กำลังค้นหาในแอป…" : "ค้นหาไม่สำเร็จ กรุณาเปิดรายการใหม่ หรือค้นหา ID ด้านล่าง"}</p>}
          {discovery?.warnings.map((w, i) => <p className={styles.note} key={i}>{w}</p>)}
          {discovery && !discovery.candidates.length && <p>ไม่พบวิดีโอที่ตรงกับข้อมูลอ้างอิง กรุณาค้นหา ID ด้านล่าง</p>}
          {discovery?.truncated && <p className={styles.note}>พบมากกว่า 20 รายการ แสดง 20 รายการแรก กรุณาค้นหา ID เพื่อระบุให้ชัดเจน</p>}
          {discovery?.candidates.map(v => <article key={v.id} className={styles.candidate}>
            <h3>{v.title}</h3><p>Video ID: <code>{v.id}</code> • publicId: <code>{v.publicId}</code></p>
            <p>สถานะ: {v.status} • ความยาว: {v.durationSeconds === null ? "ไม่มีข้อมูล" : `${v.durationSeconds} วินาที`}</p>
            <p>ชื่อไฟล์ต้นฉบับที่บันทึกไว้: {v.originalFilename || "ไม่มีข้อมูล"}</p>
            <ul>{v.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
            <p className={styles.note}>{v.fileIdentity}</p>
            <div className={styles.tableScroll}><table><thead><tr><th>ไฟล์ในแอป</th><th>ชนิด / บทบาท</th><th>ขนาด (bytes)</th><th>ความละเอียด</th></tr></thead><tbody>{v.files.map(f => <tr key={f.id}><td>{f.filename}</td><td>{f.mimeType} / {f.role}</td><td>{f.sizeBytes}</td><td>{f.width && f.height ? `${f.width} × ${f.height}` : "ไม่มีข้อมูล"}</td></tr>)}</tbody></table></div>
            {!v.files.length && <p>ไม่มีข้อมูลไฟล์ในฐานข้อมูล</p>}{v._count.files > v.files.length && <p>แสดง {v.files.length} จาก {v._count.files} ไฟล์</p>}
            <button onClick={() => void showVideo(v.id)}>เปิดวิดีโอในแอปเพื่อตรวจสอบ</button>
            <button aria-pressed={target === v.id} onClick={() => { setTarget(v.id); setLookup(v.id); setVideoPreview(null); }}>{target === v.id ? "เลือกวิดีโอนี้แล้ว" : "ยืนยันเลือกวิดีโอนี้เป็นคู่"}</button>
          </article>)}
        </section>
        {mapping && <p>เคยจับคู่กับ <code>{mapping}</code> <button onClick={() => { setTarget(mapping); setLookup(mapping); setVideoPreview(null); }}>ใช้คู่เดิม</button></p>}
        <div className={styles.controls}><label>ค้นหาด้วย Video ID หรือ publicId แบบตรงกัน<input value={lookup} onChange={e => setLookup(e.target.value)} /></label><button onClick={() => void action(async () => { const r = await apiRequest<{ videos: typeof targets }>(`/metadata-import/targets?id=${encodeURIComponent(lookup)}`); setTargets(r.videos); if (!r.videos.length) setNotice("ไม่พบ ID นี้ กรุณาคัดลอกจากคลังวิดีโอ"); })}>ค้นหา ID</button></div>
        {targets.map(v => <button key={v.id} className={styles.target} onClick={() => { setTarget(v.id); setVideoPreview(null); }}>{v.title} — Video ID: {v.id} / publicId: {v.publicId} → เลือกรายการนี้</button>)}
        <label>Video ID ปลายทางที่เลือก<input aria-label="Video ID ปลายทาง" value={target} onChange={e => { setTarget(e.target.value); setVideoPreview(null); }} placeholder="ต้องระบุ Video.id; ไม่ใช้ ID ที่ parse จาก iframe โดยอัตโนมัติ" /></label>
        <button disabled={!target} onClick={() => void showVideo(target)}>เปิดวิดีโอ ID ที่เลือกเพื่อตรวจสอบ</button>
        {videoPreview && <section className={styles.videoPreview} aria-label="ตัวอย่างวิดีโอในแอป"><h3>{videoPreview.title}</h3><p>อ่านไฟล์ด้วยสิทธิ์ผู้ดูแล ลิงก์หมดอายุในประมาณ 5 นาที หากเล่นไม่ได้ให้เปิดใหม่; การเล่นไม่ได้ยังไม่ยืนยันว่าไฟล์เสีย</p><SecureVideoPlayer key={videoPreview.url} source={videoPreview.url} sourceType={videoPreview.mimeType} poster={videoPreview.posterUrl || undefined} title={videoPreview.title} /><button onClick={() => setVideoPreview(null)}>ปิดตัวอย่างวิดีโอ</button></section>}
        {(Object.keys(labels) as Field[]).map(f => <div key={f} className={styles.field}><label className={styles.check}><input type="checkbox" checked={selected.includes(f)} onChange={e => setSelected(list => e.target.checked ? [...list, f] : list.filter(x => x !== f))} />อัปเดต{labels[f]}</label>
          {f === "description" && <><label>เลือกแหล่งคำอธิบาย<select value="" onChange={e => { const source = editing.normalizedJson.descriptionOptions?.[Number(e.target.value)]; if (source) setValues(v => ({ ...v, description: source.value })); }}><option value="">เลือกแหล่งต้นฉบับ หรือแก้ข้อความด้านล่าง</option>{editing.normalizedJson.descriptionOptions?.map((o, i) => <option key={i} value={i}>{o.source} ({o.value.length} ตัวอักษร)</option>)}</select></label><textarea aria-label="คำอธิบายที่จะนำเข้า" rows={5} maxLength={100000} value={values.description || ""} onChange={e => setValues(v => ({ ...v, description: e.target.value }))} /></>}
          {f === "categoryId" && <select aria-label="หมวดหมู่ปลายทาง" value={values.categoryId || ""} onChange={e => setValues(v => ({ ...v, categoryId: e.target.value || null }))}><option value="">ไม่มีหมวดหมู่ / ล้างค่าเมื่ออนุญาตค่าว่าง</option>{categories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          {f === "imageUrl" && <label>เลือก URL รูปจากต้นทาง<select value="" onChange={e => { const source = editing.normalizedJson.imageOptions?.[Number(e.target.value)]; if (source) setValues(v => ({ ...v, imageUrl: source.value })); }}><option value="">เลือก featured image หรือ custom field ที่ต้องการ</option>{editing.normalizedJson.imageOptions?.map((o, i) => <option key={i} value={i}>{o.source}: {o.value}</option>)}</select></label>}
          {(f === "title" || f === "imageUrl") && <input aria-label={labels[f]} maxLength={f === "title" ? 200 : 2048} value={values[f] || ""} onChange={e => setValues(v => ({ ...v, [f]: e.target.value }))} />}
        </div>)}
        <label className={styles.check}><input type="checkbox" checked={allowEmpty} onChange={e => setAllowEmpty(e.target.checked)} />อนุญาตให้ล้างค่าฟิลด์ที่เลือกเมื่อข้อมูลใหม่ว่าง (ยกเว้นชื่อวิดีโอ)</label>
        <button disabled={!target || !selected.length || plans.length >= 2} onClick={() => void preview()}>แสดงข้อมูลก่อน–หลัง (ยังไม่บันทึก)</button>
      </fieldset>}<button disabled={busy} onClick={() => setEditing(null)}>ปิดรายการ</button></section>}
    {!!plans.length && <section className={styles.card}><h2>3. ตรวจและยืนยัน {plans.length} รายการ</h2>{plans.map(p => <article key={p.rowId}><h3>Video ID: {p.targetVideoId}</h3><p>publicId: {p.publicId}</p>{comparison(p.before, p.after, p.fields)}{!p.fields.length && <p>ไม่มีฟิลด์วิดีโอเปลี่ยน — ตรวจคีย์ต้นทางและจัดเก็บหลักฐานเท่านั้น</p>}{p.warnings.map((w, i) => <p className={styles.note} key={i}>{w}</p>)}<button disabled={busy} onClick={() => { setPlans(list => list.filter(x => x.rowId !== p.rowId)); setConfirm(false); }}>นำออกจากรายการยืนยัน</button></article>)}<label className={styles.check}><input disabled={busy} type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />ตรวจ Video ID และข้อมูลก่อน–หลังแล้ว ยืนยันบันทึกเฉพาะรายการข้างต้น</label><button className={styles.primary} disabled={busy || !confirm} onClick={() => void apply()}>บันทึก {plans.length} รายการ</button><p>ตัวอย่างมีอายุ 15 นาที หากข้อมูลถูกแก้ระหว่างนี้ ระบบจะให้ตรวจใหม่</p></section>}
    <section className={styles.card}><h2>ประวัติและย้อนคืน</h2><button disabled={busy} onClick={() => void action(() => loadHistory(historyPage))}>โหลดประวัติใหม่</button>{!history.length && <p>ยังไม่มีการเปลี่ยนแปลง metadata</p>}{history.map(c => <details key={c.id}><summary>{date(c.createdAt)} — {c.actorName} — {c.videoId} — {c.revertedAt ? "ย้อนคืนแล้ว" : "บันทึกแล้ว"}</summary><p>Batch: {c.row.batchId} • {c.row.siteUrl} / Post {c.row.postId}</p><p>Change ID: {c.id} • ผู้ดำเนินการ: {c.actorUserId}</p>{comparison(c.beforeJson, c.afterJson, c.fieldsJson)}{c.revertedAt ? <p>ย้อนคืนเมื่อ {date(c.revertedAt)} โดย {c.revertedById}</p> : rollbackId === c.id ? <div><p>ยืนยันคืนค่าฟิลด์ที่เปลี่ยนกลับเป็นคอลัมน์ก่อนแก้? หากมีงานใหม่ทับอยู่ ระบบจะปฏิเสธ</p><button disabled={busy} onClick={() => void action(async () => { await apiRequest(`/metadata-import/history/${c.id}/rollback`, { method: "POST", body: JSON.stringify({ confirm: true }) }); setRollbackId(null); setPlans([]); setConfirm(false); await loadHistory(historyPage); if (batch) await loadBatch(batch.id, page); setNotice("ย้อนคืนสำเร็จ และบันทึกผู้ดำเนินการ/เวลาแล้ว"); })}>ยืนยันย้อนคืน</button><button disabled={busy} onClick={() => setRollbackId(null)}>ยกเลิก</button></div> : <button disabled={busy} onClick={() => setRollbackId(c.id)}>ตรวจและย้อนคืน</button>}</details>)}<div className={styles.controls}><button disabled={busy || historyPage === 1} onClick={() => void action(() => loadHistory(historyPage - 1))}>ประวัติก่อนหน้า</button><span>{historyPage} / {Math.max(1, Math.ceil(historyTotal / 25))}</span><button disabled={busy || historyPage * 25 >= historyTotal} onClick={() => void action(() => loadHistory(historyPage + 1))}>ประวัติถัดไป</button></div></section>
  </section>;
}
