import { NextRequest, NextResponse } from "next/server";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const protectedPrefixes = [
  "/dashboard",
  "/videos",
  "/upload",
  "/storage",
  "/categories",
  "/users",
  "/domains",
  "/audit",
  "/settings"
];

type StorageEnvironment = Partial<
  Record<
    | "STORAGE_DRIVER"
    | "R2_ACCOUNT_ID"
    | "R2_BUCKET"
    | "R2_S3_ENDPOINT"
    | "S3_BUCKET"
    | "S3_ENDPOINT"
    | "S3_FORCE_PATH_STYLE",
    string
  >
>;

function webOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function embedAncestor(request: NextRequest) {
  const referer = request.headers.get("referer");
  if (!referer) return "'none'";
  const url = webOrigin(referer);
  if (!url) return "'none'";
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    return "'none'";
  }
  return url.origin;
}

export function resolveStorageOrigin(
  environment: StorageEnvironment = process.env as StorageEnvironment
) {
  if (environment.STORAGE_DRIVER === "r2") {
    const accountId = environment.R2_ACCOUNT_ID?.trim();
    const bucket = environment.R2_BUCKET?.trim();
    const endpoint = webOrigin(
      environment.R2_S3_ENDPOINT?.trim() ||
        (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined)
    );
    if (!endpoint || !bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
      return null;
    }
    if (!endpoint.hostname.startsWith(`${bucket}.`)) {
      endpoint.hostname = `${bucket}.${endpoint.hostname}`;
    }
    return endpoint.origin;
  }

  const endpoint = webOrigin(environment.S3_ENDPOINT?.trim());
  const bucket = environment.S3_BUCKET?.trim();
  if (
    endpoint &&
    environment.S3_FORCE_PATH_STYLE === "false" &&
    bucket &&
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) &&
    !endpoint.hostname.startsWith(`${bucket}.`)
  ) {
    endpoint.hostname = `${bucket}.${endpoint.hostname}`;
  }
  return endpoint?.origin || null;
}

function cookieName() {
  const configured = process.env.SESSION_COOKIE_NAME?.trim();
  return process.env.NODE_ENV === "production" ? (configured || "__Host-video_session") : (configured || "video_session");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isEmbed = pathname.startsWith("/embed/");
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
  const storageOrigin = resolveStorageOrigin();
  const storageSource = storageOrigin ? ` ${storageOrigin}` : "";
  const mediaOrigin = webOrigin(process.env.MEDIA_URL)?.origin;
  const mediaSource = mediaOrigin ? ` ${mediaOrigin}` : "";
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${isEmbed ? embedAncestor(request) : "'none'"}`,
    "object-src 'none'",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com",
    `media-src 'self' blob:${storageSource}${mediaSource}`,
    `connect-src 'self'${storageSource}${mediaSource} https://www.googleapis.com https://content.googleapis.com https://picker.googleapis.com`,
    "frame-src 'self' https://docs.google.com https://drive.google.com https://accounts.google.com https://picker.googleapis.com",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' https://apis.google.com 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "font-src 'self'",
    "upgrade-insecure-requests"
  ].join("; ");
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (isProtected) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
  }
  if (isEmbed) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Cross-Origin-Opener-Policy", "unsafe-none");
    response.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  } else {
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    response.headers.set("X-Frame-Options", "DENY");
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
