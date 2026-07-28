import { NextRequest, NextResponse } from "next/server";
import { assertCsrf } from "@/lib/csrf";
import { assertSameOrigin, privateHeaders } from "@/lib/request-security";
import { clearSessionCookie, revokeSession, verifySessionToken } from "@/lib/session";
import { securityConfig } from "@/lib/security-config";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_ORIGIN", message: "คำขอไม่ถูกต้อง" } }, { status: 403, headers: privateHeaders });
  }
  const token = request.cookies.get(securityConfig.cookieName)?.value || null;
  const session = token ? await verifySessionToken(token, request) : null;
  if (session) {
    try {
      await assertCsrf(request, session.id);
      await revokeSession(token);
      await prisma.auditLog.create({
        data: { actorUserId: session.user.id, action: "LOGOUT", entityType: "Session", entityId: session.id, metadataJson: {}, userAgent: request.headers.get("user-agent")?.slice(0, 512) }
      });
    } catch {
      return NextResponse.json({ error: { code: "INVALID_CSRF", message: "คำขอไม่ถูกต้อง" } }, { status: 403, headers: privateHeaders });
    }
  }
  const response = new NextResponse(null, {
    status: 204,
    headers: { ...privateHeaders, "Clear-Site-Data": "\"cache\", \"storage\"" }
  });
  clearSessionCookie(response);
  return response;
}
