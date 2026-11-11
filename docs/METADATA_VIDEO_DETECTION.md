# ตรวจจับด้วยวิดีโอ — งานเบื้องหลังและดัชนีเฟรม

โหมดแยกในหน้า **นำเข้า Metadata** จับคู่รูป WordPress กับเฟรมจริงของวิดีโอที่ไม่มีปก (`posterKey = null`) ใน 3x-storage ไม่ใช้ชื่อเรื่องหรือการจดจำใบหน้าเพื่อยืนยันคู่

## วิธีใช้

1. เลือก **ตรวจจับด้วยวิดีโอ** ก่อนอัปโหลดหรือเปิด batch เดิม หากโหมดรูปปกทำงานอยู่ให้กดหยุดก่อนเปลี่ยนโหมด
2. เลือกคะแนนขั้นต่ำ 70–95/100 (เริ่มต้น 80) และ 12, 30 หรือ 60 เฟรมต่อคลิป (เริ่มต้น 30)
3. กด **เริ่มตรวจจับด้วยวิดีโอ** ครั้งเดียว ระบบเก็บงานในฐานข้อมูล ตรวจทุกแถว PENDING ของ batch กับรายการวิดีโอที่ไม่มีปก ณ ตอนเริ่มงาน ปิดแท็บหรือเปลี่ยนหน้าได้ ไม่เริ่มตรวจซ้ำ
4. กลับมาเลือกโหมดและ batch เดิมด้วยบัญชีเดิมเพื่อดูงาน ปุ่ม **พักงานตรวจวิดีโอ** หยุดหลังอ่านเฟรมปัจจุบัน **ทำต่อจากงานเดิม** ใช้การตั้งค่าเดิมและเฟรมที่อ่านสำเร็จแล้ว
5. ดูรูปต้นทาง เฟรมจริง คะแนน ช่องของรูปและตำแหน่งเวลา แสดงสูงสุด 5 วิดีโอต่อบทความ กด **เล่นตรวจจาก … วินาที** แล้วตรวจ/อนุมัติชื่อเรื่องและคำอธิบายตามกระบวนการเดิม
6. **ลองรายการที่ผิดพลาดอีกครั้ง** ใช้หลังจบรอบหรือพักงานจนงานปัจจุบันหยุดแล้ว หากรูปต้นทางเคยอ่านไม่ได้ ระบบเทียบวิดีโอที่เสร็จแล้วกับรูปที่กู้กลับมาได้ด้วย โดยใช้เฟรมที่เก็บไว้
7. **เริ่มรอบใหม่ด้วยค่าที่เลือก** แทนผลแนะนำเดิมของบัญชีนี้ใน batch นี้ ใช้เมื่อต้องการเปลี่ยนคะแนน/จำนวนเฟรม หรือรวมวิดีโอใหม่ แคชเฟรมและประวัติอนุมัติไม่ถูกลบ

คะแนนคือความคล้ายของสีและโครงสร้าง ไม่ใช่โอกาสจับคู่ถูกต้อง 80% ภาพเต็มและภาพแบ่งแนวตั้งเท่ากัน 2/3 ช่องเปรียบเทียบแยกกัน **โหมดวิดีโอไม่อนุมัติอัตโนมัติ แม้คะแนน 100** โหมดรูปปกตรงทุก byte ยังคงเป็นกระบวนการเดิม

## ประสิทธิภาพและข้อจำกัด

