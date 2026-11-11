# Release 1.1.1 — 2026-11-12

Export review now checks every matching record in sequential 50-record batches, showing all raw records as text with running counts. Download unlocks only after completing every batch and reconciling successful + failed with the expected count. Stop or request failure leaves approval disabled. Existing explicit download confirmation and embed-import confirmation remain.

Validation: six UI tests pass, including a three-batch preview; PHP lint passes. Production installation not performed. Browser retains the full review text, so large reviews consume browser memory; server batches remain bounded. Download is a fresh read, not the same database snapshot as review. No migration or media/data writes introduced by review; rollback is reinstalling 1.1.0.

# Release 1.1.0 — 2026-11-12

User expanded scope: export all matching WordPress posts and import the CSV exported by 3x-storage to update RetroTube embed by exact title.

- Export all ignores leftover Post IDs; all-status option includes draft/private/trash/auto-draft/scheduled. Dates and selected post type still apply. Streams 50 records per batch; no total export row cap. Credential-bearing records remain explicitly failed, never silently omitted.
- Separate Tools → 3x-storage Embed Import accepts the actual app columns `title,หมวดหมู่,videos url,url images` (apps/admin/components/video-export.ts). Only `embed` is updated; category/image columns are ignored. Title equality is binary/exact, with reversal of the app's CSV formula protection only. Duplicate file/site titles are blocked.
- Administrator capability + nonce, per-post permission, signed user-bound preview, explicit per-row confirmation, escaped iframe text, iframe validation, stale-value check, InnoDB transaction for embed+audit. Replay is idempotent. Before/after, actor, UTC and batch ID persist in private post meta. Latest 50 audits show after reload; rollback checks current value before restoring.
- No schema migration. Import deliberately writes WordPress embed and audit only. Source post content/title/image and 3x-storage IDs/media/permissions stay unchanged. Back up metadata, then canary 1–2 posts before larger import. Deactivation stops new imports; rollback existing edits through history before uninstall if needed. Audit remains after uninstall. Worker drain N/A: no workers or media jobs.
- Import currently accepts CSV only, at most 2,000 rows / 10 MiB and PHP upload limits. Preview is synchronous and may need smaller files on slow hosting. Export JSON remains a full metadata backup, not the input format for embed updates. Export-all JSON may exceed separate 3x-storage import limits; this release does not change app limits.

## Verified locally for 1.1.0

- WordPress + MySQL export integration: **50 assertions**, 103 synthetic posts, 3 batches, 102 successful + 1 intentional credential failure, exact content, unique IDs, all-status and leftover-ID regressions.
- WordPress + MySQL import integration: **19 assertions** in isolated InnoDB fixture tables removed afterward. Exact Thai/quoted titles, duplicates/missing, apply, replay/reimport, stale preview, injected audit-write failure rollback, restore absent/existing embed, unsafe iframe/tampered token/anonymous rejection, content unchanged, escaped persistent history.
- Export UI: **5 unit tests** pass (streamed output, review gating, disk/network/cancel errors).
- Import browser fixture: actual PHP-rendered markup and JS with mocked API; confirmation cancellation does not apply, approval and rollback work, duplicate blocked, no iframe/script rendering or JS errors. Desktop/mobile screenshots supplied. This is not a production login/browser test.
- ZIP allowlist, CRC and every packaged byte verified against source.

Not yet verified: production install/export/import, real 3x-storage CSV uploaded through a production WordPress login, native folder picker, hosting-specific limits, and actual playback after changing an embed. Production source was not modified by these tests.

## Historical 1.0.0 evidence (read-only exporter scope at that time)

# RetroTube metadata export — delivery and evidence

วันที่ตรวจ: 11 พฤศจิกายน 2026 (Asia/Bangkok)

## ขอบเขตที่ยืนยัน

ยึดคำสั่งท้ายข้อความและคำชี้แจงเพิ่มเติม: **export เพื่อสำรอง/ตรวจสอบเท่านั้น** สำหรับ RetroTube ที่เผยแพร่ผ่าน embed code และ storage ที่เกี่ยวข้องคือโปรเจกต์ `D:\developer\3x-storage` ไม่เชื่อม 7M/AURUM Video Core ไม่สร้าง importer และไม่จับคู่ ID จากชื่อหรือ URL

เพิ่มเฉพาะ `tools/wp-metadata-export`, เอกสารนี้ และ `artifacts/wp-metadata-export` ไม่แก้ไฟล์แอปเดิมที่มี working changes อยู่แล้ว ไม่ทำ migration ไม่เรียก R2/API/storage ไม่เปลี่ยน Video ID/publicId/owner/permissions/iframe/media

