# WordPress metadata import ใน 3x-storage

ส่งมอบ 12 พฤศจิกายน 2026 (Asia/Bangkok)

ต่อยอดจากปลั๊กอิน export ของ RetroTube โดยเพิ่มหน้าจอ `/metadata-import` ใน App สำหรับบัญชี ADMIN/SYSTEM ไม่เชื่อม 7M/AURUM Video Core และไม่ส่ง request กลับ WordPress

## วิธีใช้

1. เปิดเมนู **นำเข้า Metadata** ในกลุ่มการจัดการ (หลัง deploy migration และแอปแล้ว)
2. เลือก JSON เต็มจากปลั๊กอิน RetroTube หรือ CSV UTF-8 แล้วกด **ตรวจไฟล์และสร้าง Batch** ขั้นนี้จัดเก็บต้นทางและผลตรวจเท่านั้น ยังไม่แก้ Video
3. เริ่มทีละ 1–2 รายการ กด **เลือกคู่ / ตรวจแก้** คัดลอก Video ID หรือ publicId จากคลังวิดีโอไปค้นหาแบบตรงกัน แล้วเลือก Video ID ปลายทาง ไม่มีการจับคู่จากชื่อคล้ายกันหรือ ID ที่ parse จาก iframe
4. ถ้าไฟล์มี `target_video_id` อยู่แล้ว จะนำค่านั้นมาใส่ช่องเลือกคู่ แต่ยังต้องตรวจ preview และยืนยัน หากไม่ระบุ ช่องจะว่าง คู่ที่เคยนำเข้าจะมีปุ่ม **ใช้คู่เดิม** ให้ผู้ใช้เลือกเอง
5. เลือกฟิลด์ที่ต้องการแก้ ปรับข้อความได้ เลือกแหล่งคำอธิบายจาก description/excerpt_raw/content_raw/description_sources หรือรูปจาก featured/custom thumbnail ได้ โดยเก็บต้นฉบับไว้ครบ
6. เลือกหมวดหมู่ปลายทางจากรายการใน App เอง ไม่สร้าง/จับคู่หมวดหมู่ตามชื่ออัตโนมัติ
7. กด **แสดงข้อมูลก่อน–หลัง** ตรวจ Video ID/publicId และคอลัมน์เปรียบเทียบ เพิ่มได้ไม่เกินสอง preview ต่อรอบ แล้วติ๊กยืนยันและกด **บันทึก**
8. ระบบแสดงผลแยกแต่ละรายการ หากรายการหนึ่งผิดพลาด รายการนั้นจะ rollback transaction ส่วนรายการที่สำเร็จคงอยู่ หากพบข้อมูลเปลี่ยนหลัง preview ให้เปิดรายการและตรวจใหม่
9. ประวัติอยู่ด้านล่าง เปิดรายการดู before/after, ผู้ดำเนินการ, เวลา, source key และ batch ID กดตรวจและยืนยันย้อนคืนได้ ระบบปฏิเสธเมื่อข้อมูลใหม่อาจถูกเขียนทับ การเปลี่ยนต่อเนื่องควรย้อนจากล่าสุดไปเก่าสุด

Preview มีอายุ 15 นาทีและผูกกับบัญชีที่ตรวจ การโหลดหน้าใหม่/เปลี่ยนผู้ใช้ต้องตรวจใหม่ก่อนบันทึก เวลาที่แสดงในประวัติเป็น Asia/Bangkok

## รูปแบบและขอบเขตข้อมูล

