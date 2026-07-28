# สนามคลาวด์ — Video Storage Platform

แพลตฟอร์มภายในองค์กรสำหรับจัดเก็บ ประมวลผล และส่งมอบวิดีโอแบบ private ด้วย Next.js, NestJS, PostgreSQL, Prisma, Redis/BullMQ, Cloudflare R2 และ Cloudflare Worker

## เริ่มต้นใช้งาน

ต้องมี Node.js LTS, pnpm, Docker และ Docker Compose ส่วน FFmpeg/FFprobe ถูกติดตั้งใน image ของ worker สำหรับ production (เครื่องพัฒนาอาจติดตั้งเองเพื่อรัน worker นอก Docker)

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres redis minio minio-init
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

หน้า Admin: `http://localhost:3000` • API: `http://localhost:4000` • Swagger: `http://localhost:4000/docs` • MinIO Console: `http://localhost:9001`

## คำสั่งคุณภาพ

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

ก่อน seed ต้องเปลี่ยน `BOOTSTRAP_SYSTEM_PASSWORD` ให้ยาวอย่างน้อย 12 ตัวอักษร การรัน seed ซ้ำจะไม่สร้างบัญชีซ้ำ

## Cloudflare

ตั้งค่า R2 binding และ Analytics Engine ใน `apps/edge/wrangler.toml` แล้วเพิ่ม secrets:

```bash
cd apps/edge
pnpm wrangler secret put MEDIA_SIGNING_SECRET
pnpm wrangler secret put PLAYER_ORIGIN
pnpm deploy
```

ห้ามเปิด public bucket หรือใช้ `r2.dev` ใน production ดูรายละเอียดในเอกสารภายใต้ `docs/`
