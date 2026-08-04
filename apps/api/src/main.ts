import "reflect-metadata";
import { config as loadEnvironment } from "dotenv";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";

loadEnvironment({ path: resolve(__dirname, "../../../.env"), quiet: true });

async function bootstrap() {
  const required = [
    "ADMIN_URL",
    "PLAYER_URL",
    "DATABASE_URL",
    "REDIS_URL",
    "MEDIA_URL",
    "MEDIA_SIGNING_SECRET",
    "IP_HASH_SALT",
    "SESSION_SECRET",
    "CSRF_SECRET",
    ...(process.env.NODE_ENV === "production" ? ["REDIS_PASSWORD" as const] : [])
  ] as const;
  for (const key of required) {
    const value = process.env[key]?.trim();
    if (
      !value ||
      value.startsWith("replace-with") ||
      ((key.endsWith("SECRET") || key.endsWith("SALT")) && value.length < 32)
    ) {
      throw new Error(`Missing or insecure required environment variable: ${key}`);
    }
  }
  for (const key of ["ADMIN_URL", "PLAYER_URL", "MEDIA_URL"] as const) {
    const url = new URL(process.env[key]!);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error(`${key} must use HTTPS in production`);
    }
  }
  const storageDriver = process.env.STORAGE_DRIVER === "r2" ? "r2" : "s3";
  const storageRequired = storageDriver === "r2"
    ? ["R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const
    : ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
  for (const key of storageRequired) {
    const value = process.env[key];
    if (!value || value.startsWith("replace-with")) {
      throw new Error(`Missing required storage environment variable: ${key}`);
    }
  }
  if (
    storageDriver === "r2" &&
    !process.env.R2_S3_ENDPOINT?.trim() &&
    !process.env.R2_ACCOUNT_ID?.trim()
  ) {
    throw new Error("Missing required storage environment variable: R2_ACCOUNT_ID or R2_S3_ENDPOINT");
  }
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  if (process.env.TRUST_PROXY === "true") {
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  }
  app.use(helmet({
    contentSecurityPolicy: false,
    hsts: process.env.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false
  }));
  const allowedOrigins = new Set([process.env.ADMIN_URL, process.env.PLAYER_URL].map(value => new URL(value!).origin));
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Request-ID"],
    maxAge: 600
  });
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  if (process.env.NODE_ENV !== "production" || process.env.ENABLE_API_DOCS === "true") {
    const docs = new DocumentBuilder().setTitle("Video Storage API").setVersion("1").addCookieAuth("video_session").build();
    SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, docs));
  }
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4000), "0.0.0.0");
}
bootstrap();
