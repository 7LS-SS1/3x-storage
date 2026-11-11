# WordPress metadata import ใน 3x-storage

ส่งมอบ 12 พฤศจิกายน 2026 (Asia/Bangkok)

ต่อยอดจากปลั๊กอิน export ของ RetroTube โดยเพิ่มหน้าจอ `/metadata-import` ใน App สำหรับบัญชี ADMIN/SYSTEM ไม่เชื่อม 7M/AURUM Video Core ไม่แก้ข้อมูล WordPress; การเทียบรูปอ่าน URL รูปปกต้นทางเท่านั้น

## วิธีใช้

### ค้นหาจากภาพหน้าปกจริง

หลังอัปโหลดหรือเปิด batch ระบบเทียบภาพจาก `image_url` / `featured_image_url` กับรูป `Video.posterKey` ทั้งคลังโดยอัตโนมัติ ไม่ใช้ชื่อรูปเป็นหลักฐานว่าภาพเหมือนกัน และไม่ต้องมี ID ตรงกัน รูปจาก CSV สรุปใช้ค้นหาคู่ได้ แต่คำอธิบายบทความยังต้องใช้ JSON

- แสดงรูปต้นทางคู่กับรูปในแอปและเรียงคู่ตามความคล้าย สูงสุด 20 คู่ต่อบทความ ไม่มีการเลือกคู่หรืออนุมัติให้เอง
- SHA-256 เท่ากันหมายถึงไฟล์รูปตรงกันทุก byte ส่วนภาพย่อ/บีบอัดใหม่เทียบสีและโครงสร้างภาพที่ปรับขนาดแล้ว คะแนนตั้งแต่ 85/100 จึงเป็นตัวเลือก คะแนนไม่ใช่ความน่าจะเป็น ภาพเดียวกันอาจใช้กับหลายวิดีโอ ต้องเล่นตรวจและอนุมัติก่อนเสมอ
- ภาพตัดขอบมาก ใส่กรอบ เปลี่ยนสี/ลายน้ำ หรือเปลี่ยนปกอาจไม่พบ ไม่มีการรับรองว่าค้นพบทุกกรณี ชื่อไฟล์และ Video ID/publicId ไม่ถูกแก้เพื่อให้ตรงกัน
- อ่านครั้งละ 16 วิดีโอ เรียงด้วย ID และจำขอบเขต ID สูงสุดเมื่อเริ่ม ไม่โหลดไฟล์วิดีโอ เปรียบเทียบปกหนึ่งครั้งกับบทความสูงสุด 25 รายการในหน้าที่เปิด แสดงยอดตรวจ/เทียบได้/ไม่มีปก/อ่านไม่ได้ พร้อมเหตุผลแยกตามรายการ การเปลี่ยนหน้าหรือหยุดจะยกเลิกคำขอใน browser; server อาจทำ page ที่เริ่มแล้วต่อจนจบ แต่ไม่เริ่ม page ถัดไป
- รองรับ JPEG/PNG/WebP ภาพนิ่ง สูงสุด 5 MiB และ 20 ล้านพิกเซล อ่านผ่าน HTTP(S) พอร์ตมาตรฐานและ public IPv4 เท่านั้น ป้องกัน DNS rebinding ด้วยการ pin IP และตรวจทุก redirect ไม่ส่ง cookie/credential ไปเว็บไซต์ต้นทาง; 401/403, timeout, IPv6-only หรือภาพไม่รองรับเป็นข้อจำกัด ไม่ใช่ข้อสรุปว่าไม่ใช่ภาพเดียวกัน
- แสดงรูปผ่าน JPEG thumbnail ที่ decode ใหม่ ไม่แสดง SVG/HTML/iframe จากไฟล์นำเข้า มี cache ในหน่วยความจำสูงสุด 64 MiB/8192 ภาพ อายุ 10 นาที และ cache ความผิดพลาด 1 นาที; รูปที่แทนที่ URL/key เดิมอาจเห็นค่าเก่าจนหมดอายุ
- Endpoint `POST /metadata-import/batches/:id/cover-scan` ใช้ ADMIN/SYSTEM + session + CSRF เช่นเดียวกับการนำเข้า ตอบ `private, no-store`; จำกัดสองคำขอพร้อมกันต่อ API process และอ่านรูปพร้อมกันครั้งละสี่รูปต่อคำขอ ไม่มี DB/R2 writes จากการค้นหา

การเปรียบเทียบนี้เพิ่มการอ่านรูปปกจาก WordPress และ storage และใช้ CPU decode รูป ต้องเริ่มตรวจ production 1–2 บทความ รวมทั้งเวลา/หน่วยความจำ/ผลรายการจริงก่อนขยายงาน การทดลองในเครื่องใช้รูปทรงทั่วไปและ storage double ยังไม่ยืนยันการค้นพบภาพจริงของผู้ใช้หรือการอ่าน R2 production

