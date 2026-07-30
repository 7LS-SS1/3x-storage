# API

NestJS API ใช้ prefix `/api/v1` ส่วน Swagger อยู่ที่ `/docs` ใน development
และเมื่อเปิด `ENABLE_API_DOCS=true`

## Video library

- `GET /api/v1/videos` — server-side pagination, search, category/status filters และ sort allowlist
- `GET /api/v1/videos/:id` — รายละเอียดวิดีโอ
- `PATCH /api/v1/videos/:id` — แก้ชื่อ หมวดหมู่ และโดเมนที่อนุญาต
- `DELETE /api/v1/videos/:id` — ลบ object แล้วทำ soft delete ในฐานข้อมูล
- `POST /api/v1/videos/bulk/category` — เปลี่ยนหมวดหมู่สูงสุด 100 รายการ
- `POST /api/v1/videos/bulk/delete` — ลบสูงสุด 100 รายการแบบแบ่งชุด
- `POST /api/v1/videos/:id/admin-preview-token` — signed preview URL อายุ 5 นาที

## Multipart upload

- `GET /api/v1/uploads/configuration`
- `POST /api/v1/uploads/initiate`
- `POST /api/v1/uploads/:id/parts/presign`
- `POST /api/v1/uploads/:id/parts/record`
- `POST /api/v1/uploads/:id/complete`
- `POST /api/v1/uploads/:id/abort`
- `GET /api/v1/uploads/:id`

ทุก upload session ผูกกับ user เจ้าของ ตรวจ extension, MIME และ file signature
ก่อนสร้าง multipart upload ส่วนที่สำเร็จถูกบันทึกด้วย ETag เพื่อรองรับ retry/resume
และ completion เป็น idempotent

## Storage and categories

- `GET /api/v1/storage/summary`
- `GET|POST /api/v1/categories`
- `PATCH|DELETE /api/v1/categories/:id`

## Management

- `GET|POST /api/v1/users` — รายการและสร้างผู้ใช้งาน
- `PATCH /api/v1/users/:id` — แก้ข้อมูล บทบาท สถานะ หรือรหัสผ่าน พร้อมยกเลิก session เมื่อจำเป็น
- `POST /api/v1/users/:id/revoke-sessions` — ยกเลิก session ที่ยังใช้งานอยู่ทั้งหมด
- `GET|POST /api/v1/domains` — รายการและเพิ่ม hostname ที่อนุญาต
- `PATCH|DELETE /api/v1/domains/:id`
- `GET /api/v1/audit` — Audit log แบบค้นหา กรอง และแบ่งหน้า
- `GET /api/v1/settings` — การตั้งค่าแอปและสถานะ runtime โดยไม่ส่งค่าลับ
- `PATCH /api/v1/settings` — แก้การตั้งค่าระบบ (เฉพาะ SYSTEM)

SYSTEM จัดการผู้ใช้ทุกบทบาทได้ ส่วน ADMIN จัดการได้เฉพาะ STAFF และไม่สามารถใช้
ตัวกรองเพื่ออ่านข้อมูลบัญชี SYSTEM/ADMIN ได้ การลดสิทธิ์หรือปิดบัญชี SYSTEM คนสุดท้าย
จะถูกปฏิเสธ และการเปลี่ยนรหัสผ่าน/บทบาท/สถานะจะยกเลิก session เดิม

## Google Drive import

- `GET /api/v1/google-drive/status`
- `GET /api/v1/google-drive/connect`
- `GET /api/v1/google-drive/callback`
- `GET /api/v1/google-drive/picker-token`
- `GET|POST /api/v1/google-drive/imports`
- `POST /api/v1/google-drive/imports/:id/retry`
- `POST /api/v1/google-drive/imports/:id/cancel`
- `DELETE /api/v1/google-drive/connection`

OAuth state มีอายุ 10 นาทีและใช้ซ้ำไม่ได้ Refresh token ถูกเข้ารหัสก่อนบันทึก
ส่วน Picker access token เป็น token อายุสั้นและตอบกลับด้วย `Cache-Control: no-store`
ทุกงานนำเข้าผูกกับผู้ใช้ที่สร้างงาน และผู้ใช้อื่นไม่สามารถอ่านหรือสั่งงานแทนได้

Admin API ทุก route ใช้ opaque session cookie เดิม ตรวจ user-agent binding
และบังคับ double-submit CSRF สำหรับคำขอเปลี่ยนแปลงข้อมูล ข้อผิดพลาดสำหรับผู้ใช้
ต้องเป็นภาษาไทยและ production ห้ามส่ง stack trace