ตรวจ root/ancestor AGENTS.md และค้นในสองพื้นที่แล้ว ไม่พบคำสั่ง AGENTS.md ที่ครอบคลุมไฟล์ที่เพิ่มนี้ (มีเฉพาะ vendor ของปลั๊กอินอื่นที่ไม่ได้แก้)

ตรวจโครงสร้าง 3x-storage: pnpm workspace มี admin/API/edge/worker, Prisma PostgreSQL; `Video` มี categoryId เดี่ยวและไม่มี relation แท็กใน schema ที่อ่าน ข้อนี้เป็นข้อมูลจาก source เท่านั้น **ไม่ได้เชื่อมฐานข้อมูล 3x-storage หรือเปลี่ยนแอปปลายทาง** เพราะอยู่นอกขอบเขต export-only

## หลักฐาน WordPress ที่ตรวจจริงในเครื่อง

อ่าน runtime ผ่าน `wp-load.php` ใน Docker `wp_app` และ query เฉพาะชื่อ meta key/จำนวนจากฐานข้อมูล WordPress จริง ไม่มีการ export เนื้อหาบทความจริงไปยัง artifacts

- active stylesheet/template: `retrotube`
- สภาพแวดล้อม Docker มี aurum-ads, aurum-video-core, Rank Math Pro, Rank Math และ wp-script-core อยู่เดิม ข้อมูลนี้ **ไม่ใช่**หลักฐานของเว็บไซต์ production เป้าหมาย
- รอบ integration test ปิด normal plugins ทั้งหมดใน request ยกเว้น `wp-script-core/wp-script-core.php` ผ่าน in-memory filter โดยไม่เขียน active_plugins option จึงทดสอบโดยไม่มี 7M/AURUM Video Core
- post types ที่พบรวม `post`, `page`, `attachment`, `blog`, `photos`, `aurum_actor` และ internal/plugin types; RetroTube metabox ระบุ `post_types => ['post']`
- taxonomies ที่พบรวม `category`, `post_tag`, `post_format`, `actors`, `blog_category`, `blog_tag`, `photos_category`, `photos_tag`, `aurum_video_actor` และ internal/plugin taxonomies
- timezone ที่อ่านได้: `+07:00`
- key counts ที่ยืนยันการมีอยู่: embed 183, video_url 934, thumb 956, thumbs 1, duration 1116, _thumbnail_id 202, _wp_attachment_metadata 257, _wp_attached_file 257, rank_math_description 1 (เป็น snapshot ในเครื่อง ณ เวลาตรวจ ไม่ใช่ยอด production)
- `_sevenls_vp_*` และ `aurum_*` พบจากประวัติระบบในเครื่อง แต่ **ไม่อยู่ใน default mapping** และไม่ใช้เชื่อมต่อหรือจับคู่กับแอปใด

## Field mapping และแหล่งหลักฐาน

| ข้อมูล | ฟิลด์จริง | หลักฐาน source ที่ตรวจ |
|---|---|---|
| Video embed code | `embed` | `D:\developer\wp-docker\wp-content\themes\retrotube\admin\metabox.php:102`, `inc\class-content-video-player.php:593` |
| Video shortcode | `shortcode` | metabox.php:111, class-content-video-player.php:584 |
| Video URL | `video_url` | metabox.php:38, class-content-video-player.php:620 |
| URL ความละเอียด | `video_url_4k`, `_1080`, `_720`, `_480`, `_360`, `_240` (prefix video_url) | class-content-video-player.php:633–638 และ metabox.php |
| Preview/trailer | `trailer_url` | metabox.php และ inc/video-functions.php:254 |
| รูป custom | `thumb`, `thumbs` | metabox.php:203 และ inc/video-functions.php:145–148 |
| Video properties | `duration`, `featured_video`, `hd_video`, `post_views_count`, `likes_count`, `dislikes_count` | metabox.php และ class-content-video-player.php:575 |
| คำอธิบาย SEO ถ้ามี | `rank_math_description` | ชื่อ key มีจริงใน DB; โค้ดที่ติดตั้ง `aurum-video-core/includes/csv.php:107,214` อ่าน key นี้ เป็นหลักฐานชื่อฟิลด์เท่านั้น ไม่พึ่งพาปลั๊กอินนั้นใน exporter |
| เนื้อหา | posts.post_title, post_content, post_excerpt | อ่าน raw columns ไม่ใช้ the_content/get_the_title rendering filters |
| รูป featured | `_thumbnail_id` → attachment; `_wp_attached_file`, `_wp_attachment_metadata`, `_wp_attachment_image_alt` | DB keys จริงและ RetroTube featured-image code |
| Taxonomy | ทุก relationship → term_taxonomy → terms | อ่านตามชื่อ taxonomy จริง ไม่ hardcode จำกัดแค่ category/tag; actors ลงทะเบียนใน inc/actors.php:23 |

