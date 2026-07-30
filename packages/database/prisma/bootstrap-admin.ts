import "./load-project-env";
import { PrismaClient, Role } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

function readInput() {
  const email = process.env.BOOTSTRAP_SYSTEM_EMAIL?.trim().toLowerCase() || "";
  const name = process.env.BOOTSTRAP_SYSTEM_NAME?.trim() || "";
  const password = process.env.BOOTSTRAP_SYSTEM_PASSWORD || "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("อีเมลไม่ถูกต้อง");
  }
  if (!name || name.length > 120) {
    throw new Error("ชื่อต้องมีความยาว 1–120 ตัวอักษร");
  }
  if (password.length < 8 || password.length > 1024) {
    throw new Error("รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร");
  }
  if (/^(password|123456|12345678|123456789|qwerty|admin)/i.test(password)) {
    throw new Error("รหัสผ่านนี้คาดเดาง่ายเกินไป");
  }
  return { email, name, password };
}

async function main() {
  const input = readInput();
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1
  });
  const now = new Date();

  const user = await prisma.$transaction(async transaction => {
    const account = await transaction.user.upsert({
      where: { email: input.email },
      create: {
        email: input.email,
        name: input.name,
        passwordHash,
        role: Role.SYSTEM,
        active: true
      },
      update: {
        name: input.name,
        passwordHash,
        role: Role.SYSTEM,
        active: true,
        failedLoginCount: 0,
        lockedUntil: null
      }
    });
    await transaction.session.updateMany({
      where: { userId: account.id, revokedAt: null },
      data: { revokedAt: now }
    });
    await transaction.auditLog.create({
      data: {
        action: "SYSTEM_ACCOUNT_BOOTSTRAPPED",
        entityType: "User",
        entityId: account.id,
        metadataJson: { sessionsRevoked: true }
      }
    });
    return account;
  });

  console.log(`ตั้งค่า SYSTEM admin สำเร็จ: ${user.email}`);
  console.log("Session เดิมของบัญชีนี้ถูกยกเลิกทั้งหมดแล้ว");
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : "ไม่สามารถตั้งค่า SYSTEM admin ได้");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
