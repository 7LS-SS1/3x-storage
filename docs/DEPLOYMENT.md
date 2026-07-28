# Deployment

แยก deploy Admin, API, Worker, PostgreSQL และ Redis บน Docker Compose/Coolify. API และ Worker ใช้ secret ชุดเดียวกันสำหรับ database/storage/signing แต่ Admin ห้ามได้รับ R2 credentials. Worker image ต้องมี FFmpeg/FFprobe และรัน non-root.

Cloudflare Worker deploy แยกด้วย Wrangler; bind private R2 และ Analytics Engine. ตั้ง `MEDIA_SIGNING_SECRET` เป็น secret และจำกัด `PLAYER_ORIGIN`.

ใช้ managed backups สำหรับ PostgreSQL, เปิด Redis persistence, health checks และ graceful shutdown. เปลี่ยน placeholder ทุกค่าใน `.env.example` ก่อน production.
