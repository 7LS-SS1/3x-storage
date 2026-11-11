// These are search hints, never an instruction to select a destination or fetch a URL.
export type MatchReference = { kind: "videoId" | "publicId" | "filename"; value: string; source: string; origin?: string; trustedOrigin?: boolean };
export function metadataReferences(record: unknown, siteUrl: string | null, origins: string[]) {
  const refs: MatchReference[] = [], warnings: string[] = [];
  const trusted = new Set(origins.flatMap(value => { try { return [new URL(value).origin]; } catch { return []; } }));
  const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const raw = obj(record);
  let limited = false;
  function bounded<T>(items: T[], count: number) { if (items.length > count) limited = true; return items.slice(0, count); }
  function add(ref: MatchReference) {
    if (!ref.value || ref.value.length > 255) return;
    if (refs.some(r => r.kind === ref.kind && r.value === ref.value && r.origin === ref.origin)) return;
    if (refs.length >= 64) { limited = true; return; }
    refs.push(ref);
  }
  function url(value: unknown, source: string, embed: boolean) {
    if (typeof value !== "string" || value.length > 4096) return;
    try {
      const u = new URL(value.trim().replace(/&amp;/gi, "&"), siteUrl || undefined);
      if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return;
      if (embed) {
        const match = u.pathname.match(/^\/embed\/([^/]+)\/?$/);
        if (match) add({ kind: "publicId", value: decodeURIComponent(match[1]!), source, origin: u.origin, trustedOrigin: trusted.has(u.origin) });
      } else {
        const name = decodeURIComponent(u.pathname.split("/").pop() || "");
        if (/\.(mp4|m4v|webm|mov|mkv|avi|m3u8)$/i.test(name)) add({ kind: "filename", value: name, source, origin: u.origin });
      }
    } catch { /* Invalid URL/encoding is not evidence. Never follow it. */ }
  }
  if (typeof raw.target_video_id === "string") add({ kind: "videoId", value: raw.target_video_id, source: "target_video_id" });
  if (Array.isArray(raw.iframe_sources)) for (const entry of bounded(raw.iframe_sources, 128)) {
    const item = obj(entry); url(item.src_raw ?? item.src_decoded, "iframe_sources", true);
  }
  if (typeof raw.iframe_src === "string") for (const value of bounded(raw.iframe_src.split(/\r?\n/), 128)) url(value, "iframe_src (CSV)", true);
  // Ignore standalone parsed_embed_id: verify the actual URL rather than trusting exported parse results.
  if (Array.isArray(raw.video_urls)) for (const entry of bounded(raw.video_urls, 128)) {
    const item = obj(entry);
    for (const value of bounded(Array.isArray(item.value) ? item.value : [item.value], 64)) url(value, `video_urls:${String(item.source_field || "unknown").slice(0, 128)}`, false);
  }
  url(raw.video_url, "video_url", false);
  // Exporter's filename/original_filename fields describe an IMAGE, not a video.
  if (typeof raw.video_filename === "string" && /\.(mp4|m4v|webm|mov|mkv|avi|m3u8)$/i.test(raw.video_filename)) add({ kind: "filename", value: raw.video_filename, source: "video_filename" });
  if (limited) warnings.push("ข้อมูลอ้างอิงมีจำนวนมาก ตรวจเฉพาะช่วงแรกและใช้ค้นหาไม่เกิน 64 ค่า กรุณาตรวจต้นทางเพิ่มเติม");
  if (!refs.length) warnings.push("ไม่มี ID จาก URL embed หรือชื่อไฟล์วิดีโอที่ใช้ค้นหาได้ ใช้ผลเทียบรูปปกหรือค้นหา ID ด้วยตนเอง");
  return { references: refs, warnings };
}
