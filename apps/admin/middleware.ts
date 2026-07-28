import { NextRequest, NextResponse } from "next/server";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const protectedPrefixes = ["/dashboard", "/videos", "/upload", "/users", "/domains", "/audit", "/settings"];

function cookieName() {
  const configured = process.env.SESSION_COOKIE_NAME?.trim();
  return process.env.NODE_ENV === "production" ? (configured || "__Host-video_session") : (configured || "video_session");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = protectedPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const token = request.cookies.get(cookieName())?.value;
  if (isProtected && (!token || !TOKEN_PATTERN.test(token))) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(cookieName());
    return response;
  }

  const nonce = crypto.randomUUID().replaceAll("-", "");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "font-src 'self'",
    "upgrade-insecure-requests"
  ].join("; ");
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (isProtected) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
