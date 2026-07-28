interface Env { VIDEOS: R2Bucket; MEDIA_SIGNING_SECRET: string; PLAYER_ORIGIN: string; MEDIA_ANALYTICS?: AnalyticsEngineDataset }

const noStoreHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const encoder = new TextEncoder();
function fromHex(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index++) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return output;
}
async function verifySignature(secret: string, value: string, supplied: string) {
  const signature = fromHex(supplied);
  if (!signature || secret.length < 32) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(value));
}
function validStorageKey(path: string) {
  if (!path || path.length > 1024 || path.includes("\\") || path.includes("//") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split("/").every(segment => segment && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment));
}
function reject(message: string, status: number) {
  return new Response(message, { status, headers: noStoreHeaders });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!["GET", "HEAD"].includes(request.method)) return reject("Method Not Allowed", 405);
    if (!env.MEDIA_SIGNING_SECRET || env.MEDIA_SIGNING_SECRET.length < 32 || !env.PLAYER_ORIGIN) return reject("บริการยังไม่พร้อมใช้งาน", 503);
    const origin = request.headers.get("origin");
    if (origin && origin !== env.PLAYER_ORIGIN) return reject("ไม่ได้รับอนุญาต", 403);

    const url = new URL(request.url);
    let path: string;
    try { path = decodeURIComponent(url.pathname.replace(/^\/+/, "")); } catch { return reject("คำขอไม่ถูกต้อง", 400); }
    const expiresRaw = url.searchParams.get("expires") || "";
    const expires = Number(expiresRaw);
    const sessionId = url.searchParams.get("sessionId") || "";
    const videoId = url.searchParams.get("videoId") || "";
    const fileId = url.searchParams.get("fileId") || "";
    const supplied = url.searchParams.get("signature") || "";
    const now = Math.floor(Date.now() / 1000);
    if (
      !validStorageKey(path) ||
      !/^\d{10}$/.test(expiresRaw) ||
      !Number.isSafeInteger(expires) ||
      expires < now ||
      expires > now + 900 ||
      !/^[0-9a-f-]{36}$/i.test(sessionId) ||
      !/^[A-Za-z0-9_-]{10,128}$/.test(videoId) ||
      !/^[A-Za-z0-9_-]{10,128}$/.test(fileId)
    ) return reject("ลิงก์รับชมไม่ถูกต้องหรือหมดอายุ", 403);

    const signedValue = [path, expires, sessionId, videoId, fileId].join("\n");
    if (!(await verifySignature(env.MEDIA_SIGNING_SECRET, signedValue, supplied))) return reject("ไม่ได้รับอนุญาต", 403);

    const range = request.headers.get("range");
    if (range && !/^bytes=\d*-\d*$/.test(range)) return reject("ช่วงข้อมูลไม่ถูกต้อง", 416);
    let object: R2ObjectBody | null;
    try { object = await env.VIDEOS.get(path, range ? { range: request.headers } : undefined); }
    catch { return reject("ช่วงข้อมูลไม่ถูกต้อง", 416); }
    if (!object) return reject("ไม่พบวิดีโอ", 404);

    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=300, no-transform",
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "cross-origin"
    });
    if (origin === env.PLAYER_ORIGIN) {
      headers.set("Access-Control-Allow-Origin", env.PLAYER_ORIGIN);
      headers.set("Vary", "Origin");
    }
    const servedRange = object.range;
    if (servedRange && "offset" in servedRange && typeof servedRange.offset === "number" && typeof servedRange.length === "number") {
      headers.set("Content-Range", `bytes ${servedRange.offset}-${servedRange.offset + servedRange.length - 1}/${object.size}`);
    }
    const bytes = servedRange && "length" in servedRange && typeof servedRange.length === "number" ? servedRange.length : object.size;
    headers.set("Content-Length", String(bytes));
    const status = range ? 206 : 200;
    if (env.MEDIA_ANALYTICS) {
      ctx.waitUntil(Promise.resolve(env.MEDIA_ANALYTICS.writeDataPoint({
        blobs: [videoId, fileId],
        doubles: [status, bytes],
        indexes: [sessionId]
      })));
    }
    return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
  }
} satisfies ExportedHandler<Env>;
