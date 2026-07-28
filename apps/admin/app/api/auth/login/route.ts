import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertSameOrigin, getRequestFingerprint, keyedHash, privateHeaders } from "@/lib/request-security";
import { createSession } from "@/lib/session";
import { securityConfig } from "@/lib/security-config";

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(1).max(1024)
});
const dummyHash = argon2.hash(randomBytes(32), { type: argon2.argon2id });
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const RATE_WINDOW_MINUTES = 15;

function unauthorized() {
  return NextResponse.json(
    { error: { code: "INVALID_CREDENTIALS", message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" } },
    { status: 401, headers: privateHeaders }
  );
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_ORIGIN", message: "คำขอไม่ถูกต้อง" } }, { status: 403, headers: privateHeaders });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return unauthorized();

  const fingerprint = getRequestFingerprint(request);
  const rateKey = keyedHash(`${parsed.data.email}|${fingerprint.ipHash || "no-trusted-ip"}`, securityConfig.sessionSecret);
  const rateLimit = await prisma.authRateLimit.findUnique({ where: { key: rateKey } });
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) || null;
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const passwordHash = user?.passwordHash || await dummyHash;
  const passwordValid = await argon2.verify(passwordHash, parsed.data.password).catch(() => false);
  const now = new Date();
  const locked = Boolean(
    (user?.lockedUntil && user.lockedUntil > now) ||
    (rateLimit?.blockedUntil && rateLimit.blockedUntil > now)
  );

  if (!user || !user.active || locked || !passwordValid) {
    if (user && !locked) {
      const failedLoginCount = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lockedUntil: failedLoginCount >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null
        }
      });
    }
    const inCurrentWindow = Boolean(rateLimit && now.getTime() - rateLimit.windowStartedAt.getTime() < RATE_WINDOW_MINUTES * 60_000);
    const failures = inCurrentWindow ? (rateLimit?.failures || 0) + 1 : 1;
    await prisma.authRateLimit.upsert({
      where: { key: rateKey },
      update: {
        failures,
        windowStartedAt: inCurrentWindow ? rateLimit!.windowStartedAt : now,
        blockedUntil: failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null
      },
      create: {
        key: rateKey,
        failures,
        windowStartedAt: now,
        blockedUntil: failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null
      }
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: user?.id,
        action: "LOGIN_FAILURE",
        entityType: "User",
        entityId: user?.id,
        metadataJson: { reason: locked ? "LOCKED" : "INVALID_CREDENTIALS" },
        ipHash: fingerprint.ipHash,
        userAgent
      }
    });
    return unauthorized();
  }

  const response = NextResponse.json(
    { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    { headers: privateHeaders }
  );
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }
    }),
    prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "LOGIN_SUCCESS",
        entityType: "User",
        entityId: user.id,
        metadataJson: {},
        ipHash: fingerprint.ipHash,
        userAgent
      }
    }),
    prisma.authRateLimit.deleteMany({ where: { key: rateKey } })
  ]);
  await createSession(request, response, user.id);
  return response;
}
