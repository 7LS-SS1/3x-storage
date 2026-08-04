# Deploy 3X Storage บน Coolify

สถาปัตยกรรม production ที่แนะนำ:

- Coolify Docker Compose: `admin`, `api`, `worker`, `migrate`, `bootstrap-admin`
- Coolify PostgreSQL 17 Resource: ข้อมูลผู้ใช้ เซสชัน metadata วิดีโอ และ audit log
- Redis 7.4 ใน Compose: BullMQ และคิวงานเท่านั้น
- Cloudflare R2 bucket `3xapi`: ไฟล์วิดีโอ
- Cloudflare Worker: ส่งวิดีโอแบบ signed URL และ Range request

อย่าเก็บไฟล์วิดีโอใน PostgreSQL หรือ volume ของ Coolify

## 1. สร้าง PostgreSQL

ใน Project/Environment เดียวกับแอป:

1. เลือก **New Resource → PostgreSQL**
2. ใช้ PostgreSQL 17
3. สร้าง database และ user สำหรับแอปโดยเฉพาะ
4. ไม่เปิด Public Port ถ้าแอปกับฐานข้อมูลอยู่บน Coolify server เดียวกัน
5. คัดลอก Internal URL ของฐานข้อมูล
6. เปิด **Connect to Predefined Network** ให้ Service Stack ของแอป

ใช้ hostname ตาม Internal URL ที่ Coolify สร้าง เช่น
`postgres-<resource-uuid>` ห้ามเปลี่ยนกลับเป็น `localhost`

กำหนด connection pool สำหรับ Prisma เพราะ `admin`, `api` และ `worker`
มี pool แยกกัน:

```text
DATABASE_URL=postgresql://USER:URL_ENCODED_PASSWORD@postgres-UUID:5432/video?schema=public&connection_limit=5&pool_timeout=20&connect_timeout=10
DIRECT_DATABASE_URL=postgresql://USER:URL_ENCODED_PASSWORD@postgres-UUID:5432/video?schema=public&connect_timeout=10
```

ถ้า PostgreSQL อยู่คนละ server ให้เปิด SSL และใช้ URL แบบ `sslmode=verify-full`
พร้อม mount CA certificate ตามคู่มือ Coolify

PostgreSQL Resource บน Coolify เหมาะกับการเริ่ม production บนเครื่องเดียว
แต่ไม่ใช่ระบบ High Availability หากงานต้องมี SLA สูงหรือยอมให้ฐานข้อมูลหยุดไม่ได้
ให้ใช้ managed PostgreSQL ภายนอก เช่น AWS RDS แล้วกำหนด SSL, backup และ
point-in-time recovery ที่ผู้ให้บริการ

## 2. ตั้งค่า Backup

สร้าง R2 bucket แยกจาก bucket วิดีโอ เช่น `3xapi-db-backups` แล้วเพิ่มเป็น
S3 Storage ใน Coolify:

- สำรอง PostgreSQL ทุกวัน
- เก็บอย่างน้อย 30 วัน
- เก็บ local backup จำนวนเล็กน้อยและส่งสำเนาไป R2
- ทดลอง restore ไปยัง database ชั่วคราวเป็นระยะ

การ backup Coolify instance ไม่ได้แทนการ backup application database

## 3. สร้าง Docker Compose Resource

เชื่อม repository แล้วเลือก Docker Compose build pack:

```text
Docker Compose location: /docker-compose.coolify.yml
```

ไฟล์นี้มี `exclude_from_hc` ซึ่งเป็น property เฉพาะของ Coolify จึงไม่ควรใช้แทน
`docker-compose.yml` สำหรับ local development

เปิด **Connect to Predefined Network** เพื่อให้ Compose stack เข้าถึง
PostgreSQL Resource ผ่าน Internal URL

กำหนด domain ให้เฉพาะ service `admin` ที่ port `3000`

ห้ามกำหนด public domain หรือ host port ให้ `api`, `redis`, `worker`, `migrate`
และ `bootstrap-admin`

`admin` จะเรียก API ผ่าน private service `http://api:4000`

Docker Compose deployment ของ Coolify ไม่มี rolling update หากต้องการ
zero-downtime อย่างเคร่งครัด ให้แยก `admin` และ `api` เป็น Application Resource
คนละตัว แทนการใช้ Compose stack เดียว

## 4. Environment variables

ใช้ [config/coolify.env.example](../config/coolify.env.example) เป็นรายการตั้งต้น
และกรอกค่าทั้งหมดใน Coolify

ค่าที่เป็น secret ต้องเป็นคนละค่า:

```text
SESSION_SECRET
CSRF_SECRET
IP_HASH_SALT
MEDIA_SIGNING_SECRET
GOOGLE_TOKEN_ENCRYPTION_KEY
REDIS_PASSWORD
```