ไม่เพิ่ม schema/migration และไม่เปลี่ยน media/iframe/access contracts; backup/restore migration และ worker draining ไม่เกี่ยวกับการเปลี่ยนนี้เพราะไม่มีการแก้ฐานข้อมูลหรือส่งงาน worker การย้อนรุ่นใช้ revision ก่อนเพิ่ม cover scan โดยไม่มีข้อมูลให้ย้อนคืนจาก scan การอนุมัติ metadata ยังคงใช้ transaction/audit/rollback เดิม

การทดสอบ: metadata parser/matching/image/network/HTTP+PostgreSQL 59 tests ผ่าน และ API/admin TypeScript ผ่าน; browser จริง Next+Nest+PostgreSQL ผ่านการค้นหาจากรูปโดยไม่มี ID, ภาพคู่, desktop/mobile, หยุด/เริ่ม, การเล่นก่อนอนุมัติ, apply และ rollback ด้วยข้อมูลจำลอง ชุด API รวมเคยพบ Google Drive ciphertext tamper test เดิมล้มเหลวหนึ่งกรณี (นอกส่วนที่แก้) จึงไม่รายงานว่าชุดรวมผ่านทั้งหมด ภาพตัวอย่างอยู่ใน `artifacts/metadata-import/cover-review-*.png`

Windows ที่ worktree กับ Next dependencies อยู่ต่างไดรฟ์อาจ build เส้นทาง `./D:/...` ผิด: browser harness รองรับ `METADATA_TEST_ADMIN_CWD` ให้ชี้สำเนา admin จาก revision เดียวกันบนไดรฟ์ของ dependencies โดยไม่เปลี่ยน config production เปิดโหมดรูปจำลองด้วย `METADATA_TEST_COVERS=1`

### การวินิจฉัยรายการที่ไม่พบคู่และคำอธิบาย (12 พฤศจิกายน 2026)

- CSV จากปลั๊กอิน RetroTube เป็นสรุปรายการ ไม่มีเนื้อหาบทความหรือคำอธิบาย SEO ให้ใช้ JSON ที่ export คู่กันเมื่อต้องการอัปเดตคำอธิบาย การอัปโหลด CSV ใหม่ที่ไม่มีคำอธิบายจะแจ้งข้อจำกัดนี้
- JSON backup รุ่น 1 เก็บ `description` ของ attachment ที่ระดับบทความ ตัวนำเข้าจะแยกความหมายจากโครงสร้าง `featured_image_id`, `image_provenance`, `content_raw`, `excerpt_raw` และเก็บคำอธิบายภาพใน raw เท่านั้น เลือกคำอธิบายบทความจาก excerpt ที่ไม่ว่าง ตามด้วย content และ description_sources ตามลำดับ โดยคงข้อความ HTML/shortcode เดิม
- JSON/CSV ทั่วไปที่ระบุ `description` โดยตรงยังคงใช้ค่านั้น รวมถึงค่าว่างที่ผู้ใช้ระบุเอง ไม่เติมคำอธิบายใหม่โดยพลการ
- Batch เดิมเก็บ normalized data ตอนอัปโหลด จึงต้องอัปโหลด JSON เป็น batch ใหม่หลัง deploy การแก้นี้ ไม่มีการแก้ batch หรือข้อมูลวิดีโอเดิมอัตโนมัติ และไม่ต้องเพิ่ม migration
- ผลค้นหา 0 หมายถึงไม่พบคู่ในรายการที่ API อนุญาตให้เลือก ไม่ได้ยืนยันว่าไฟล์ไม่มีอยู่ใน R2 หรือข้อมูลสูญหาย หาก ID เดิมหายจากฐานข้อมูลต้องตรวจข้อมูลกู้คืน/ตาราง mapping เดิมก่อน ไม่เดาคู่จากชื่อหรือสลับโดเมน iframe

ตรวจในเครื่องสำหรับการแก้นี้: parser/matching 20 tests ผ่าน และ API TypeScript ผ่าน ครอบคลุมคำอธิบายภาพที่ว่าง/ไม่ว่าง, excerpt ว่าง, ข้อความต้นฉบับ HTML/ภาษาไทย, SEO fallback, explicit empty และ CSV สรุป การแก้นี้ยังไม่ได้ยืนยันหลัง deploy production