- JSON รับ array หรือ `{ records: [...] }` จากปลั๊กอินเดิม พร้อมเก็บ header อื่นไว้ใน batch; site_url ระดับไฟล์ใช้เป็น fallback ได้
- ฟิลด์พื้นฐาน: `site_url`, `post_id`, `title`, `description`, `categories[]`, `tags[]`, `image_url`, `target_video_id` (optional)
- CSV คอลัมน์ categories/tags ต้องใส่ JSON array ในเซลล์ เช่น `["ท่องเที่ยว","ความรู้"]` โดย quote ตาม CSV ไม่เดาโดยแบ่งข้อความที่ comma
- รองรับ BOM, ภาษาไทย, quote, comma และ newline ภายในเซลล์ CSV; CSV summary จาก exporter ไม่มีข้อมูลครบเท่า JSON และอาจมี apostrophe ที่ป้องกันสูตร จึงแนะนำ JSON สำหรับข้อมูลหลัก ไม่ลบ apostrophe/แก้ข้อความต้นทางโดยเดา
- จำกัด 10 MiB และ 500 records ต่อไฟล์ รายการแสดงครั้งละ 25 แถว; batch selector แสดง 30 batch ล่าสุด ส่วน batch ที่มี ID ยังเรียกผ่าน API ได้
- คีย์ต้นทางคือ site URL ที่ normalize host/port/trailing slash + post_id; ยังคง scheme และ path เพื่อไม่รวมเว็บไซต์คนละแห่งโดยเดา site_url ไม่รับ credentials/query/fragment และ post_id ต้องเป็น integer บวกใน safe integer range
- source key ซ้ำในไฟล์: ทุกแถวที่ซ้ำเป็น INVALID ไม่เลือกผู้ชนะให้; รูปแบบไฟล์เสีย/เกินขนาดปฏิเสธทั้งไฟล์ ส่วนความผิดพลาดในรายการแสดงต่อแถว เก็บ raw สำหรับตรวจ แก้ไฟล์แล้วนำเข้าใหม่ได้
- อัปเดตได้เฉพาะ `Video.title` (สูงสุด 200 ตัวอักษร), `Video.description` (100,000 ตัวอักษร), `Video.categoryId` และ `VideoMetadataImage.imageUrl` (2,048 ตัวอักษร)
- ไม่เขียนทับด้วยค่าว่างโดยปริยาย สามารถอนุญาตล้าง description/category/image URL ได้อย่างชัดเจน แต่ไม่อนุญาตชื่อวิดีโอว่าง
- รูป URL เป็น **metadata เพิ่มเติม** ไม่ดาวน์โหลดรูป ไม่ทำหน้าที่แทนปกใน player และไม่เปลี่ยน `posterKey` หรือ `VideoFile` รูปจะถูกแสดงเป็นข้อความในหน้าตรวจสอบ
- schema เดิมมี categoryId เดียวและยังไม่มี tags relation: ทุกหมวดหมู่ แท็ก actor/custom taxonomy รวม HTML/shortcode/embed/custom fields เก็บครบใน raw source และแสดงข้อจำกัด ไม่ตัดเหลือหมวดหมู่แรกเงียบ ๆ
- source mapping ที่บันทึกแล้วจะไม่เปลี่ยนไปวิดีโออื่นโดยปริยาย ต้องย้อนคืนการจับคู่เดิมจนไม่มี active mapping ก่อน แล้วเลือกคู่ใหม่เอง
- ไม่มีการสร้าง Video ใหม่ ไม่มี fetch/execute iframe หรือ HTML จากไฟล์ ไม่มี storage/R2 call ไม่แตะ ID/publicId/เจ้าของ/storage keys/ไฟล์สื่อ/access domains

ตัวอย่างไฟล์: `artifacts/metadata-import/sample-unmapped.json`, `artifacts/metadata-import/sample.csv` ไม่มี target_video_id เพื่อให้ทดสอบการเลือกคู่เองก่อน

## การจัดเก็บและความถูกต้อง

Migration ใหม่: `packages/database/prisma/migrations/20261112090000_wordpress_metadata_import/migration.sql`

| ตารางใหม่ | หน้าที่ |
|---|---|
| MetadataImportBatch | ผู้สร้าง ชื่อไฟล์ format header และเวลา |
| MetadataImportRow | raw/normalized data, errors/warnings, status และ preview ที่ผูกบัญชี |
| WordPressMetadataSource | unique(siteUrl, postId), explicit targetVideoId, raw source ล่าสุด, hash และ change ล่าสุด |
| VideoMetadataImage | URL รูป metadata แยกจากสัญญา media/storage และ version สำหรับตรวจ stale preview |
| MetadataChange | before/after, fields, source ก่อน–หลัง, actor ID/name, เวลา และผู้ย้อนคืน ผูก row → batch |

เพิ่ม relation ใน Prisma โดยไม่เพิ่ม/ลบ/เปลี่ยน scalar column เดิมของ Video การบันทึกและ rollback ทำใน transaction ต่อรายการ ล็อก row และ Video พร้อม transaction advisory lock ของ source key จึงไม่เกิดการนำเข้าคีย์ใหม่ซ้ำเมื่อยืนยันพร้อมกัน

ก่อน apply จะตรวจ fingerprint ของค่าปัจจุบัน/updatedAt/image version เทียบกับ preview และตรวจ source state ซ้ำ การบันทึก audit อยู่ใน transaction เดียวกัน ถ้าขั้นใดล้มเหลวต้องไม่เหลือ Video update, sidecar, source mapping หรือ journal ค้าง

