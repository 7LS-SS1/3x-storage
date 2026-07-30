# R2 Setup

สร้าง private R2 bucket, ปิด public development URL, สร้าง S3 API token
ที่จำกัดเฉพาะ bucket และเก็บเป็น server-side secrets API/worker ใช้ S3 endpoint
`https://<account>.r2.cloudflarestorage.com`; browser รับเฉพาะ presigned
multipart part URLs และ signed playback URL

ตั้ง bucket CORS ให้:

- Allowed origin เป็น origin ของ `ADMIN_URL` เท่านั้น
- Methods: `GET`, `HEAD`, `PUT`
- Allowed headers: `*` หรือรายการ S3 signing headers ที่ใช้จริง
- Expose headers: `ETag`, `Content-Length`, `Content-Range`
- Max age: 3600 วินาที

ตั้ง `STORAGE_DRIVER=r2` ใน production และจัดการ CORS ที่ bucket โดยตรง
