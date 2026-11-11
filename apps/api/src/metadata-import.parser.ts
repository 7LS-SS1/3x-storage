import { createHash } from "node:crypto";

export type NormalizedMetadata = {
  siteUrl: string; postId: string; targetVideoId?: string;
  title?: string; description?: string; imageUrl?: string;
  categories: unknown[]; tags: unknown[];
  descriptionOptions: { source: string; value: string }[];
  imageOptions: { source: string; value: string }[];
};
export type ParsedMetadataRow = {
  ordinal: number; raw: unknown; normalized: Partial<NormalizedMetadata>;
  errors: string[]; warnings: string[];
};
export const MAX_METADATA_BYTES = 10 * 1024 * 1024;
export const MAX_METADATA_ROWS = 500;

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const metadataHash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");

export function canonicalSite(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("site_url ต้องเป็น URL ของเว็บไซต์");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("site_url ต้องเป็น HTTP(S) ไม่มีรหัสผ่าน query หรือ fragment");
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  if (Buffer.byteLength(normalized, "utf8") > 2048) throw new Error("site_url ยาวเกินขอบเขตคีย์ต้นทาง");
  return normalized;
}

// Strict RFC4180 parser: arrays in CSV cells must be JSON, never comma-split heuristics.
export function parseMetadataCsv(text: string): Record<string, unknown>[] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ""; closed = false; };
  const finishRow = () => { finishCell(); rows.push(row); row = []; if (rows.length > MAX_METADATA_ROWS + 1) throw new Error("นำเข้าได้ไม่เกิน 500 รายการต่อไฟล์"); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === ',') finishCell();
    else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; finishRow(); }
    else if (c === '"' && cell === "" && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error("CSV มี quote ไม่ถูกต้อง"); cell += c; }
  }
  if (quoted) throw new Error("CSV มี quote ที่ยังไม่ปิด");
  if (cell !== "" || row.length || closed) finishRow();
  const headers = rows.shift()?.map(h => h.trim()) || [];
  if (!headers.length || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error("CSV ต้องมีชื่อคอลัมน์ที่ไม่ว่างและไม่ซ้ำ");
  return rows.map((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`CSV แถว ${i + 2} มีจำนวนคอลัมน์ไม่ตรงหัวตาราง`);
    return Object.fromEntries(headers.map((h, j) => [h, cells[j]]));
  });
}

