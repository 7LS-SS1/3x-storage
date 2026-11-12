# ตรวจจับด้วยวิดีโอ — งานเบื้องหลังและดัชนีเฟรม

โหมดแยกในหน้า **นำเข้า Metadata** จับคู่รูป WordPress กับเฟรมจริงของวิดีโอที่ไม่มีปก (`posterKey = null`) ใน 3x-storage ไม่ใช้ชื่อเรื่องหรือการจดจำใบหน้าเพื่อยืนยันคู่

## วิธีใช้

1. เลือก **ตรวจจับด้วยวิดีโอ** ก่อนอัปโหลดหรือเปิด batch เดิม หากโหมดรูปปกทำงานอยู่ให้กดหยุดก่อนเปลี่ยนโหมด
2. ใช้เกณฑ์บันทึกอัตโนมัติคงที่ 80/100 เลือกเพดาน 12, 30 หรือ 60 เฟรมต่อคลิป (เริ่มต้น 30)
3. กด **เริ่มตรวจจับด้วยวิดีโอ** ครั้งเดียว ระบบเก็บงานในฐานข้อมูล ตรวจทุกแถว PENDING ของ batch กับรายการวิดีโอที่ไม่มีปก ณ ตอนเริ่มงาน ปิดแท็บหรือเปลี่ยนหน้าได้ ไม่เริ่มตรวจซ้ำ
4. กลับมาเลือกโหมดและ batch เดิมด้วยบัญชีเดิมเพื่อดูงาน ปุ่ม **พักงานตรวจวิดีโอ** หยุดหลังอ่านเฟรมปัจจุบัน **ทำต่อจากงานเดิม** ใช้การตั้งค่าเดิมและเฟรมที่อ่านสำเร็จแล้ว
5. เมื่อเฟรมผ่าน 80/100 ระบบอัปเดตชื่อเรื่อง/คำอธิบายที่ไม่ว่างทันที ไม่ต้องเล่นหรืออนุมัติ แสดง Video ID คะแนนและเวลาเฟรมที่ใช้ ดูก่อน–หลังและย้อนคืนในประวัติได้
6. **ลองรายการที่ผิดพลาดอีกครั้ง** ใช้หลังจบรอบหรือพักงานจนงานปัจจุบันหยุดแล้ว หากรูปต้นทางเคยอ่านไม่ได้ ระบบเทียบวิดีโอที่เสร็จแล้วกับรูปที่กู้กลับมาได้ด้วย โดยใช้เฟรมที่เก็บไว้
7. **เริ่มรอบใหม่ด้วยค่าที่เลือก** แทนผลแนะนำเดิมของบัญชีนี้ใน batch นี้ ใช้เมื่อต้องการเปลี่ยนจำนวนเฟรม หรือรวมวิดีโอใหม่ แคชเฟรมและประวัติอนุมัติไม่ถูกลบ

คะแนนคือความคล้ายของสีและโครงสร้าง ไม่ใช่โอกาสจับคู่ถูกต้อง 80% ภาพเต็มและภาพแบ่งแนวตั้งเท่ากัน 2/3 ช่องเปรียบเทียบแยกกัน **ผู้ใช้อนุญาตให้บันทึกอัตโนมัติตั้งแต่ 80/100 โดยไม่รออนุมัติรายรายการ** ใช้คู่แรกที่ผ่านเกณฑ์ ไม่รอคะแนนสูงสุดทั่วคลัง หากเฟรมเดียวมีหลายบทความผ่านเกณฑ์เลือกคะแนนสูงสุดแล้วเรียง row ID เพื่อให้ผลเสมอกันมีลำดับแน่นอน โหมดรูปปกตรงทุก byte ยังคงเป็นกระบวนการเดิม

## ประสิทธิภาพและข้อจำกัด