ไม่เดา key จากชื่อใกล้เคียง ไม่รวม field ที่ไม่ผ่านการตรวจลง default mapping; รายการ excluded จะปรากฏต่อโพสต์ ค่ารหัสผ่าน/API/token/cookie/session/credentials จะไม่ถูกรวมเพียงเพราะเป็น custom field

## การทำงานและการรักษาข้อมูล

- Source reference คือ `site_url + post_id` ไม่สร้าง/แก้ record ใด การส่ง Post ID ซ้ำจะ normalize ก่อน query; keyset `ID > after AND ID <= max_id ORDER BY ID` ป้องกันซ้ำระหว่าง batch
- AJAX ทุก request ตรวจ `manage_options` และ WordPress nonce; cursor ลง HMAC ด้วย wp_salt ผูก user และอายุ 12 ชั่วโมง พร้อม filters/max ID/mapping
- Preview แสดงไม่เกินสองรายการโดย textContent; ไม่มี raw iframe ใน DOM, ไม่มี remote media fetch
- เริ่ม export ต้องผ่าน preview ของ filters ชุดเดียวกันและกดยืนยัน เลือกโฟลเดอร์ส่วนตัวบนเครื่อง เขียน JSON/CSV/report เป็น stream ทีละ batch ไม่มี temporary export file บนเว็บเซิร์ฟเวอร์
- เก็บค่าต้นฉบับหลายค่าต่อ meta key รวมทั้ง serialized bytes; PHP objects ไม่ถูก instantiate ขณะอ่าน ข้อมูล invalid UTF-8/deserialize error ไม่ถูกแทนที่เงียบ ๆ แต่กลายเป็น failed record
- image URL เป็น WordPress API resolved, filename ระบุว่า derive จาก attached path, original filename มีเมื่อมีหลักฐานเท่านั้น ไม่มีการโหลด media จากภายนอก
- JSON มี schema_version, exported_at_utc, site_url, filters, field_mapping, total_records, records และ summary; CSV มี 9 columns ที่ร้องขอพร้อม UTF-8 BOM/formula escaping
- จำนวน failed/skipped และเหตุผลอยู่ใน companion report; metadata exclusions/warnings อยู่ในแต่ละ JSON record

## ผลทดสอบในเครื่อง

| ชั้นการตรวจ | ผลและขอบเขต |
|---|---|
| PHP lint | ไฟล์ PHP runtime ทั้ง 3 ผ่าน PHP 8.3.31 ใน wp_app |
| JavaScript syntax | admin.js ผ่าน node --check |
| WordPress + MySQL integration | **45 assertions ผ่าน** บนข้อมูลจำลองทั่วไป 103 โพสต์ใน connection-local TEMPORARY tables; ไม่ insert/update/delete ตารางบทความจริง |
| Batches | 3 batches, 102 สำเร็จ + 1 failed ที่จงใจมี credential ใน raw content; ไม่มี ID ซ้ำ; replay batch ได้ผลเดิม |
| Raw fidelity | ไทย, quotes/newline, HTML, shortcode, embed หลายค่า, iframe 4 ตัว, raw/decoded src, parsed-only ID, JSON roundtrip ตรงต้นฉบับ |
| Metadata | หลาย category/tag, actors, custom taxonomy ที่ไม่ได้ register, parent, array/object พร้อม stored_raw, attachment sizes/original filename และไม่มีรูป/embed |
| Security/errors | anonymous/nonce/tampered cursor ปฏิเสธ; nested credentials และ credential URLs ไม่หลุด; DB read error รายงาน ไม่แปลงเป็น empty success; CSV formula/quote/newline roundtrip ผ่าน |
| Source checks | จำนวนแถวใน source posts/postmeta/terms/term_taxonomy/term_relationships ก่อน–หลังเท่ากัน; code exporter ไม่มีคำสั่ง insert/update/delete หรือ REST mutation |
| UI unit | **5 tests ผ่าน**: review gating, completed JSON/CSV/report, disk-full, network failure และ cancellation ต้อง abort incomplete output |
| HTTP harness | เรียก AJAX hook จริงผ่าน PHP HTTP server ที่ bind localhost ภายใน container ใช้ temporary fixtures และจำลอง user context: anonymous → administrator_required, bad nonce → invalid_nonce, valid → 2 records/0 failed ไม่ใช่การ login production ผ่าน browser |
| Chrome browser fixture | หน้า PHP ที่ render จริง + admin.js จริง, mocked AJAX/file picker: preview ปลอด iframe DOM, JSON ตรงต้นฉบับ, streaming 3 files, invalidate review เมื่อเปลี่ยน filters, ไม่มี JS errors; ตรวจภาพ desktop 1440px/mobile 390px |