การยืนยันซ้ำด้วย token เดิมคืนผลเดิมโดยไม่เพิ่ม change; การอัปโหลดซ้ำสร้าง batch ของความพยายามใหม่ได้ แต่ไม่สร้าง Video หรือ source record ซ้ำ เมื่อค่าปลายทางและ source hash เหมือนเดิมจะได้ NOOP

Rollback ตรวจ active source change และค่า metadata ปัจจุบันเทียบกับ after snapshot ก่อนคืนเฉพาะฟิลด์ที่เปลี่ยน ไม่เขียนค่าประวัติทับ journal เดิม ไม่คืน updatedAt ย้อนเวลา; การย้อนคืนเองมี audit/เวลา/actor ใหม่ Source ที่สร้างครั้งแรกจะถูกทำ inactive เพื่อคงประวัติแทนการลบทิ้ง

## สิทธิ์และการรักษาข้อมูล

- หน้า server component ปฏิเสธ STAFF และ middleware ใช้ session/no-store เหมือนหน้าจัดการอื่น
- ทุก endpoint ใช้ AdminSessionGuard → MetadataAdminGuard → CsrfGuard; รองรับเฉพาะ ADMIN/SYSTEM
- mutation ตรวจ origin + CSRF header/cookie + session hash เดิมของระบบ ไม่เชื่อถือ actor จาก request body
- apply ต้อง `confirm:true` และ 1–2 row/token ที่ไม่ซ้ำ ฝั่ง API บังคับขอบเขตนี้ด้วย ไม่ใช่แค่ปุ่มบน UI
- schema ของ preview/confirm เป็น strict allowlist จึงส่ง owner/storageKey/allowedDomainIds หรือฟิลด์อื่นมาแก้ไม่ได้
- Raw source เป็นข้อมูลภายใน อ่านได้เฉพาะผู้ดูแล ไม่ใช้ dangerouslySetInnerHTML ไม่ render iframe หรือ fetch URL รูป
- ไม่มี credentials ใหม่ใน .env และไม่เพิ่ม dependency production

## สิ่งที่ตรวจพบก่อนพัฒนา

- ไม่พบ AGENTS.md ที่ครอบคลุม root/ancestor หรือไฟล์ในพื้นที่นี้
- แอปใช้ Next.js admin, NestJS API, PostgreSQL/Prisma และ session/CSRF guards เดิม
- working tree มีงานเดิมค้างหลายไฟล์ โดยเฉพาะ schema, admin-shell และระบบ upload/playback จึงเพิ่มเฉพาะส่วนที่จำเป็น ไม่ reset/แทนที่ไฟล์เดิมทั้งไฟล์
- ลองเชื่อมฐานข้อมูลตาม DATABASE_URL และ LOCAL_DATABASE_URL/default แล้วเชื่อมไม่ได้ จึง **ไม่ได้ยืนยัน schema/data บน production** สร้าง Docker PostgreSQL แยก `3x-metadata-import-test` บน 127.0.0.1:55449 ฐานข้อมูล `video_metadata_test` สำหรับตรวจฐานข้อมูลจริงของงานนี้
- ทดสอบ apply migration ทั้งชุดกับฐานใหม่ และทดสอบ migration เฉพาะงานนี้กับ schema ก่อนแก้ที่มีข้อมูลจำลองเดิมอยู่แล้ว ไม่มีการใช้ฐานข้อมูลของโปรเจกต์อื่น

## ผลทดสอบในเครื่อง

| การตรวจ | ผล |
|---|---|
| API TypeScript | ผ่าน |
| Admin TypeScript | ผ่าน |
| API unit/regression | 50 tests ผ่าน รวม parser ใหม่ 10 tests และของเดิม 40 tests |
| PostgreSQL + HTTP integration | 10 tests ผ่าน ใช้ database จริงและ guards จริง |
| Real browser E2E | Chrome: Next login/session/CSRF จริง → อัปโหลด → preview → ยืนยัน → reload → rollback; STAFF redirect; ไม่มี mock API/DB และไม่พบ pageerror |
| Responsive review | ตรวจ screenshot desktop 1440px / mobile 390px; มือถือแสดงค่าก่อน–หลังเรียงลงเพื่ออ่านครบ |
| Migration preservation | เปรียบเทียบข้อมูลก่อน–หลัง delta migration: ID/publicId/owner/title/description/category/storage keys/VideoFile/allowed domains/UploadSession + multipart ID เหมือนเดิม |
| Backup/restore rehearsal | pg_dump/pg_restore ฐานจำลองไปฐานแยก แล้วเทียบ exact row hashes ของ **24 ตาราง** ตรงกันทั้งหมด |

