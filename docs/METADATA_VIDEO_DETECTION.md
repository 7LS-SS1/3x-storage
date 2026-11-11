# ตรวจจับด้วยวิดีโอ

เพิ่มโหมดแยกในหน้า **นำเข้า Metadata** สำหรับจับคู่รูปจาก WordPress กับเฟรมจริงของวิดีโอที่ไม่มีปก (`posterKey = null`) ใน 3x-storage เท่านั้น

## วิธีใช้

1. เลือก **ตรวจจับด้วยวิดีโอ** ก่อนอัปโหลดหรือเปิด batch เดิม หากโหมดรูปปกกำลังทำงาน ให้กดหยุดก่อนเปลี่ยนโหมด
2. เลือกคะแนนขั้นต่ำ 70–95/100 (เริ่มต้น 80) และ 12, 30 หรือ 60 เฟรมต่อคลิป (เริ่มต้น 30)
3. กด **เริ่มตรวจจับด้วยวิดีโอ** และเปิดแท็บไว้ ระบบอ่านทุกรายการ PENDING ของ batch ในรอบเดียว การเปลี่ยนหน้าแสดงผลไม่เริ่มตรวจใหม่
4. ดูคู่ที่พบ: รูปต้นทาง, เฟรมจริง, คะแนน, ช่องของรูปที่ตรง และตำแหน่งเวลา แสดง 5 วิดีโอที่คะแนนสูงสุดต่อบทความ
5. กด **เล่นตรวจจาก … วินาที** ยืนยันเนื้อหา แล้วตรวจค่าชื่อเรื่อง/คำอธิบายก่อนอนุมัติด้วยกระบวนการเดิม

คะแนนเป็นค่าความคล้ายของสีและโครงสร้างภาพ ไม่ใช่ความน่าจะเป็นว่าจับคู่ถูกต้อง รูปเต็มและรูปแบ่งแนวตั้งเท่ากัน 2/3 ช่องถูกเปรียบเทียบแยกกัน รองรับตัวอย่างภาพสามช่องที่ผู้ใช้ระบุ ไม่ใช้ชื่อเรื่องหรือการจดจำใบหน้าเพื่อยืนยันคู่

โหมดนี้ไม่บันทึกอัตโนมัติ แม้คะแนนเป็น 100 การจับคู่รูปปกตรงทุก byte ในโหมดเดิมยังเป็นเส้นทางแยกต่างหาก

## ขอบเขตและข้อจำกัด

- เลือกเฟรมเป็นช่วงเวลาสม่ำเสมอทั่วคลิป ไม่ได้ตรวจทุกเฟรม จึงอาจพลาดภาพที่อยู่ระหว่างช่วงที่เลือก การไม่พบคู่ไม่ใช่หลักฐานว่าเป็นคนละคลิป
- รูปที่ถูกครอปมาก, ช่องไม่เท่ากัน, ตารางหลายแถว, กลับซ้ายขวา, ลายน้ำขนาดใหญ่ หรือเปลี่ยนสีมาก อาจได้คะแนนต่ำ ต้องตรวจด้วยคน คะแนนยังไม่ได้สอบเทียบกับคลัง production
- ข้ามภาพเฟรมสีเรียบ/ดำเพื่อช่วยลดคู่ผิดจากภาพช่วงเปลี่ยนฉาก
- ตรวจเฉพาะสถานะ UPLOADED/PROCESSING/READY ที่ไม่มีปกและยังไม่ถูกลบ ใช้ VideoFile ORIGINAL ล่าสุด หรือ originalKey เป็น fallback; ไม่ใช้ HLS/iframe/URL วิดีโอจากไฟล์นำเข้า
- รูปต้นทางต้องอยู่ใน `image_url` ที่ parser อ่านได้จาก JSON/CSV และผ่านการป้องกัน SSRF เดิม
- รองรับ container ที่ FFmpeg อ่านได้ใน allowlist: MOV/MP4, Matroska/WebM, AVI, FLV, MPEG, MPEG-TS; ไฟล์เสีย/ไม่มี duration/ยาวเกิน 24 ชั่วโมง/ไม่มี original จะแสดงเหตุผลว่าอ่านไม่ครบ
- งานและผลจับคู่เป็นข้อมูลชั่วคราวในหน่วยความจำ ต้องเปิดแท็บไว้ Refresh/รีสตาร์ต API ต้องเริ่มตรวจใหม่ ไม่มีดัชนีเฟรมถาวร ควรใช้ API instance เดียวหรือ sticky routing ระหว่างงาน
- หยุดหลัง request ปัจจุบันเสร็จ (อ่านเฟรมสูงสุดประมาณ 20 วินาที) ผลที่อ่านสำเร็จยังอยู่ในหน้าเว็บ กดเริ่มใหม่จะตรวจตั้งแต่ต้น

## การจำกัดทรัพยากรและสิทธิ์

