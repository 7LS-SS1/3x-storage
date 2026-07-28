# R2 Setup

สร้าง private R2 bucket, ปิด public development URL, สร้าง S3 API token ที่จำกัดเฉพาะ bucket และเก็บเป็น server-side secrets. API/worker ใช้ S3 endpoint `https://<account>.r2.cloudflarestorage.com`; browser รับเฉพาะ presigned multipart part URLs และ signed playback URL.
