import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(process.env.NODE_ENV === "production" ? {} : {
      datasources: {
        db: { url: process.env.LOCAL_DATABASE_URL || "postgresql://video:video@localhost:5432/video" }
      }
    });
  }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
