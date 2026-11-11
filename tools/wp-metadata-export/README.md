# RetroTube Metadata Backup Export 1.0.0

ปลั๊กอินชั่วคราวสำหรับสำรองและตรวจสอบ metadata ของ RetroTube ที่ใช้ Video embed code โดยตรง ใช้งานได้โดยไม่ต้องมี 7M/AURUM Video Core และไม่เชื่อมต่อ API หรือฐานข้อมูลของ 3x-storage

## วิธีใช้

1. ติดตั้ง `wp-metadata-export-1.0.0.zip` ผ่าน Plugins → Add New → Upload Plugin แล้วเปิดใช้งาน
2. ใช้บัญชีผู้ดูแลที่มี `manage_options` เปิด Tools → Metadata Backup Export
3. เลือก `post` สำหรับบทความวิดีโอ RetroTube เลือกสถานะ เลือกวันที่เผยแพร่หรือวันที่แก้ไข ช่วงวันที่อิง timezone ของ WordPress ที่แสดงบนหน้าจอ และรวมวันสุดท้าย
4. เริ่มด้วย Post ID 1–2 รายการ เช่น `101,102` แล้วกด **ตรวจตัวอย่าง** ตรวจ content, embed, taxonomy, warnings และ excluded_meta_keys
5. กด **ยืนยันและบันทึก JSON + CSV** แล้วเลือกโฟลเดอร์ส่วนตัวบนเครื่องด้วย Chrome/Edge ผ่าน HTTPS หรือ localhost ปลั๊กอินจะสร้าง JSON, CSV และ `-report.json` ชื่อใหม่ ไม่ทับไฟล์เดิม
6. ตรวจยอดสำเร็จ/ข้าม/ล้มเหลว และ `summary.count_matches` ต้องเป็น true ตรวจเหตุผลใน report และ warnings ทุกครั้ง รายการที่ล้มเหลวจะไม่รวมใน records
7. หากต้องการทั้งหมด ให้ล้าง Post ID แล้วเลือก **ทั้งหมดตามตัวกรอง** ตรวจตัวอย่างและยืนยันอีกครั้ง การเปลี่ยนตัวกรองจะทำให้ต้องตรวจใหม่
8. เมื่อสำรองครบ ปิดใช้งานและลบปลั๊กอินได้ ไม่มีตาราง options cron หรือไฟล์ export ฝั่งเซิร์ฟเวอร์ที่ต้องล้าง

ไม่แสดงหรือเล่น iframe; ตัวอย่างเป็นข้อความที่ escape แล้ว ไม่ดาวน์โหลดไฟล์รูปหรือวิดีโอ ไม่มีการนำเข้า เปลี่ยนโดเมน iframe แก้โพสต์ หรือปรับ ID/เจ้าของ/storage key/สิทธิ์ของวิดีโอใน 3x-storage

## ความหมายของไฟล์

- JSON เป็นข้อมูลหลัก UTF-8: เก็บ HTML/shortcode ต้นฉบับ, meta หลายค่าและค่า array/object, `stored_raw` สำหรับค่าที่จัดเก็บจริง, term ทุก taxonomy รวมที่ไม่ได้ register ในปัจจุบัน
- `video_embed_code_raw` เป็น array ของ `{source_field, value_index, value}` เพื่อไม่ทำค่าซ้ำต่อ key หาย เช่น embed สองค่า
- `iframe_sources` เก็บ `src_raw`, `src_decoded`, hostname และ `parsed_embed_id` แยกกัน ID มีสถานะ `parsed_only_not_verified_video_id` เสมอ ไม่มีการจับคู่กับ 3x-storage
- CSV เป็นสรุปหนึ่งบรรทัดต่อโพสต์ หลาย iframe อยู่ในเซลล์เดียวคั่นด้วย newline พร้อม quote ตาม CSV มี BOM สำหรับ Excel และเติม `'` หน้าเซลล์ที่เสี่ยงเป็นสูตร JSON ไม่ถูกแก้ตาม CSV
- report เก็บรายการ Post ID ที่ข้าม/ล้มเหลวพร้อมเหตุผลและยอดรวม เก็บ report คู่กับ JSON และ CSV
- รูปที่ไม่พบเป็น null/array ว่าง `filename` เป็น basename ที่อนุมานจาก `_wp_attached_file` ส่วน `original_filename` จะมีเฉพาะเมื่อ WordPress บันทึก `original_image` ไว้จริง URL จาก WordPress API ไม่ได้ตรวจผ่านเครือข่าย

