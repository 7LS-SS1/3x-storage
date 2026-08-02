"use client";

type ApiErrorPayload = {
  error?: { message?: string } | string;
  message?: string | string[];
};

function cookieValue(name: string) {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

export function csrfToken() {
  return (
    cookieValue("__Host-video_csrf") ||
    cookieValue("video_csrf")
  );
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (!token) throw new Error("ไม่พบโทเค็นความปลอดภัย กรุณาเข้าสู่ระบบใหม่");
    headers.set("X-CSRF-Token", token);
  }

  const response = await fetch(`/backend${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & ApiErrorPayload)
    | null;
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.assign("/login");
    }
    const apiError = payload?.error;
    const message = typeof apiError === "object"
      ? apiError?.message
      : typeof apiError === "string"
        ? apiError
        : Array.isArray(payload?.message)
          ? payload.message.join(", ")
          : payload?.message;
    throw new Error(message || "ไม่สามารถดำเนินการได้ กรุณาลองใหม่");
  }
  if (!payload) throw new Error("เซิร์ฟเวอร์ส่งข้อมูลกลับมาไม่ถูกต้อง");
  return payload;
}