- 30 เฟรมคือ 30 ตำแหน่งกระจายตลอดคลิป ไม่ใช่เวลา 30 วินาที จำนวนที่เลือกเป็นเพดานของคลิปที่ยังไม่พบคู่ หากบันทึกคู่สำเร็จก่อนจะหยุดอ่านเฟรมที่เหลือ
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
- Worker แก้เฉพาะ Video.title/description จาก normalized metadata ที่ไม่ว่าง พร้อม source mapping, MetadataChange และ audit ใน transaction เดียวกับหลักฐานเฟรมและการจบ task ตรวจสิทธิ์ผู้เริ่มงานซ้ำก่อนเขียน ไม่แก้ Video ID, publicId, เจ้าของ, category, รูปปก, VideoFile, storage key, iframe หรือสิทธิ์สื่อ ย้อนคืนผ่านกระบวนการเดิม
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

## ผลตรวจรุ่นงานเบื้องหลังก่อนปรับ auto-apply (2026-11-12)

- ฐาน PostgreSQL 17 แยก video_jobs_test: migrate deploy 9 migrations สำเร็จ รวม migration ใหม่
- Integration จริง 9 tests: start ซ้ำ, snapshot เฉพาะไม่มีปก, source barrier, cap พร้อมกัน 2 งาน, pause/resume ด้วย processor ใหม่, lease หมดอายุ/กัน worker เก่า, transaction fault injection, retry รูปต้นทาง, top-5 ระหว่างงานพร้อมกัน, restart คงแคช และ guard/input validation
- ภาพ/ตัวอ่านเฟรมใน integration เป็นข้อมูลจำลอง: cold 12 decodes, batch ถัดไป **0 decodes เพิ่ม**, เปลี่ยน ETag แล้วอ่านใหม่ 12 decodes ไม่ถือเป็น benchmark เวลาบน R2
- Regression API 51 tests และ admin 8 tests ผ่าน; TypeScript API/admin ผ่าน
- Migration preservation test: สร้าง baseline จาก migration เดิม ลงข้อมูลวิดีโอ/เจ้าของ/ไฟล์/สิทธิ์โดเมน/อัปโหลดค้าง แล้วลง migration ใหม่ ข้อมูลทั้งหมดเท่าเดิม
- รัน compiled Nest worker เป็น process จริงกับ PostgreSQL: boot, queue claim, retry 3 ครั้ง, persisted completion และ heartbeat ตรวจ DB ผ่าน ไม่มีการอ่านสื่อจริง
- FFmpeg/FFprobe จริงใน Docker network disabled, CPU1/RAM512MiB: MP4 จำลอง6วินาที,3เฟรม, collageช่องกลาง97.2/100,12Range requests/1,193,948bytes ผ่าน storage adapter จำลอง
- Chromium/React จริงกับ API จำลอง: reload ไม่เริ่มงานซ้ำ/ไม่ส่ง stop, pause/resume, ผลหน้าที่2ยังอยู่, ไม่มี auto-apply, seek/play MP4 จำลองจริงที่2.5วินาที และ manual approval gate ผ่าน ตรวจ screenshot desktop/mobile แล้ว

ยังไม่ได้ตรวจบน production: migration, full release Docker image, deployment, R2 จริง, โหลด/เวลาสแกนคลัง2,299คลิป, ความแม่นยำกับคลังจริง และการอนุมัติจริง ไม่ได้สรุปว่าพบวิดีโอตามรูปตัวอย่างของผู้ใช้แล้ว

## การลดคิวและผลตรวจ auto-apply (2026-11-12)

