# API

API versioning ใช้ `/v1`, Swagger ที่ `/docs`, Helmet และ CORS แบบกำหนด origin. โครงปัจจุบันมี health และ playback security endpoints เป็นฐานสำหรับ modules ตาม domain.

ข้อผิดพลาดที่แสดงผู้ใช้ต้องเป็นภาษาไทยและรูปแบบมาตรฐาน `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`; production ห้ามส่ง stack trace.
