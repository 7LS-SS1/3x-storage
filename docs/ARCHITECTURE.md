# Architecture

ระบบเป็น modular monolith ที่ deploy แยกได้สี่ส่วน:

1. `apps/admin` — Next.js App Router สำหรับ login, dashboard, upload, admin preview และ embed
2. `apps/api` — NestJS REST API สำหรับ authentication, RBAC, metadata, multipart upload, playback authorization และ audit
3. `apps/worker` — BullMQ consumer ใช้ FFprobe/FFmpeg ตรวจสอบ, transcode/remux และสร้าง poster ไว้ใน R2 prefix `images/{videoId}/`
4. `apps/edge` — Cloudflare Worker ตรวจ HMAC/expiry, stream private R2 object, Range/HEAD และบันทึก Analytics Engine แบบ non-blocking

`packages/database` เป็น schema และ migration source, `packages/shared` เป็น security primitives/types, `packages/player` เป็น controller adapter ที่ไม่ผูกกับ API

ไฟล์ต้นฉบับเก็บที่ generated key `videos/{videoId}/original/{fileId}.{ext}` และไฟล์เล่นที่ `videos/{videoId}/playback/{fileId}.mp4`; ห้ามใช้ชื่อไฟล์ผู้ใช้เป็น storage key เต็ม
