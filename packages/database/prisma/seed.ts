import { PrismaClient, Role } from "@prisma/client";
import argon2 from "argon2";
const prisma = new PrismaClient();
async function main() {
  const email = process.env.BOOTSTRAP_SYSTEM_EMAIL;
  const password = process.env.BOOTSTRAP_SYSTEM_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error("กำหนด BOOTSTRAP_SYSTEM_EMAIL และรหัสผ่านอย่างน้อย 12 ตัวอักษร");
  await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {},
    create: { email: email.toLowerCase(), name: process.env.BOOTSTRAP_SYSTEM_NAME ?? "ผู้ดูแลระบบ", role: Role.SYSTEM, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) }
  });
}
main().finally(() => prisma.$disconnect());