## ข้อจำกัดที่ต้องตรวจ

- ติดตั้งชั่วคราวเพื่อ export metadata เท่านั้น ไม่ใช่การสำรองฐานข้อมูลหรือไฟล์ media ทั้งระบบ ไม่รวม options, user metadata หรือรหัสผ่านบทความ
- Export เฉพาะ custom fields ที่มีหลักฐานและอยู่ใน mapping ของ RetroTube; key อื่นถูกระบุชื่อและเหตุผลใน `excluded_meta_keys` ไม่ทิ้งเงียบ ๆ ต้องตรวจรายการนี้ก่อนถือว่าข้อมูลที่ต้องการครบ หากไซต์มี custom fields เพิ่ม ต้องตรวจโค้ดต้นทางและเพิ่ม mapping ก่อน export ใหม่
- ตรวจชื่อ key, nested key และรูปแบบค่าที่เป็น credentials; ฟิลด์ที่มี signed URL/token จะถูกตัดพร้อมเหตุผล โดยไม่แก้ URL หากอยู่ใน content/title/ข้อมูลดิบที่ต้องคงเดิม จะปฏิเสธทั้งรายการแทนการแก้ต้นฉบับ การตรวจรูปแบบไม่สามารถยืนยันข้อความลับที่ไม่มีชื่อ/รูปแบบบ่งชี้ได้ ห้ามนำไฟล์สำรองไปเผยแพร่สาธารณะ
- PHP object ไม่ถูก instantiate ระหว่าง unserialize เก็บค่าที่ decode ได้และ serialized bytes เดิม ไม่ได้รัน shortcode หรือ WordPress content filters
- อ่านครั้งละ 50 โพสต์ เรียง ID แบบ keyset มีขอบเขต max ID ตั้งแต่เริ่ม แต่ละ batch ใช้ transaction READ ONLY / REPEATABLE READ และ ROLLBACK เสมอ การ export ทั้งชุดไม่ใช่ snapshot เดียวข้าม request จึงควรงดแก้บทความระหว่าง export และตรวจยอดเมื่อเสร็จ
- หน่วยความจำขึ้นกับขนาดหนึ่ง batch และโพสต์แต่ละรายการ ไม่ใช่ทุกโพสต์ในเว็บ; โพสต์/meta ที่ใหญ่มากอาจชน memory/time limit ของ PHP ได้ ไม่มี resume หลัง reload/nonce หมดอายุ ให้เริ่ม export ใหม่หรือแบ่งช่วงวันที่
- ต้องใช้ browser ที่มี File System Access; Firefox/Safari และ HTTP ที่ไม่ใช่ localhost ไม่รองรับ flow นี้ กดหยุด/เขียนดิสก์ล้มเหลวจะ abort ไฟล์ที่ยังไม่ commit อาจเหลือชื่อไฟล์ว่าง ถ้าไฟล์แรก commit แล้วแต่ไฟล์ถัดไปล้มเหลว หน้าจอจะแจ้งว่าชุดไฟล์ยังไม่ครบ
- การหา iframe ใช้การอ่าน tag/attribute จากข้อความ ไม่รัน DOM หรือ shortcode iframe ที่ถูกสร้างด้วย JavaScript/shortcode ตอนแสดงผลจะไม่ถูกสร้างเพิ่ม ส่วนต้นฉบับยังอยู่ครบ

รายละเอียดหลักฐาน mapping และผลทดสอบอยู่ที่ `docs/WORDPRESS_METADATA_EXPORT.md` ใน source project
