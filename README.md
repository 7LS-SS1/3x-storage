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

หน้าหลักหลังเข้าสู่ระบบ:

- `/videos` — คลังวิดีโอพร้อม server-side filtering, pagination และ bulk actions
- `/upload` — อัปโหลดหลายไฟล์ตรงเข้า MinIO/R2 แบบ multipart
- `/storage` — พื้นที่ใช้งาน สถานะ bucket และรายการไฟล์ล่าสุด
- `/categories` — เพิ่ม แก้ไข เปิด/ปิด และลบหมวดหมู่วิดีโอ
- `/users` — จัดการผู้ใช้ บทบาท สถานะบัญชี รหัสผ่าน และยกเลิก session
- `/domains` — จัดการ hostname ที่อนุญาตให้ฝังวิดีโอ
- `/audit` — ตรวจสอบบันทึกกิจกรรมและข้อมูลเหตุการณ์ด้านความปลอดภัย
- `/settings` — ตั้งค่าระบบ หมวดหมู่เริ่มต้น และสถานะ runtime (เฉพาะ SYSTEM)

เมนูจัดการแสดงเฉพาะ SYSTEM/ADMIN โดย ADMIN จัดการได้เฉพาะบัญชี STAFF
ส่วน STAFF จะถูกปฏิเสธทั้งที่หน้าเว็บและ API สำหรับงานบริหารระบบ

หน้า `/upload` รองรับทั้งไฟล์จากเครื่องและ Google Drive ผู้ใช้สามารถเชื่อมบัญชี
เลือกหลายวิดีโอผ่าน Google Picker กำหนดหมวดหมู่ แล้วติดตามสถานะการถ่ายโอนจาก
Drive เข้า R2/MinIO ได้ ดูขั้นตอนตั้งค่าที่ `docs/GOOGLE_DRIVE_SETUP.md`

ใน local development ให้ `S3_ACCESS_KEY_ID` และ `S3_SECRET_ACCESS_KEY`
ตรงกับ credential ของ MinIO Docker Compose จะจำกัด CORS ตาม `ADMIN_URL`
และเปิดให้ browser อ่าน `ETag` หลังอัปโหลดแต่ละ part ได้

## คำสั่งคุณภาพ

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

ก่อน seed ต้องเปลี่ยน `BOOTSTRAP_SYSTEM_PASSWORD` ให้ยาวอย่างน้อย 8 ตัวอักษร การรัน seed ซ้ำจะไม่สร้างบัญชีซ้ำ

หากต้องการสร้างหรือรีเซ็ตบัญชี SYSTEM admin โดยไม่เข้า PostgreSQL และไม่บันทึกรหัสผ่านลงไฟล์:

```powershell
corepack pnpm admin:setup
```

คำสั่งจะถามอีเมล ชื่อ และรหัสผ่านแบบซ่อนตัวอักษร จากนั้นยกเลิก session เก่าของบัญชีนั้นทั้งหมด

สร้าง secrets แบบสุ่ม 256-bit ที่รองรับ Windows PowerShell รุ่นเก่า:

```powershell
corepack pnpm env:setup
```

คำสั่งนี้สร้าง `.env` จากไฟล์ตัวอย่างและใส่ secrets ให้อัตโนมัติโดยไม่แสดงค่าใน log หากต้องการเฉพาะค่าที่นำไปวางใน secret manager ให้ใช้ `corepack pnpm secrets:generate` ห้ามใส่ค่าจริงใน `.env.example` หรือ commit ขึ้น Git

## Cloudflare

ตั้งค่า R2 binding และ Analytics Engine ใน `apps/edge/wrangler.toml` แล้วเพิ่ม secrets:

```bash
cd apps/edge
pnpm wrangler secret put MEDIA_SIGNING_SECRET
pnpm wrangler secret put PLAYER_ORIGIN
pnpm deploy
```

ห้ามเปิด public bucket หรือใช้ `r2.dev` ใน production ดูรายละเอียดในเอกสารภายใต้ `docs/`

## Coolify production

ใช้ `docker-compose.coolify.yml` และทำตามคู่มือ
`docs/COOLIFY_DEPLOYMENT.md`