- 30 เฟรมคือ 30 ตำแหน่งกระจายตลอดคลิป ไม่ใช่เวลา 30 วินาที ยังคงจำนวนเฟรมที่ผู้ใช้เลือก ไม่ลดการครอบคลุมเพื่อให้ตัวเลขดูเร็วขึ้น
- worker แยกจาก API/admin และ transcoding worker เริ่มต้นอ่านพร้อมกัน **2 คลิป** ไม่มีเวลารอ browser 700 ms ระหว่างเฟรมอีกต่อไป
- หลังสร้างดัชนีครั้งแรก batch ถัดไปใช้เฟรมเดิมได้เมื่อ object version และตำแหน่งเวลาตรงกัน ยังต้องอ่าน HEAD และเปรียบเทียบรูปต้นทางใหม่ รอบแรกยังใช้เวลา/CPU/bandwidth มาก
- Cache identity รวมเวอร์ชันอัลกอริทึม, Video ID, original storage key, bucket, endpoint, ETag และขนาดไฟล์ ใช้ If-Match กับทุก Range GET พร้อมตรวจ version อีกครั้งก่อนบันทึกผล จึงไม่ใช้ดัชนีเก่าเมื่อไฟล์เปลี่ยน
- เลือก ORIGINAL ล่าสุด หรือ originalKey fallback เฉพาะสถานะ UPLOADED/PROCESSING/READY ที่ไม่มีปกและยังไม่ลบ ไม่อ่านวิดีโอจาก URL ในไฟล์นำเข้า ไม่ใช้ HLS/iframe
- Cache fingerprint/thumbnail เก็บใน PostgreSQL อายุเมื่อไม่ใช้ 30 วัน และเพดานเริ่มต้น 100,000 เฟรม ล้างครั้งละไม่เกิน 5,000 รายการต่อนาที จึงอาจเกินเพดานชั่วคราว ต้องเผื่อพื้นที่ DB และติดตามขนาดจริง ประวัติงาน/ผลแนะนำยังคงอยู่
- เก็บ checkpoint หลังทุกเฟรม งานที่ล้มระหว่าง publish ผลจะ rollback transaction แต่เฟรมที่อ่านแล้วใช้ต่อได้ งานที่ worker หายจะรับใหม่หลัง lease หมดอายุ 90 วินาที พร้อม token กัน worker เก่าเขียนผล
- คิวใช้ PostgreSQL row lock/SKIP LOCKED และ advisory lock เพื่อจำกัดงาน active ข้าม worker instances ควรตั้ง concurrency เท่ากันทุก instance ไม่ใช้ BullMQ/Redis queue ของงานแปลงวิดีโอ
- เปรียบเทียบแต่ละเฟรมกับภาพเต็ม/ช่องของรูป ไม่ตรวจทุกเฟรม จึงพลาดภาพระหว่างจุดตรวจได้ การไม่พบคู่ไม่ได้ยืนยันว่าเป็นคนละคลิป รูปครอปมาก ช่องไม่เท่ากัน ตารางหลายแถว กลับด้าน ลายน้ำ หรือสีเปลี่ยนมากอาจได้คะแนนต่ำ
- ข้ามภาพสีเรียบ/ดำ ค่า threshold ยังไม่ได้สอบเทียบกับคลัง production ไม่ได้ยืนยันเวลาสแกน 2,299 คลิปหรืออัตราเร็วเพิ่มเป็นกี่เท่า
- งาน v1 ที่ทำไปแล้ว เช่น 10/2299 เก็บผลในหน่วยความจำเดิม จึงย้าย checkpoint มารุ่นนี้ไม่ได้ ต้องเริ่มรอบใหม่ครั้งแรก หลังจากนั้นจึงพัก/ทำต่อได้

## สิทธิ์และขอบเขตข้อมูล

- ทุก endpoint ใช้ session/admin/CSRF guards และ private no-store งานผูกกับ actor และ batch การเปิดอ่านสถานะไม่สร้างงาน
- รูปต้นทางผ่าน SSRF protection เดิม วิดีโออ่านจาก key ใน DB ผ่าน loopback relay/โทเค็นสุ่ม ไม่ส่ง credentials/signed storage URL ให้ FFmpeg หรือ browser
- จำกัด 64 MiB / 20 วินาที / 64 requests ต่อ probe หรือเฟรม จำกัด decoder threads/stdout และ protocol/container allowlist ไม่มีไฟล์วิดีโอเต็มบนดิสก์ ไม่เขียน R2 กลับ
- 60 เฟรมรวม probe มีเพดานประมาณ 3.8 GiB ต่อคลิปก่อน retry (ปกติน้อยกว่า ขึ้นกับการ seek) อย่าเพิ่ม concurrency โดยไม่ดูโหลดจริง
- Worker เขียนเฉพาะตารางงาน/ดัชนี/ผลแนะนำใหม่ ไม่แก้ Video, VideoFile, publicId, เจ้าของ, metadata, storage keys, iframe หรือสิทธิ์สื่อ การอนุมัติสองฟิลด์ยังใช้ transaction/audit/rollback เดิม
- Legacy endpoint video-scan ยังอยู่เพื่อไม่เปลี่ยนสัญญา API เดิม แต่หน้าใหม่ใช้ video-job ทั้งหมด หยุดแท็บรุ่นเก่าก่อน deploy เพื่อไม่ให้ตรวจซ้อน