function normalize(raw: unknown, siteFallback?: unknown): ParsedMetadataRow {
  const result: ParsedMetadataRow = { ordinal: 0, raw, normalized: {}, errors: [], warnings: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { result.errors.push("รายการต้องเป็น object"); return result; }
  const r = raw as Record<string, unknown>, n = result.normalized;
  try { n.siteUrl = canonicalSite(r.site_url ?? siteFallback); } catch { result.errors.push("site_url ไม่ถูกต้อง (ต้องเป็น URL HTTP(S) ไม่มี query/credentials)"); }
  if ((typeof r.post_id !== "number" && typeof r.post_id !== "string") || !/^[1-9]\d*$/.test(String(r.post_id)) || !Number.isSafeInteger(Number(r.post_id))) result.errors.push("post_id ต้องเป็นจำนวนเต็มบวกที่ถูกต้อง");
  else n.postId = String(r.post_id);
  for (const [source, target, max] of [["title", "title", 200], ["description", "description", 100000], ["target_video_id", "targetVideoId", 128]] as const) {
    if (r[source] !== undefined && r[source] !== null) {
      if (typeof r[source] !== "string" || r[source].length > max) result.errors.push(`${source} ต้องเป็นข้อความไม่เกิน ${max} ตัวอักษร`);
      else if (source !== "target_video_id" || r[source].trim()) n[target] = r[source];
    }
  }
  const image = r.image_url ?? r.featured_image_url;
  n.imageOptions = [];
  for (const key of ["image_url", "featured_image_url", "original_image_url"]) if (typeof r[key] === "string" && r[key]) n.imageOptions.push({ source: key, value: r[key] });
  if (Array.isArray(r.custom_thumbnail_urls)) for (const item of r.custom_thumbnail_urls) {
    if (!item || typeof item.source_field !== "string") continue;
    for (const value of Array.isArray(item.value) ? item.value : [item.value]) if (typeof value === "string" && value) n.imageOptions.push({ source: item.source_field, value });
  }
  if (image !== undefined && image !== null) {
    if (typeof image !== "string" || image.length > 2048) result.errors.push("image_url ไม่ถูกต้อง");
    else {
      n.imageUrl = image;
      try { if (image.trim()) { const url = new URL(image); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error(); } }
      catch { result.errors.push("image_url ต้องเป็น URL HTTP(S) ไม่มี credentials"); }
    }
  }
  for (const key of ["categories", "tags"] as const) {
    let value = r[key] ?? r[`${key}[]`];
    if (typeof value === "string") { try { value = value.trim() ? JSON.parse(value) : []; } catch { result.errors.push(`${key} ใน CSV ต้องเป็น JSON array`); value = []; } }
    if (value !== undefined && !Array.isArray(value)) result.errors.push(`${key} ต้องเป็น array`);
    n[key] = Array.isArray(value) ? value : [];
    if (n[key]!.some(term => typeof term !== "string" && !(term && typeof term === "object" && !Array.isArray(term) && typeof (term as Record<string, unknown>).name === "string"))) result.errors.push(`${key} ต้องมีชื่อข้อความหรือ term object ที่มี name`);
  }
  if (r.taxonomies && typeof r.taxonomies === "object" && !Array.isArray(r.taxonomies)) {
    const tax = r.taxonomies as Record<string, unknown>;
    if (r.categories === undefined && Array.isArray(tax.category)) n.categories = tax.category;
    if (r.tags === undefined && Array.isArray(tax.post_tag)) n.tags = tax.post_tag;
  }
  n.descriptionOptions = [];
  for (const key of ["description", "excerpt_raw", "content_raw"]) {
    if (typeof r[key] === "string") n.descriptionOptions.push({ source: key, value: r[key] });
  }
  if (Array.isArray(r.description_sources)) {
    for (const item of r.description_sources) if (item && typeof item.source_field === "string" && typeof item.value === "string") n.descriptionOptions.push({ source: item.source_field, value: item.value });
  }
  if (n.description === undefined) {
    const preferred = n.descriptionOptions.find(o => o.source === "excerpt_raw") ?? n.descriptionOptions.find(o => o.source === "content_raw");
    if (preferred && preferred.value.length <= 100000) { n.description = preferred.value; result.warnings.push(`คำอธิบายเริ่มต้นอ่านจาก ${preferred.source}; ตรวจหรือเลือกแหล่งอื่นก่อนบันทึก`); }
    else if (preferred) result.warnings.push("คำอธิบายต้นทางยาวเกินขอบเขตการแก้ไข เก็บต้นฉบับไว้ครบแต่ต้องเลือกข้อความก่อนบันทึก");
  }
  result.warnings.push("App รองรับหมวดหมู่เดียว: เลือกหมวดหมู่ปลายทางเอง; หลายหมวดหมู่ แท็ก และ taxonomy อื่นเก็บครบในข้อมูลต้นทาง ไม่สร้างอัตโนมัติ");
  result.warnings.push("image_url เก็บเป็น metadata เท่านั้น ไม่เปลี่ยนปก R2, storage key หรือ iframe");
  if (!n.targetVideoId) result.warnings.push("ยังไม่ระบุ target_video_id: ต้องเลือก Video ID เอง ไม่มีการจับคู่จากชื่อหรือ parsed_embed_id");
  return result;
}

export function parseMetadataFile(buffer: Buffer, filename: string) {
  if (buffer.length > MAX_METADATA_BYTES) throw new Error("ไฟล์ต้องไม่เกิน 10 MiB");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  let records: unknown[], header: Record<string, unknown> = {}, format: string;
  if (/\.csv$/i.test(filename)) { format = "csv"; records = parseMetadataCsv(text); }
  else if (/\.json$/i.test(filename)) {
    format = "json"; const data = JSON.parse(text);
    if (Array.isArray(data)) records = data;
    else if (data && Array.isArray(data.records)) { const { records: list, ...rest } = data; records = list; header = rest; }
    else throw new Error("JSON ต้องเป็น array หรือ object ที่มี records[]");
  } else throw new Error("รองรับเฉพาะไฟล์ .json และ .csv UTF-8");
  if (!records.length || records.length > MAX_METADATA_ROWS) throw new Error("ไฟล์ต้องมี 1–500 รายการ");
  const rows = records.map((r, index) => ({ ...normalize(r, header.site_url), ordinal: index + 1 }));
  const keys = new Map<string, ParsedMetadataRow[]>();
  for (const row of rows) {
    if (!row.normalized.siteUrl || !row.normalized.postId) continue;
    const key = `${row.normalized.siteUrl}\n${row.normalized.postId}`;
    keys.set(key, [...(keys.get(key) ?? []), row]);
  }
  for (const matches of keys.values()) if (matches.length > 1) for (const row of matches) row.errors.push(`site_url + post_id ซ้ำในไฟล์ที่แถว ${matches.map(r => r.ordinal).join(", ")}; ไม่เลือกทับให้โดยอัตโนมัติ`);
  return { format, header, rows };
}
