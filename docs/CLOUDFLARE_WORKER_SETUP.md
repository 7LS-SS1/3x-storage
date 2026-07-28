# Cloudflare Worker Setup

แก้ bucket/dataset ใน `apps/edge/wrangler.toml`, ตั้ง `MEDIA_SIGNING_SECRET` และ `PLAYER_ORIGIN` ด้วย `wrangler secret put`, ทดสอบ `pnpm --filter @video/edge dev` แล้ว deploy `pnpm --filter @video/edge deploy`.

Worker รองรับ GET/HEAD/Range, ไม่ list objects, stream โดยไม่ buffer และเขียน analytics ด้วย `ctx.waitUntil`.
