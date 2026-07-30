# Local Development

รัน `docker compose up -d postgres redis minio minio-init`, สร้าง `.env`
จากตัวอย่าง แล้วรัน generate/migrate/seed ก่อน `pnpm dev`

MinIO เป็น S3-compatible local storage เท่านั้น production ใช้ private R2 ผ่าน
edge worker ค่า `S3_ACCESS_KEY_ID` และ `S3_SECRET_ACCESS_KEY` ใน `.env`
ถูกส่งให้ทั้ง API และ container MinIO จึงต้องตรงกัน

Docker Compose ตั้ง `MINIO_API_CORS_ALLOW_ORIGIN` จาก `ADMIN_URL`
เพื่อให้ browser อัปโหลด `PUT` และอ่าน `ETag` ได้ ส่วน production ต้องกำหนด
bucket CORS ใน Cloudflare dashboard หรือ infrastructure configuration

เครื่องปัจจุบันมี Node 24.17, pnpm 11.11 และ Docker 29.5 แต่ไม่มี FFmpeg/FFprobe บน host; ใช้ worker container หรือเพิ่ม binary ใน PATH.
