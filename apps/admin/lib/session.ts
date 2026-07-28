import "server-only";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getRequestFingerprint, keyedHash, safeEqualHex, sha256 } from "./request-security";
import { securityConfig } from "./security-config";

export type AuthenticatedSession = {
  id: string;
  user: { id: string; email: string; name: string; role: "SYSTEM" | "ADMIN" | "STAFF" };
  csrfToken?: string;
};

function randomToken() {
  return randomBytes(32).toString("base64url");
}

export async function createSession(request: NextRequest, response: NextResponse, userId: string) {
  const token = randomToken();
  const csrfToken = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + securityConfig.idleTtlSeconds * 1000);
  const absoluteExpiresAt = new Date(now.getTime() + securityConfig.absoluteTtlSeconds * 1000);
  const fingerprint = getRequestFingerprint(request);

  await prisma.$transaction([
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now }
    }),
    prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        csrfHash: keyedHash(csrfToken, securityConfig.csrfSecret),
        expiresAt,
        absoluteExpiresAt,
        userAgentHash: fingerprint.userAgentHash,
        ipHash: fingerprint.ipHash
      }
    })
  ]);

  response.cookies.set(securityConfig.cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: absoluteExpiresAt,
    priority: "high"
  });
  response.cookies.set(securityConfig.csrfCookieName, csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: absoluteExpiresAt,
    priority: "high"
  });
  return csrfToken;
}

export async function readSessionToken(): Promise<string | null> {
  const token = (await cookies()).get(securityConfig.cookieName)?.value;
  return token && securityConfig.tokenPattern.test(token) ? token : null;
}

export async function verifySessionToken(token: string, request?: Pick<NextRequest, "headers">): Promise<AuthenticatedSession | null> {
  if (!securityConfig.tokenPattern.test(token)) return null;
  const now = new Date();
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, name: true, role: true, active: true } } }
  });
  if (!session || session.revokedAt || !session.user.active || session.expiresAt <= now || session.absoluteExpiresAt <= now) return null;

  if (request && session.userAgentHash) {
    const current = getRequestFingerprint(request).userAgentHash;
    if (!current || !safeEqualHex(current, session.userAgentHash)) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } });
      return null;
    }
  }

  if (session.expiresAt.getTime() - now.getTime() < securityConfig.idleTtlSeconds * 500) {
    const nextExpiry = new Date(Math.min(
      session.absoluteExpiresAt.getTime(),
      now.getTime() + securityConfig.idleTtlSeconds * 1000
    ));
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: nextExpiry, lastSeenAt: now }
    });
  }

  return { id: session.id, user: session.user };
}

export async function getCurrentSession(): Promise<AuthenticatedSession | null> {
  const token = await readSessionToken();
  return token ? verifySessionToken(token, { headers: await headers() }) : null;
}

export async function requireSession(): Promise<AuthenticatedSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

export async function revokeSession(token: string | null) {
  if (!token || !securityConfig.tokenPattern.test(token)) return;
  await prisma.session.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(securityConfig.cookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    priority: "high"
  });
  response.cookies.set(securityConfig.csrfCookieName, "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    priority: "high"
  });
}
