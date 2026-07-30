# ตั้งค่าการนำเข้าวิดีโอจาก Google Drive

ระบบใช้ OAuth 2.0, Google Picker และ scope `drive.file` เพื่อให้ผู้ใช้เลือกและ
อนุญาตเฉพาะไฟล์ที่ต้องการนำเข้า Refresh token จะถูกเข้ารหัสแบบ AES-256-GCM
ก่อนบันทึกลง PostgreSQL และการถ่ายโอนไฟล์ทำผ่าน worker กับ Redis/BullMQ

## 1. ตั้งค่า Google Cloud

1. สร้างหรือเลือก Google Cloud project
2. เปิดใช้งาน **Google Drive API** และ **Google Picker API**
3. ตั้งค่า OAuth consent screen และเพิ่ม scopes:
   - `openid`
   - `email`
   - `https://www.googleapis.com/auth/drive.file`
4. สร้าง OAuth Client ชนิด **Web application**
5. เพิ่ม Authorized JavaScript origins:
   - `http://localhost:3000`
   - origin ของ Admin production
6. เพิ่ม Authorized redirect URIs:
   - `http://localhost:3000/backend/google-drive/callback`
   - `https://<admin-domain>/backend/google-drive/callback`
7. สร้าง API key สำหรับ Google Picker และจำกัด key ให้ใช้ได้เฉพาะ origin ของ
   Admin กับ Google Picker API
8. คัดลอก Project number จากหน้า Project info

## 2. ตั้งค่า Environment

```dotenv
GOOGLE_CLIENT_ID=<oauth-web-client-id>
GOOGLE_CLIENT_SECRET=<oauth-web-client-secret>
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/backend/google-drive/callback
GOOGLE_PICKER_API_KEY=<restricted-picker-api-key>
GOOGLE_CLOUD_PROJECT_NUMBER=<numeric-project-number>
GOOGLE_TOKEN_ENCRYPTION_KEY=<64-character-random-hex>
DRIVE_IMPORT_CONCURRENCY=2
```

สร้าง encryption key ได้ด้วย:

```powershell
corepack pnpm secrets:generate
```

นำเฉพาะค่า `GOOGLE_TOKEN_ENCRYPTION_KEY` ไปใส่ใน `.env` และ secret manager
ห้ามเปลี่ยน key ขณะที่ยังมีบัญชี Google เชื่อมต่ออยู่ เพราะ refresh token เดิม
จะไม่สามารถถอดรหัสได้

## 3. เริ่มบริการ

PostgreSQL และ Redis ต้องพร้อมใช้งาน จากนั้นเริ่ม Admin, API และ worker:

```powershell
corepack pnpm dev
```

เปิด `/upload` เลือกแท็บ **Google Drive** แล้วกด **เชื่อมต่อบัญชี Google**

## การทำงานของระบบ

- เลือกพร้อมกันได้สูงสุด 20 ไฟล์
- รองรับชนิดวิดีโอเดียวกับการอัปโหลดจากเครื่อง
- ตรวจ metadata, สิทธิ์ดาวน์โหลด, ขนาด, MIME และ file signature
- ถ่ายโอนเป็นช่วงแล้วเขียนเข้า R2/MinIO แบบ multipart
- ตรวจ MD5 checksum เมื่อ Google Drive มีค่า checksum
- retry อัตโนมัติแบบ exponential backoff สูงสุด 4 ครั้ง
- ยกเลิกหรือลองใหม่จากหน้าอัปโหลดได้
- สร้าง Audit log เมื่อเชื่อมต่อ นำเข้า ยกเลิก ล้มเหลว และเสร็จสิ้น

## ข้อควรระวัง

- ห้าม commit Client secret, API key, encryption key หรือ refresh token
- Production ต้องใช้ HTTPS และ redirect URI ต้องตรงกับ Google Cloud ทุกตัวอักษร
- Redis และ worker ต้องทำงานตลอดเวลา มิฉะนั้นงานจะค้างในสถานะรอเริ่ม
- ถ้าถอดสิทธิ์แอปจาก Google Account งานใหม่จะต้องเชื่อมต่อบัญชีอีกครั้ง