Integration tests ครอบคลุมการอัปเดต/เลือกฟิลด์, ค่าว่างและ explicit clear, source duplicates, replay/NOOP, actor mismatch, stale/expired preview, protected-field injection, category validation, remap conflict, rollback ปกติและปฏิเสธเมื่อมีงานใหม่, ย้อนสอง change ตามลำดับ, concurrent confirmation และ PostgreSQL trigger ที่จงใจทำ audit insert ล้มเหลวเพื่อพิสูจน์ rollback ทุก write พร้อมผลแยกจากอีกรายการที่สำเร็จ

คำสั่งทดสอบ (ใช้เฉพาะฐานจำลองที่ชื่อ/host ตาม test guard):

```powershell
$env:METADATA_TEST_DATABASE_URL='postgresql://video:local-metadata-fixture@localhost:55449/video_metadata_test'
node apps/api/node_modules/vitest/vitest.mjs run apps/api/src/metadata-import.parser.test.ts apps/api/src/metadata-import.integration.test.ts
node apps/api/node_modules/vitest/vitest.mjs run apps/api/src --exclude '**/metadata-import.integration.test.ts'
node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit --incremental false -p apps/admin/tsconfig.json
node scripts/metadata-import-migration-test.cjs
```

Browser harness: `scripts/metadata-import-local-runtime.cjs` เปิด API เฉพาะ metadata/categories โดยไม่โหลด storage/worker services; `scripts/metadata-import-browser-test.cjs` ทดสอบ Next ที่ localhost:3008 กับ API ที่ localhost:4008 ต้องใช้ LOCAL_DATABASE_URL ของฐานจำลองและ SESSION_SECRET/CSRF_SECRET ชุดทดสอบเดียวกันทั้งสอง process ห้ามใช้ script นี้เป็น production server หรือใช้บัญชีทดสอบใน production

## ขั้นตอน production และ rollback

**ยังไม่ยืนยัน deploy หรือ migrate production** ผล local และการ push Git ไม่ใช่หลักฐานว่า production พร้อมใช้งานแล้ว

ตรวจ release วันที่ 2026-11-12 บนฐาน origin/main: API tests 60, exporter JavaScript tests 5, TypeScript API/Admin และ migration preservation ผ่าน รายงานเพิ่มเติม: `artifacts/metadata-import/release-validation.json` ฐาน production ใช้ hostname ภายใน Coolify ซึ่ง resolve จากเครื่องนี้ไม่ได้ (ENOTFOUND) จึงยังไม่ได้สำรองหรือรัน migration บน production

1. ตรวจ migration history และ schema จริงของ production เทียบ baseline ก่อน; working tree มี migration/การแก้ไขอื่นที่มีอยู่เดิม ต้องตรวจขอบเขตทั้งหมดก่อน `migrate deploy` ห้ามถือว่า SQL additive แปลว่าไม่มีผลกระทบ
2. สำรอง PostgreSQL และพิสูจน์ restore ในสภาพแวดล้อมแยกก่อน deploy เก็บ backup/ข้อมูล raw import ภายใต้สิทธิ์ข้อมูลภายใน การซ้อม restore รอบนี้ใช้ข้อมูลจำลองเท่านั้น
3. Apply schema ก่อน rollout API/admin ที่สร้าง Prisma client จาก schema นี้ Migration เพิ่มห้าตาราง/index/FK และไม่ rewrite media tables แต่การสร้าง FK/การล็อกแถวอาจทำให้ request รอ จัดช่วงเหมาะสมและตรวจ lock/latency
4. Deploy API + admin จาก source revision เดียวกันโดยรักษางานเดิมและใช้ production secrets/config ของระบบ; ยังไม่ได้ validate full production build/deployment ในงานนี้
5. Canary: admin เปิดไฟล์จริง 1–2 รายการ ตรวจ source key, Video ID, ฟิลด์, preview, audit และ rollback ตรวจ embed/publicId/สิทธิ์/owner/storage key ก่อน–หลัง ห้ามขยายจน canary ผ่าน
6. Worker draining: N/A สำหรับการเปลี่ยนนี้ เพราะไม่เปลี่ยน queue/job/transcoding หรือ media lifecycle ไม่หยุดงาน upload ที่กำลังทำ แต่ควรเฝ้าดู row-lock contention ระหว่าง apply
7. หากพบปัญหา หยุดการนำเข้าและ rollback แอปเป็น version เดิม โดยเก็บตารางใหม่ไว้เพื่อไม่เสีย raw source/audit หากต้องคืน metadata ให้ใช้ change rollback ที่ตรวจ conflict ก่อน การลบตาราง/restore backup ทั้งฐานไม่ใช่ขั้นตอน rollback ปกติและอาจทับงานใหม่