- เปรียบเทียบระหว่างอ่านแต่ละเฟรม เมื่อบันทึกสำเร็จหยุดอ่านเฟรมที่เหลือทันทีและจบ VIDEO task
- ทุกเฟรมกรองเฉพาะ SOURCE rows ที่ยัง PENDING จึงไม่นำบทความที่จับคู่แล้วไปเทียบกับคลิปอื่นอีก
- เมื่อไม่มี source ที่ยังตรวจต่อได้ ให้ VIDEO tasks ที่รออยู่เป็น SKIPPED ไม่ลบข้อมูล audit, task หรือ cache งานที่กำลังอ่านอยู่หยุดหลังเฟรมปัจจุบัน ไม่รายงาน skipped ว่าได้ตรวจครบคลิป
- วิดีโอที่มี source mapping คนละโพสต์แล้วจะข้ามก่อนอ่านเฟรม ไม่เขียนทับด้วยโพสต์อื่น ส่วนการนำเข้า site_url + post_id เดิมยังทำซ้ำแบบ NOOP ได้ การระบุ target_video_id จะจำกัดคู่ตามที่ระบุ
- Lock row/video และตรวจคีย์ต้นทางภายใน transaction ป้องกันสอง worker จับคู่แถวเดียวหรือแก้คลิปเดียวด้วยคนละโพสต์ เมื่อ audit/result insert ล้มเหลว การแก้ Video และ source จะ rollback ด้วย
- เก็บ job ID, object identity, score, threshold=80, timestamp ของเฟรม, panel, before/after, actor และเวลาบันทึกในหลักฐาน/ประวัติ ไม่อ้างว่าเล่นตรวจโดยคนแล้ว
- เร็วขึ้นมากเมื่อเจอคู่ในเฟรมต้น ๆ และเมื่อจับคู่ source ได้ครบเร็ว การลบ matched video ออกจากคิวอย่างเดียวช่วยน้อย เพราะเดิมหนึ่ง task อ่านคลิปนั้นครั้งเดียวอยู่แล้ว ส่วนการตัด source ลดต้นทุนเปรียบเทียบ และ early stop ลดงาน FFmpeg/Range I/O จริง
- ตัวอย่างจำลองเพดาน12เฟรม: พบคู่เฟรมแรกจึงอ่าน1เฟรม; batch ถัดไปใช้ cache ไม่ถอดรหัสเพิ่ม; ไม่ผ่าน79.9อ่านครบ12เฟรมและไม่เขียน; ผ่าน80บันทึกทันที การลด1/12นี้ไม่ใช่อัตราเร็วที่ยืนยันบนคลังจริง
- ทดสอบ PostgreSQL integration14 tests, regression API52 tests, admin8 tests, TypeScript API/admin และ browser fixture ผ่าน ครอบคลุม80แบบinclusive, concurrency, rollback, empty description, stale lease, failure transaction, explicit target และสิทธิ์ที่ถูกถอน
- Browser ใช้ API จำลอง แสดงบันทึกอัตโนมัติและหลักฐานได้โดยไม่เรียก preview/เล่น/อนุมัติ ทดสอบ reload, pause/resume และเปลี่ยนหน้า ส่วน DB integration ใช้รูป/ตัวอ่านเฟรมจำลอง
- รุ่นนี้ไม่มี migration เพิ่มจาก20261112120000_metadata_video_jobs ต้อง deploy API/admin/metadata-worker พร้อมกัน พักงานและ drain metadata-worker เดิมก่อนเปลี่ยนรุ่น งาน RUNNING ที่ทำต่อด้วยรุ่นใหม่จะใช้80และบันทึกอัตโนมัติ งานเก่าที่จบแล้วให้เริ่มรอบใหม่เพื่อประมวลผลแถว PENDING
- ไม่ได้ deploy หรือแก้ metadata บน production ในการทดสอบนี้ ต้องสำรอง DB และตรวจ canary บน staging ก่อน rollout ตามขั้นตอนด้านบน การย้อนรุ่นต้องพัก/หยุด worker ใหม่ก่อน และใช้ประวัติย้อนคืนรายการที่บันทึกไปแล้ว

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


## Update 2026-11-12: configurable threshold and shared videos
This section supersedes the fixed-80 and one-to-one behavior above. New jobs accept an integer threshold 0–100 (default 80). The UI offers 100/95/90/85/80/75/70/60/50/40/30/20/10/0. Zero explicitly means accept the first eligible candidate without a similarity requirement; scores are still recorded, and this does not establish content identity. Existing jobs keep their stored threshold; pause and start a new round to change it.

### Default updated: accept all frame scores

New jobs now default to threshold **0** in both the UI and API. All scores from 0–100 qualify for automatic title/description updates; administrators can still explicitly select a higher threshold. Existing jobs retain their stored settings. The first eligible frame can map several pending source rows to the same video; the last committed nonblank title/description wins. This setting does not establish content identity. Failed image reads still require retry and are not treated as matches.