1. เปิดเมนู **นำเข้า Metadata** ด้วยบัญชี ADMIN/SYSTEM เลือก JSON เต็มจาก RetroTube หรือ CSV UTF-8 แล้วกด **อัปโหลดและค้นหาคู่**
2. ระบบแสดงชื่อเรื่อง/คำอธิบายจากไฟล์และวิดีโอที่พบคู่ใต้แต่ละบทความทันที ไม่ต้องเปิดตรวจแยกทีละแถว รายการแบ่งหน้าละ 25 บทความและค้นหาให้อัตโนมัติเมื่อเปิดหน้า รายการไม่พบคู่/ข้อมูลผิด/ค้นหาล้มเหลวจะแสดงเหตุผลแยกกัน
3. กด **เล่นวิดีโอนี้เพื่อตรวจสอบ** ในคู่ที่ต้องการ หากไม่มีคู่ให้ค้นหา Video ID/publicId แบบตรงกันเอง ผลค้นหาและการเล่นไม่เขียน mapping หรือเปลี่ยน Video แม้ไฟล์ระบุ target_video_id ก็ยังต้องตรวจและอนุมัติ
4. เมื่อเล่นและตรวจว่าเนื้อหาตรงแล้ว ติ๊ก **ฉันเล่นตรวจแล้ว และยืนยันว่าเนื้อหาตรงกับบทความนี้** เลือกอัปเดตชื่อเรื่องและ/หรือคำอธิบายจากไฟล์ ค่าว่างหรือไม่มีข้อมูลจะคงค่าเดิม ไม่มีช่องเขียนข้อความใหม่หรือเปลี่ยนหมวดหมู่/รูปในขั้นตอนอนุมัตินี้
5. กด **ตรวจชื่อเรื่อง/คำอธิบายก่อนอนุมัติ** ระบบอ่านค่าจาก batch ที่เก็บไว้บนเซิร์ฟเวอร์และแสดง before/after ด้านล่าง หากเปลี่ยนวิดีโอหรือฟิลด์ที่เลือก การยืนยันเนื้อหาและรายการรออนุมัติของแถวนั้นจะถูกล้าง
6. ตรวจข้อมูลก่อน–หลัง ติ๊ก **ฉันอนุมัติให้ 3x-storage อัปเดตชื่อเรื่อง/คำอธิบายตามข้อมูลก่อน–หลังนี้** แล้วกด **อนุมัติและบันทึก** ครั้งละ 1–2 รายการ
7. การบันทึกใช้ transaction ต่อรายการ พร้อมประวัติ/ผู้ดำเนินการ/เวลา/batch ID และเวลาที่ผู้ใช้ยืนยันเนื้อหาตรงกัน ถ้าข้อมูลเปลี่ยนหลัง preview ต้องตรวจใหม่ ไม่ทับงานที่แก้ตามมา
8. เปิดประวัติด้านล่างเพื่อตรวจและย้อนคืนเฉพาะรายการเดิมได้ โดยต้องยืนยันย้อนคืนและผ่านการตรวจ conflict

ปุ่มเปิดไฟล์สำหรับเล่นแทนต้นฉบับใช้ playback/HLS ที่มีใน App เมื่อไฟล์ต้นฉบับเล่นไม่ได้ การเล่นล้มเหลวไม่ได้ยืนยันว่าไฟล์เสีย ไม่มีการเปิด iframe ต้นทาง

คำอธิบายใช้ description หากมี หรือ excerpt_raw/content_raw ตามข้อมูล normalized ที่แสดงพร้อมชื่อฟิลด์ต้นทาง เก็บ HTML/shortcode เป็นข้อความเดิม JSON เหมาะกับงานนี้กว่า CSV summary ของ exporter ซึ่งอาจไม่มีคำอธิบาย

## รูปแบบและขอบเขตข้อมูล

