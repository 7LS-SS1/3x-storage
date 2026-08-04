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
async function createSignature(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function validStorageKey(path: string) {
  if (!path || path.length > 1024 || path.includes("\\") || path.includes("//") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split("/").every(segment => segment && segment !== "." && segment !== ".." && /^[A-Za-z0-9._-]+$/.test(segment));
}
function reject(message: string, status: number) {
  return new Response(message, { status, headers: noStoreHeaders });
}

export default {
  async fetch(request: Request, env: Env) {
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

    const servedRange = object.range;
    const contentType = object.httpMetadata?.contentType || "application/octet-stream";
    let responseBody: ReadableStream | string | null = request.method === "HEAD" ? null : object.body;
    let responseBytes = servedRange && "length" in servedRange && typeof servedRange.length === "number" ? servedRange.length : object.size;
    if (request.method === "GET" && !range && contentType === "application/vnd.apple.mpegurl") {
      const directory = path.slice(0, path.lastIndexOf("/") + 1);
      const lines = (await object.text()).split(/\r?\n/);
      const rewritten: string[] = [];
      for (const line of lines) {
        if (!line || line.startsWith("#")) { rewritten.push(line); continue; }
        const segmentPath = `${directory}${line}`;
        if (!validStorageKey(segmentPath)) return reject("HLS manifest ไม่ถูกต้อง", 500);
        const segmentSignature = await createSignature(env.MEDIA_SIGNING_SECRET, [segmentPath, expires, sessionId, videoId, fileId].join("\n"));
        const segmentUrl = new URL(segmentPath.split("/").map(encodeURIComponent).join("/"), `${url.origin}/`);
        segmentUrl.search = new URLSearchParams({ expires: expiresRaw, sessionId, videoId, fileId, signature: segmentSignature }).toString();
        rewritten.push(segmentUrl.toString());
      }
      responseBody = rewritten.join("\n");
      responseBytes = encoder.encode(responseBody).byteLength;
    }
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=300, no-transform",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "cross-origin"
    });
    if (origin === env.PLAYER_ORIGIN) {
      headers.set("Access-Control-Allow-Origin", env.PLAYER_ORIGIN);
      headers.set("Vary", "Origin");
    }
    if (servedRange && "offset" in servedRange && typeof servedRange.offset === "number" && typeof servedRange.length === "number") {
      headers.set("Content-Range", `bytes ${servedRange.offset}-${servedRange.offset + servedRange.length - 1}/${object.size}`);
    }
    const bytes = responseBytes;
    headers.set("Content-Length", String(responseBytes));
    const status = range ? 206 : 200;
    if (env.MEDIA_ANALYTICS) {
      try {
        env.MEDIA_ANALYTICS.writeDataPoint({
          blobs: [videoId, fileId],
          doubles: [status, bytes],
          indexes: [sessionId]
        });
      } catch (error) {
        console.error(JSON.stringify({
          event: "media_analytics_write_failed",
          error: error instanceof Error ? error.message : "UNKNOWN_ERROR"
        }));
      }
    }
    return new Response(responseBody, { status, headers });
  }
} satisfies ExportedHandler<Env>;
