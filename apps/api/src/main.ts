import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const required = ["ADMIN_URL", "PLAYER_URL", "DATABASE_URL", "MEDIA_URL", "MEDIA_SIGNING_SECRET", "IP_HASH_SALT"] as const;
  for (const key of required) {
    const value = process.env[key];
    if (!value || ((key.endsWith("SECRET") || key.endsWith("SALT")) && value.length < 32)) {
      throw new Error(`Missing or insecure required environment variable: ${key}`);
    }
  }
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
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
