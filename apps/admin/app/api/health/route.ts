import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff"
};

function configurationReady() {
  const required = [
    "ADMIN_URL",
    "DATABASE_URL",
    "SESSION_SECRET",
    "CSRF_SECRET",
    "IP_HASH_SALT"
  ] as const;
  for (const name of required) {
    const value = process.env[name]?.trim();
    if (!value || value.startsWith("replace-with")) return false;
    if (
      ["SESSION_SECRET", "CSRF_SECRET", "IP_HASH_SALT"].includes(name) &&
      value.length < 32
    ) {
      return false;
    }
  }
  try {
    const adminUrl = new URL(process.env.ADMIN_URL!);
    if (
      process.env.NODE_ENV === "production" &&
      adminUrl.protocol !== "https:"
    ) {
      return false;
    }
  } catch {
    return false;
  }
  const cookieName = process.env.SESSION_COOKIE_NAME?.trim();
  if (
    process.env.NODE_ENV === "production" &&
    cookieName &&
    !cookieName.startsWith("__Host-")
  ) {
    return false;
  }
  return true;
}

export async function GET() {
  if (!configurationReady()) {
    return NextResponse.json(
      { status: "not-ready", services: { configuration: false, database: false } },
      { status: 503, headers: privateHeaders }
    );
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ready", services: { configuration: true, database: true } },
      { headers: privateHeaders }
    );
  } catch {
    return NextResponse.json(
      { status: "not-ready", services: { configuration: true, database: false } },
      { status: 503, headers: privateHeaders }
    );
  }
}