สุ่มค่า 256-bit จากเครื่อง Windows:

```powershell
corepack pnpm secrets:generate
```

ข้อควรระวัง:

- เปิดตัวเลือก **Literal** ใน Coolify สำหรับ URL/password ที่มี `$`
- อย่าตั้ง secret เป็น Build Variable; แอปต้องใช้เฉพาะ runtime
- `SESSION_COOKIE_NAME` ใน production ต้องขึ้นต้นด้วย `__Host-`
- `APP_URL`, `ADMIN_URL`, `PLAYER_URL` และ `MEDIA_URL` ต้องเป็น HTTPS
- `MEDIA_SIGNING_SECRET` ต้องตรงกับ secret ของ Cloudflare Worker
- ระบบส่ง `REDIS_PASSWORD` แยกจาก `REDIS_URL` ภายใน Compose เพื่อให้รหัสผ่านที่มี
  อักขระพิเศษทำงานได้โดยไม่ต้อง URL-encode

## 5. R2 และ Cloudflare Worker

สร้าง R2 API token แบบ bucket-scoped สำหรับ bucket `3xapi` และอนุญาตเฉพาะ
Object Read & Write จากนั้นตั้ง:

```text
R2_ACCOUNT_ID
R2_BUCKET=3xapi
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

ตั้ง CORS ของ R2 ให้ `AllowedOrigins` เป็น production admin origin แบบเจาะจง
เช่น `https://storage.example.com` และอนุญาต method/header ที่ระบบอัปโหลดใช้

Deploy Cloudflare Worker แยกจาก Coolify:

```powershell
corepack pnpm --filter @video/edge exec wrangler secret put MEDIA_SIGNING_SECRET
corepack pnpm --filter @video/edge exec wrangler secret put PLAYER_ORIGIN
corepack pnpm --filter @video/edge deploy
```

ตั้ง `MEDIA_URL` ใน Coolify เป็น URL HTTPS ของ Worker หรือ custom domain

## 6. Google Drive

ถ้าต้องการเปิดใช้งาน Google Drive import ให้กรอกตัวแปร `GOOGLE_*` ทั้งหมด
และเพิ่ม production callback URL ใน Google Cloud:

```text
https://storage.example.com/backend/google-drive/callback
```

ดูรายละเอียดที่ [GOOGLE_DRIVE_SETUP.md](./GOOGLE_DRIVE_SETUP.md)

## 7. สร้าง SYSTEM administrator ครั้งแรก

ก่อน deploy ครั้งแรก ให้ตั้ง:

```text
BOOTSTRAP_SYSTEM_EMAIL
BOOTSTRAP_SYSTEM_NAME
BOOTSTRAP_SYSTEM_PASSWORD
```

service `bootstrap-admin` จะสร้างหรืออัปเดต SYSTEM administrator หลัง migration
สำเร็จ เมื่อเข้าใช้งานได้แล้วให้ลบตัวแปรทั้งสามออกจาก Coolify และ redeploy
เพื่อไม่ให้รหัสผ่านค้างอยู่ใน deployment environment

## 8. Deploy และตรวจสอบ

Coolify deploy จาก branch ที่กำหนดเท่านั้น โดย production ควรชี้ `main` และ commit
ต้องถูก merge เข้า `main` ก่อน การ force deploy จะ rebuild commit เดิมและไม่ดึงโค้ดจาก
Draft PR หรือ branch อื่น

Compose จะทำงานตามลำดับ:

1. Redis พร้อมใช้งาน
2. `prisma migrate deploy`
3. bootstrap administrator ถ้ามีค่า
4. API ผ่าน database/Redis/R2 readiness check
5. Admin ผ่าน database/configuration health check
6. Worker เริ่มรับคิว

Cloudflare media Worker ไม่ได้อยู่ใน Coolify Compose และต้อง deploy แยกต่างหาก เมื่อมี
การเปลี่ยน playback/HLS ให้ deploy `apps/edge` ก่อน แล้วจึง redeploy Coolify เพื่อไม่ให้
manifest รุ่นใหม่อ้าง segment ที่ Edge รุ่นเดิมยังไม่รองรับ

ตรวจสอบ:

```text
https://storage.example.com/api/health
```

ควรได้ HTTP 200 และ `status: ready`

API readiness ภายใน container:

```text
http://api:4000/api/v1/health/ready
```

ก่อนเปิดรับผู้ใช้จริง ให้ทดสอบ login, อัปโหลด multipart, Google Drive import,
เล่นวิดีโอผ่าน Worker, ยกเลิกงาน และ restore PostgreSQL จาก backup อย่างน้อยหนึ่งครั้ง