- Session/admin/CSRF guards และ `Cache-Control: private, no-store` ทั้ง endpoint ตรวจและหยุด ผูก scan กับผู้ใช้และ batch
- อ่านครั้งละ 1 รูปต้นทาง/1 probe/1 เฟรม ต่อ request; มี active reader เดียวต่อ API process, ไม่เกิน 4 sessions และหมดอายุเมื่อไม่ใช้งาน 1 ชั่วโมง
- อ่าน object storage ด้วย Range จาก key ที่เลือกในฐานข้อมูล ผ่าน relay เฉพาะ loopback/โทเค็นสุ่ม ไม่ส่ง credential หรือ signed storage URL ให้ FFmpeg/เบราว์เซอร์
- จำกัดอ่าน 64 MiB และ 20 วินาทีต่อ probe/frame, สูงสุด 64 range requests; จำกัด stdout 2 MiB, thumbnail และ subprocess threads; ไม่เก็บวิดีโอทั้งไฟล์บนดิสก์ ไม่เขียน object กลับ
- คลังขนาดใหญ่ยังใช้เวลา, CPU และ bandwidth มาก การเลือก 60 เฟรมมีเพดานอ่านสูงสุดประมาณ 3.8 GiB ต่อคลิปรวม probe (โดยทั่วไปน้อยกว่า ขึ้นกับการ seek/รูปแบบไฟล์) ต้องตรวจโหลดจริงก่อนใช้วงกว้าง
- FFmpeg รับเฉพาะ protocol/container allowlist และไม่รันผ่าน shell; อ่านไฟล์ล้มเหลวไม่เผย storage credentials
- Endpoint ตรวจไม่มีการเขียน metadata การอนุมัติใช้ preview/transaction/audit/rollback เดิม จึงไม่เปลี่ยน Video ID, publicId, เจ้าของ, storage key, ไฟล์สื่อ, iframe หรือสิทธิ์การเข้าถึง

## Deploy / rollback

- ต้อง rebuild/redeploy **API และ admin**: Dockerfile API เพิ่ม FFmpeg/FFprobe แล้ว เครื่อง dev ที่รันตรงต้องมี `ffmpeg`/`ffprobe` ใน PATH หรือใช้ `FFMPEG_PATH`/`FFPROBE_PATH`
- ไม่มี schema change หรือ migration ใหม่ ไม่แก้ข้อมูลเก่าในขั้น deploy จึงไม่มี data backfill/restore สำหรับการค้นหา
- ไม่ใช้หรือแก้ queue/transcoding worker: ไม่ต้อง drain worker สำหรับฟีเจอร์นี้ ก่อนเปลี่ยน API ให้หยุดการสแกนที่กำลังทำอยู่ เพราะ session ชั่วคราวไม่ข้ามการ restart
- Canary: ตรวจ generic batch และคลิปไม่มีปก 1 รายการก่อน ดูสิทธิ์, แสดงเฟรม/เวลา, เล่นจากเวลา, การอนุมัติและประวัติ พร้อมโหลด API/bandwidth จริง
- Rollback code: กลับ image/API/admin รุ่นก่อนหน้า งานสแกนชั่วคราวจะหาย แต่ไม่มีไฟล์สื่อให้กู้ ส่วน metadata ที่ผู้ดูแลอนุมัติแล้วให้ย้อนคืนในประวัติเดิมตามปกติ ไม่ rollback DB ทั้งระบบ

## ผลตรวจในเครื่อง 2026-11-12

- API 49 tests ผ่าน: วิดีโอใหม่ 9 tests, cover/image/network/exact-auto/whole-batch/export เดิม 40 tests
- Admin 8 tests ผ่าน: โหมดวิดีโอ 3 และโหมด exact cover เดิม 5
- TypeScript API/admin ผ่าน
- FFmpeg/FFprobe จริงใน Docker, network disabled, CPU 1/memory 512 MiB: สร้าง MP4 จำลอง 6 วินาที, อ่าน 3 เฟรมผ่าน range relay, พบช่องกลางของ collage ที่สร้างจากเฟรมแยกอีกครั้ง **97.2/100**, 12 Range requests, อ่าน 1,193,948 bytes; storage adapter เป็นไฟล์จำลอง ไม่ใช่ R2 จริง
- Chromium + React components จริง, API จำลอง: เลือกโหมด/70 คะแนน/12 เฟรม, เริ่มตรวจด้วยปุ่ม, คงผลของรายการที่ 26 เมื่อเปลี่ยนหน้า, ไม่เรียก auto-apply, เล่น MP4 จำลองจริงและ seek ไป 2.5 วินาที, ต้องเล่นและติ๊กยืนยันก่อนเปิดขั้น preview
- ตรวจ screenshot desktop/mobile ใน `test-results/metadata-video/` (ไม่ commit ไฟล์สื่อทดสอบ)

ยังไม่ได้ตรวจ: full production image/deployment, ฐานข้อมูล/คลัง R2 จริง, ความแม่นยำหรือเวลาสแกนคลังจริง, การจับคู่รูป URL ที่ผู้ใช้ส่งกับวิดีโอต้นฉบับจริง และผลการอนุมัติบน production ห้ามตีความผลจำลองว่าเจอคลิปจริงแล้ว

## รันทดสอบซ้ำ

```powershell
node apps/api/node_modules/vitest/vitest.mjs run src/metadata-video.test.ts --root apps/api
node apps/admin/node_modules/vitest/vitest.mjs run components/metadata-video-scan.test.ts --root apps/admin
docker build -f scripts/metadata-video-runtime.Dockerfile -t 3x-metadata-video:test .
```

รัน image ทดสอบโดย mount `apps/api/src` → `/workspace/apps/api/src` และ `scripts/metadata-video-runtime-test.cjs` → `/workspace/scripts/metadata-video-runtime-test.cjs` แบบ read-only ใช้ `--network none --cpus 1 --memory 512m` ห้ามส่ง env production เข้าชุดทดสอบ

Browser test: สร้าง MP4 ทั่วไป 6 วินาทีด้วย FFmpeg `testsrc2=size=320x240:rate=12`, codec libx264/pix_fmt yuv420p เก็บที่ `test-results/metadata-video/generic.mp4` หรือกำหนด `METADATA_VIDEO_FIXTURE` จากนั้นรัน `node scripts/metadata-video-browser-test.cjs`

การเลือก input seek และ protocol restrictions อ้างอิง [FFmpeg options](https://ffmpeg.org/ffmpeg.html) และ [FFmpeg protocols](https://ffmpeg.org/ffmpeg-protocols.html)
