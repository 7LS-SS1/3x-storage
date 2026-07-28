# Local Development

รัน `docker compose up -d postgres redis minio minio-init`, สร้าง `.env` จากตัวอย่าง แล้วรัน generate/migrate/seed ก่อน `pnpm dev`.

MinIO เป็น S3-compatible local storage เท่านั้น production ใช้ private R2 ผ่าน edge worker. Local media route (ถ้าเพิ่มภายหลัง) ต้องปิดเมื่อ `NODE_ENV=production`, ตรวจ signed URL และรองรับ Range เช่นเดียวกับ edge.

เครื่องปัจจุบันมี Node 24.17, pnpm 11.11 และ Docker 29.5 แต่ไม่มี FFmpeg/FFprobe บน host; ใช้ worker container หรือเพิ่ม binary ใน PATH.
