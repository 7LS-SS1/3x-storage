# Cloudflare Worker Setup

แก้ bucket/dataset ใน `apps/edge/wrangler.toml`, ตั้ง `MEDIA_SIGNING_SECRET` และ `PLAYER_ORIGIN` ด้วย `wrangler secret put`, ทดสอบ `pnpm --filter @video/edge dev` แล้ว deploy `pnpm --filter @video/edge deploy`.

Worker รองรับ GET/HEAD/Range, ไม่ list objects, streamไฟล์วิดีโอจาก R2 และเขียน analytics ผ่าน binding โดยตรง.

> การ force deploy ใน Coolify ไม่ deploy Cloudflare Worker ให้ ต้องรันคำสั่ง deploy ของ
> `@video/edge` แยกต่างหาก และตรวจ `wrangler versions list` ว่ามี version ใหม่หลัง deploy