ข้อจำกัดคงเหลือ: ยังไม่ได้ตรวจข้อมูล WordPress จริงหรือ migration บน production, ยังไม่ทดสอบไฟล์ 500 records ขนาดเต็มบนโครงสร้าง production, schema ยังเก็บหนึ่งหมวดหมู่และไม่เผยแพร่ tags เป็น relation, URL รูป metadata ไม่แทนปก player และไม่มี importer สำหรับไฟล์ media หรือการแก้ iframe

## ค้นหาคู่อัตโนมัติและตรวจไฟล์ใน App

เมื่อเปิดรายการ ระบบอ่าน URL จาก `iframe_sources` ของ JSON หรือ `iframe_src` ของ CSV แล้วค้นหา `Video.publicId` แบบตรงกัน แสดง origin ว่าตรงกับ APP_URL/PLAYER_URL ที่ตั้งไว้หรือยังไม่ยืนยัน ไม่เชื่อ `parsed_embed_id` ที่ส่งมาเดี่ยว ๆ และไม่เปิด iframe ต้นทาง

ค้นหาชื่อไฟล์แบบตรงกันจาก `video_urls`, `video_url` หรือ `video_filename` เทียบกับ Video.originalFilename/VideoFile สำหรับไฟล์วิดีโอ คอลัมน์ `filename` และ `original_filename` ของ WordPress exporter เป็นชื่อรูป จึงไม่ใช้ค้นหาวิดีโอ ไม่ค้นหาจากชื่อเรื่องคล้ายกัน หากเจอหลายคู่ต้องเลือกเอง ระบบไม่เขียน mapping จากผลค้นหา

แสดงข้อมูลไฟล์ที่มีในฐานข้อมูล ได้แก่ชื่อ MIME บทบาท ขนาด bytes ความละเอียดและความยาว ปุ่มเปิดวิดีโอใช้ endpoint admin-preview-token เดิมผ่าน session/CSRF โดยขอ source=original เพื่อให้ไฟล์ ORIGINAL มาก่อน หากไม่มีจึงใช้ไฟล์ที่เล่นได้ตามลำดับเดิม ลิงก์มีอายุ 5 นาที และใช้ SecureVideoPlayer ที่รองรับไฟล์ปกติ/HLS การเล่นใช้สิทธิ์ผู้ดูแลเดิม ไม่เปลี่ยนสิทธิ์ public หรือ iframe

ID หรือชื่อไฟล์ตรงกันไม่ใช่การยืนยันว่าเนื้อไฟล์เหมือนกันทุก byte ยังไม่มี checksum ต้นทางที่มีชนิดอัลกอริทึมยืนยันได้ ระบบจึงแสดงว่ายังไม่เทียบเนื้อไฟล์ ให้ตรวจภาพ/วิดีโอก่อนเลือกคู่ ไม่มีการดาวน์โหลดไฟล์จาก URL ต้นทางหรือทำ server-side fetch เพื่อค้นหา

จำกัด 64 references, 20 candidates และ 50 file rows ต่อ candidate พร้อมแจ้งจำนวนที่ถูกจำกัด Endpoint candidates เป็น read-only ภายใต้ ADMIN/SYSTEM และ private no-store เดิม การบันทึกยังต้อง preview และยืนยัน 1–2 รายการ ไม่เพิ่ม schema/migration และไม่เปลี่ยนงาน queue/storage lifecycle

การทดสอบเพิ่มเติม: `node scripts/metadata-import-discovery-browser-test.cjs` (ต้อง compile API และเปิดฐานจำลองก่อน) ทดสอบ Next/Nest/PostgreSQL จริงพร้อม generic video ที่สร้างในเครื่อง ส่วน storage URL ใช้ test double ใน localhost เท่านั้น ไม่มีการทดสอบ R2/production หรือ WordPress จริง