คำสั่งหลัก:

```powershell
docker cp tools/wp-metadata-export/. wp_app:/tmp/wp-metadata-export
docker exec wp_app php /tmp/wp-metadata-export/tests/integration.php
node --test tools/wp-metadata-export/tests/admin.test.cjs
node tools/wp-metadata-export/tests/browser.cjs
```

`tests/http-router.php` เป็น local test harness เท่านั้น ต้องไม่ deploy; release ZIP ไม่รวม tests ส่วน browser test ต้องมี Playwright/Chrome และตัวอย่าง artifacts ที่สร้างจาก integration

## สิ่งที่ยังไม่ได้ตรวจและข้อจำกัด

- ยังไม่ติดตั้ง/activate ZIP บน production ไม่ได้ตรวจเวอร์ชัน RetroTube หรือ field เพิ่มเติมของ production และไม่ได้ export โพสต์จริงของ production
- ยังไม่ได้ทดสอบ login admin + nonce ผ่าน browser WordPress จริงแบบ end-to-end หรือ native folder picker จริง (browser tests ใช้ mock); ยังไม่ได้ทดสอบ exports หลักหมื่นหรือ record ขนาดใหญ่มาก
- แยก snapshot ต่อ batch ไม่ใช่ atomic snapshot ทั้งชุด; งดแก้ source ระหว่าง export ตรวจ summary.count_matches และ failed/skipped/excluded fields
- whitelist ครอบคลุม RetroTube ที่ตรวจพบ หากไซต์มี key เพิ่มเติม ต้องตรวจหลักฐานและเพิ่ม mapping ก่อนถือว่าครบ ไม่มีการ export ทุก meta key แบบไม่ตรวจ
- secret detection เป็น key/value pattern และ nested structure; ไม่สามารถรับประกันการรู้จัก secret ที่ไม่มีลักษณะบ่งชี้ เก็บไฟล์ทั้งหมดเป็นข้อมูลส่วนตัว
- iframe parser ไม่ execute shortcode/JavaScript, source malformed หรือ iframe ที่สร้างขณะ render อาจไม่มี parsed src แต่ content/embed raw ไม่ถูกตัด
- ภาพ/URL ไม่ถูกดาวน์โหลดหรือพิสูจน์ว่าเข้าถึงได้ ความสามารถ File System Access ต้องใช้ Chrome/Edge บน secure context
- ไม่มี importer, metadata update transaction/audit/undo ของ 3x-storage ตามขอบเขตท้ายคำขอ; การ undo ข้อมูลต้นทางไม่จำเป็นเพราะไม่มีการเขียนต้นทาง

## ผลกระทบและการถอนออก

ไม่มี migration หรือ schema change จึงไม่ต้อง migrate/restore ฐานข้อมูลสำหรับปลั๊กอินนี้ ไม่มี worker/jobs/in-flight uploads ที่ต้อง drain ไม่มี canary media rewrite เพราะไม่เปลี่ยน media การใช้งานจริงเริ่ม 1–2 โพสต์ก่อน export ชุดใหญ่; rollback คือหยุด export แล้ว deactivate/delete plugin ไฟล์บนเครื่องผู้ดูแลจัดการได้เอง การเปิดใช้งานปลั๊กอินตามปกติให้ WordPress บันทึกสถานะ active_plugins ตามระบบเท่านั้น ตัว exporter ไม่เขียน options/บทความ/รูป/iframe

แพ็กเกจติดตั้งมีเฉพาะ bootstrap, core, admin, admin.js และ README ไม่มี test harness, credentials หรือ export ข้อมูลจริง ดู `artifacts/wp-metadata-export/package-manifest.json` สำหรับรายชื่อไฟล์และ SHA-256