- JSON รับ array หรือ `{ records: [...] }` จากปลั๊กอินเดิม พร้อมเก็บ header อื่นไว้ใน batch; site_url ระดับไฟล์ใช้เป็น fallback ได้
- ฟิลด์พื้นฐาน: `site_url`, `post_id`, `title`, `description`, `categories[]`, `tags[]`, `image_url`, `target_video_id` (optional)
- CSV คอลัมน์ categories/tags ต้องใส่ JSON array ในเซลล์ เช่น `["ท่องเที่ยว","ความรู้"]` โดย quote ตาม CSV ไม่เดาโดยแบ่งข้อความที่ comma
- รองรับ BOM, ภาษาไทย, quote, comma และ newline ภายในเซลล์ CSV; CSV summary จาก exporter ไม่มีข้อมูลครบเท่า JSON และอาจมี apostrophe ที่ป้องกันสูตร จึงแนะนำ JSON สำหรับข้อมูลหลัก ไม่ลบ apostrophe/แก้ข้อความต้นทางโดยเดา
- จำกัด 10 MiB และ 500 records ต่อไฟล์ รายการแสดงครั้งละ 25 แถว; batch selector แสดง 30 batch ล่าสุด ส่วน batch ที่มี ID ยังเรียกผ่าน API ได้
- คีย์ต้นทางคือ site URL ที่ normalize host/port/trailing slash + post_id; ยังคง scheme และ path เพื่อไม่รวมเว็บไซต์คนละแห่งโดยเดา site_url ไม่รับ credentials/query/fragment และ post_id ต้องเป็น integer บวกใน safe integer range
- source key ซ้ำในไฟล์: ทุกแถวที่ซ้ำเป็น INVALID ไม่เลือกผู้ชนะให้; รูปแบบไฟล์เสีย/เกินขนาดปฏิเสธทั้งไฟล์ ส่วนความผิดพลาดในรายการแสดงต่อแถว เก็บ raw สำหรับตรวจ แก้ไฟล์แล้วนำเข้าใหม่ได้
- หน้าจออนุมัติ batch ปัจจุบันอัปเดตเฉพาะ `Video.title` (200 ตัวอักษร) และ `Video.description` (100,000 ตัวอักษร) จากข้อมูลในไฟล์ API preview เดิมยังรองรับ categoryId/imageUrl สำหรับความเข้ากันได้ แต่ review-preview ใหม่ปฏิเสธฟิลด์เหล่านั้นและค่าข้อความที่ส่งจาก browser
- ขั้นตอนอนุมัติ batch ไม่เขียนทับด้วยค่าว่าง หากทั้งสองฟิลด์ว่างจะไม่เปิดให้อนุมัติ API preview เดิมยังรองรับ explicit clear ตามสัญญาเดิม
- รูป URL เป็น **metadata เพิ่มเติม** ไม่ดาวน์โหลดรูป ไม่ทำหน้าที่แทนปกใน player และไม่เปลี่ยน `posterKey` หรือ `VideoFile` รูปจะถูกแสดงเป็นข้อความในหน้าตรวจสอบ
- schema เดิมมี categoryId เดียวและยังไม่มี tags relation: ทุกหมวดหมู่ แท็ก actor/custom taxonomy รวม HTML/shortcode/embed/custom fields เก็บครบใน raw source และแสดงข้อจำกัด ไม่ตัดเหลือหมวดหมู่แรกเงียบ ๆ
- source mapping ที่บันทึกแล้วจะไม่เปลี่ยนไปวิดีโออื่นโดยปริยาย ต้องย้อนคืนการจับคู่เดิมจนไม่มี active mapping ก่อน แล้วเลือกคู่ใหม่เอง
- ไม่มีการสร้าง Video ใหม่ ไม่มี fetch/execute iframe หรือ HTML จากไฟล์ การค้นหา ID/บันทึกไม่เรียก storage/R2; การเทียบภาพอ่านเฉพาะรูปปก และปุ่มเล่นใช้ signed preview เดิม ไม่แตะ ID/publicId/เจ้าของ/storage keys/ไฟล์สื่อ/access domains

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
- Raw source เป็นข้อมูลภายใน อ่านได้เฉพาะผู้ดูแล ไม่ใช้ dangerouslySetInnerHTML ไม่ render iframe; URL รูปถูกอ่านเฉพาะบริการเทียบภาพที่จำกัด public IP/ชนิด/ขนาด และแสดง thumbnail JPEG ที่ decode ใหม่
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


## การตรวจ batch และอนุมัติสองฟิลด์ (ปรับปรุงล่าสุด)

GET batches/:id/review ค้นหาให้สูงสุด 25 แถวต่อหน้า โดยประมวลผลพร้อมกันไม่เกิน 3 แถว ความล้มเหลวต่อแถวรายงานแยกจากไม่พบคู่ ส่วน POST rows/:id/review-preview ต้อง contentConfirmed=true และรับเฉพาะ targetVideoId กับ fields ชื่อเรื่อง/คำอธิบาย อ่านค่าจาก normalizedJson บน server โดยตรง ไม่รับ values หรือ allowEmpty จาก client

UI รอ event playing ก่อนเปิด checkbox ยืนยัน การยืนยันเป็นคำรับรองของผู้ใช้ว่าเนื้อหาตรงกัน ไม่ใช่การพิสูจน์อัตโนมัติว่ารับชมทั้งเรื่อง Server บันทึก contentReviewedAt ลง preview และ audit เมื่อ apply โดยไม่เพิ่ม schema

ดูผลทดสอบรอบนี้ที่ artifacts/metadata-import/batch-review-test-results.json และภาพ batch-review-desktop.png / batch-review-mobile.png คำสั่ง browser-test เดิมเรียก harness ใหม่ที่ใช้ Next/Nest/PostgreSQL จริง และวิดีโอจำลอง localhost (storage URL เป็น test double ไม่ใช่ R2 production)
