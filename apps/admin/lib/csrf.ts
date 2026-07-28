import "server-only";
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { assertSameOrigin, keyedHash, safeEqualHex } from "./request-security";
import { securityConfig } from "./security-config";

export async function assertCsrf(request: NextRequest, sessionId: string): Promise<void> {
  assertSameOrigin(request);
  const headerToken = request.headers.get("x-csrf-token");
  const cookieToken = request.cookies.get(securityConfig.csrfCookieName)?.value;
  if (!headerToken || !cookieToken || !securityConfig.tokenPattern.test(headerToken) || headerToken !== cookieToken) {
    throw new Error("INVALID_CSRF");
  }
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { csrfHash: true }
  });
  if (!session || !safeEqualHex(keyedHash(headerToken, securityConfig.csrfSecret), session.csrfHash)) {
    throw new Error("INVALID_CSRF");
  }
}
