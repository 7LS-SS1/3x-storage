import "server-only";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  ...(process.env.NODE_ENV === "production" ? {} : {
    datasources: {
      db: { url: process.env.LOCAL_DATABASE_URL || "postgresql://video:video@localhost:5432/video" }
    }
  }),
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