## Deploy / migration / rollback

1. สำรอง PostgreSQL และยืนยันวิธีกู้คืนตามคู่มือ BACKUP_AND_RESTORE ก่อน production migration เฝ้าดู API, playback, upload และ transcoding ที่กำลังทำงาน
2. หยุดการตรวจเฟรม v1 ก่อนเปลี่ยนรุ่น งานใหม่ใช้ตารางเพิ่ม 5 ตารางใน migration **20261112120000_metadata_video_jobs** ไม่มี backfill หรือแก้ Video/VideoFile/UploadSession สิทธิ์/ตัวตนเดิม ต้อง migrate ก่อนรัน API ใหม่
3. Rebuild/redeploy **migrate, API, admin และ metadata-worker** จาก revision เดียวกัน Compose เพิ่ม service/target metadata-worker แล้ว ขึ้นหลัง migrate สำเร็จ ไม่ต้องแก้ WordPress plugin
4. เริ่ม METADATA_VIDEO_CONCURRENCY=2 (ยอมรับ 1–4) และ METADATA_FRAME_CACHE_LIMIT=100000 (1,000–1,000,000) Compose จำกัด CPU 2 / RAM 1 GiB / tmpfs 64 MiB ให้ service ใหม่
5. Canary: ใช้คลังทดสอบหรือ staging ที่มีวิดีโอไม่มีปก 1–2 คลิปก่อน เพราะหนึ่ง batch จะสแกนวิดีโอไม่มีปกทั้งหมด ตรวจ session/CSRF, worker heartbeat, pause/resume/restart, การใช้ cache ใน batch ถัดไป, เวลาเล่นจากเฟรม, preview/audit/rollback และโหลด DB/CPU/R2 เทียบก่อนเริ่ม
6. production ต้องยืนยัน migrate success และ metadata-worker healthy จึงเริ่มงานวงกว้าง Push Git ไม่เท่ากับ deploy หน้าจอแจ้งเตือนเมื่อไม่มี progress เกิน 90 วินาที
7. เมื่ออัปเดต worker ภายหลัง ใช้ SIGTERM และ stop_grace_period 45s รอเฟรมปัจจุบัน/คืน lease ไม่ต้อง drain queue แปลงวิดีโอเพราะไม่ได้เปลี่ยน worker เดิม ถ้าถูก kill งานจะกลับมาหลัง lease หมดอายุ
8. Rollback: พักงานและหยุด metadata-worker จากนั้นคืน API/admin images รุ่นก่อน คงตารางใหม่ไว้เพื่อรักษา checkpoint ไม่ทำ destructive down migration และไม่ restore DB ทั้งระบบทับงานอัปโหลดที่เกิดใหม่ Metadata ที่เคยอนุมัติให้ใช้ประวัติย้อนคืนเดิม

Migration นี้ตั้งใจไม่แก้ schema drift เดิมที่พบใน FK PlaybackSession และชื่อ index GoogleDriveImport ตารางที่เพิ่มมี FK เฉพาะกลุ่ม metadata

## ผลตรวจในเครื่อง 2026-11-12

