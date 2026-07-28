import "server-only";

const BASE64URL_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function requiredSecret(name: "SESSION_SECRET" | "CSRF_SECRET" | "IP_HASH_SALT"): string {
  const value = process.env[name];
  if (!value || value.length < 32 || value.startsWith("replace-with")) {
    throw new Error(`${name} ต้องเป็นค่าสุ่มอย่างน้อย 32 ตัวอักษร`);
  }
  return value;
}

export const securityConfig = {
  get cookieName() {
    const configured = process.env.SESSION_COOKIE_NAME?.trim();
    if (process.env.NODE_ENV === "production") {
      if (configured && !configured.startsWith("__Host-")) {
        throw new Error("SESSION_COOKIE_NAME ใน production ต้องขึ้นต้นด้วย __Host-");
      }
      return configured || "__Host-video_session";
    }
    return configured || "video_session";
  },
  get csrfCookieName() {
    return process.env.NODE_ENV === "production" ? "__Host-video_csrf" : "video_csrf";
  },
  get sessionSecret() { return requiredSecret("SESSION_SECRET"); },
  get csrfSecret() { return requiredSecret("CSRF_SECRET"); },
  get ipHashSalt() { return requiredSecret("IP_HASH_SALT"); },
  idleTtlSeconds: Math.min(Math.max(Number(process.env.SESSION_TTL_SECONDS || 3600), 900), 86_400),
  absoluteTtlSeconds: Math.min(Math.max(Number(process.env.SESSION_ABSOLUTE_TTL_SECONDS || 28_800), 3600), 604_800),
  tokenPattern: BASE64URL_TOKEN
};