This change does not modify schema, existing job records, IDs, ownership, media files, or embed/API contracts. Migration and data restore are N/A for this default-only code update. Production rollout remains pending: deploy API/admin, canary one new job to verify threshold 0, retain normal database backups and audit history before metadata writes. No worker replacement or draining is required because its existing zero-threshold behavior is unchanged. Rollback the API/admin code to restore the old default; already created jobs keep their threshold, and metadata undo uses the existing audited reverse-order rollback.

Multiple source posts may map to one video. A source row is still applied only once; explicit target IDs and existing source-to-video mappings remain enforced. All qualifying rows in a frame are applied, then remaining pending rows may be checked against later frames. One video's title/description are the last committed nonblank values; all row audit records remain. Undo shared-video updates in reverse order because existing stale-value protection remains in force. Updated export includes every source row, with its original RetroTube embed in old_embed, instead of deduplicating by video ID.

No database migration or R2 mutation is required for this update. Deploy API/admin/metadata-worker together; drain/pause running tasks for worker replacement and retain checkpoints. Install WordPress plugin 1.1.4 for the fifth CSV column. Production deployment, real R2 matching and production WordPress writes have not been tested for this update.


## Correction 2026-11-12: consume each saved Video ID once

This supersedes the shared-video auto-matching behavior above. Frame workers now exclude videos with any active WordPress metadata mapping, including mappings from earlier batches/accounts. They check before frame reads and again under the existing video transaction lock before writing. A successful match ends that video task immediately. Other source rows remain pending for other eligible videos; existing shared mappings and audit records are preserved, not rewritten.

New queue snapshots omit already mapped videos. Existing snapshots retire their pending tasks without deleting history. Status reports initialTotal (snapshot size), removed (unique mapped Video IDs in that snapshot), and total (initialTotal minus removed). Thus 2299 becomes 2298 after one video is saved, even if legacy records contain several source mappings to it. scanned excludes removed videos and tasks skipped without inspection. No storage object is deleted. Undo makes a video eligible for a new snapshot only after all its active mappings have been reverted; completed/skipped old tasks are not automatically reopened.

No schema migration or destructive backfill is needed: existing active mappings provide the exclusion evidence. Before production rollout, pause/drain all old metadata workers, retain database backups and audit history, then deploy API/admin/metadata-worker together. Canary a small batch and verify one save decrements the total exactly once and another batch excludes that video. In-flight uploads, IDs, ownership, files, and embed URLs are unaffected by these code paths. Rollback requires pausing workers before restoring images; no DB restore is required for code rollback, and existing audited metadata undo remains available. Deployment and real R2 behavior have not yet been verified for this correction.


## Reapply rolled-back rows (2026-11-12)

New video job snapshots include PENDING and ROLLED_BACK source rows, but exclude APPLIED/NOOP rows. Source selection, completion checks and transaction writes all use this rule. Existing completed jobs must be explicitly restarted; deployment does not start matching or reset existing row statuses. For the 142-row example, 111 reverted + 1 pending = 112 sources; the 30 retained applied rows stay excluded.

Migration `20261112170000_metadata_reapply_history` replaces the one-history-per-row unique index with a nonunique lookup index and a unique partial index for unreverted changes. All old change IDs, row IDs, before/after data and rollback audits remain intact. Reapplying creates a new change; reusing an already reverted rollback command does not undo the new round. Repeated apply/undo cycles are supported.

Deployment gate: pause/drain metadata workers and take a database backup; apply the migration before deploying the regenerated Prisma client/API/worker (the compose migration dependency provides this order). Check migration success, worker health and a small restarted canary before larger batches. Index DDL may briefly lock MetadataChange; schedule away from active metadata writes. No media files, embed contracts, ownership or upload records are changed. No automatic data backfill is required. Rollback: pause workers and revert application images while retaining this expanded history schema. Do not recreate the old unique index once repeated histories exist, and do not restore the whole DB over newer uploads. Use audited metadata rollback for unwanted new matches. Production migration/deployment is not performed by this code preparation.
