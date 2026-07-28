import { NextRequest, NextResponse } from "next/server";
import { privateHeaders } from "@/lib/request-security";
import { clearSessionCookie, verifySessionToken } from "@/lib/session";
import { securityConfig } from "@/lib/security-config";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(securityConfig.cookieName)?.value;
  const session = token ? await verifySessionToken(token, request) : null;
  if (!session) {
    const response = NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "กรุณาเข้าสู่ระบบ" } }, { status: 401, headers: privateHeaders });
    clearSessionCookie(response);
    return response;
  }
  return NextResponse.json({ user: session.user }, { headers: privateHeaders });
}