- ฐาน PostgreSQL 17 แยก video_jobs_test: migrate deploy 9 migrations สำเร็จ รวม migration ใหม่
- Integration จริง 9 tests: start ซ้ำ, snapshot เฉพาะไม่มีปก, source barrier, cap พร้อมกัน 2 งาน, pause/resume ด้วย processor ใหม่, lease หมดอายุ/กัน worker เก่า, transaction fault injection, retry รูปต้นทาง, top-5 ระหว่างงานพร้อมกัน, restart คงแคช และ guard/input validation
- ภาพ/ตัวอ่านเฟรมใน integration เป็นข้อมูลจำลอง: cold 12 decodes, batch ถัดไป **0 decodes เพิ่ม**, เปลี่ยน ETag แล้วอ่านใหม่ 12 decodes ไม่ถือเป็น benchmark เวลาบน R2
- Regression API 51 tests และ admin 8 tests ผ่าน; TypeScript API/admin ผ่าน
- Migration preservation test: สร้าง baseline จาก migration เดิม ลงข้อมูลวิดีโอ/เจ้าของ/ไฟล์/สิทธิ์โดเมน/อัปโหลดค้าง แล้วลง migration ใหม่ ข้อมูลทั้งหมดเท่าเดิม
- รัน compiled Nest worker เป็น process จริงกับ PostgreSQL: boot, queue claim, retry 3 ครั้ง, persisted completion และ heartbeat ตรวจ DB ผ่าน ไม่มีการอ่านสื่อจริง
- FFmpeg/FFprobe จริงใน Docker network disabled, CPU1/RAM512MiB: MP4 จำลอง6วินาที,3เฟรม, collageช่องกลาง97.2/100,12Range requests/1,193,948bytes ผ่าน storage adapter จำลอง
- Chromium/React จริงกับ API จำลอง: reload ไม่เริ่มงานซ้ำ/ไม่ส่ง stop, pause/resume, ผลหน้าที่2ยังอยู่, ไม่มี auto-apply, seek/play MP4 จำลองจริงที่2.5วินาที และ manual approval gate ผ่าน ตรวจ screenshot desktop/mobile แล้ว

ยังไม่ได้ตรวจบน production: migration, full release Docker image, deployment, R2 จริง, โหลด/เวลาสแกนคลัง2,299คลิป, ความแม่นยำกับคลังจริง และการอนุมัติจริง ไม่ได้สรุปว่าพบวิดีโอตามรูปตัวอย่างของผู้ใช้แล้ว

## รันทดสอบซ้ำ

ใช้ฐานจำลองแยกเท่านั้น กำหนด METADATA_JOBS_TEST_DATABASE_URL เป็น localhost database ชื่อ video_jobs_test ห้ามใช้ credential/DB production

~~~powershell
node apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
node apps/api/node_modules/vitest/vitest.mjs run src/metadata-video-jobs.integration.test.ts --root apps/api
node scripts/metadata-video-migration-test.cjs
node scripts/metadata-video-worker-test.cjs
node apps/admin/node_modules/vitest/vitest.mjs run components/metadata-video-scan.test.ts --root apps/admin
node scripts/metadata-video-browser-test.cjs
~~~

Integration จะล้าง fixture เฉพาะฐานชื่อ video_jobs_test บน127.0.0.1 ที่ระบุชัดเจนเท่านั้น ถ้าไม่กำหนด env จะ skip ชุด DB; worker test ต้อง compile API ก่อน Migration test สร้าง schema ใหม่ในฐานทดสอบและเก็บหลักฐานใน test-results/metadata-video-migration

FFmpeg fixture: build scripts/metadata-video-runtime.Dockerfile แล้ว mount apps/api/src และ scripts/metadata-video-runtime-test.cjs แบบ read-only รัน --network none --cpus 1 --memory 512m

Browser fixture ใช้ test-results/metadata-video/generic.mp4 จาก FFmpeg testsrc2 ขนาด320x240 12fps ยาว6วินาที/libx264/yuv420p หรือกำหนด METADATA_VIDEO_FIXTURE

อ้างอิง [FFmpeg options](https://ffmpeg.org/ffmpeg.html), [FFmpeg protocols](https://ffmpeg.org/ffmpeg-protocols.html), [PostgreSQL SELECT / SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html), [R2 S3 compatibility: GetObject If-Match / Range](https://developers.cloudflare.com/r2/api/s3/api/)
