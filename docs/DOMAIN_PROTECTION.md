# Domain Protection

Embed authorization ต้องอ่าน `Referer`, parse ด้วย URL parser และเปรียบเทียบ normalized hostname แบบ exact หรือ suffix ที่มีจุดนำหน้าเมื่อเปิด subdomain เท่านั้น จึงปฏิเสธ `example.com.attacker.test`.

หากไม่ผ่านให้ตอบ 403 ภาษาไทย ไม่ส่ง storage key/signed URL และไม่ mount player. หากผ่านให้ตอบ CSP `frame-ancestors https://<verified-host>` พร้อม `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` และ private cache policy.

เว็บไซต์ปลายทางต้องไม่ตั้งนโยบายที่ตัด Referer ออกจาก iframe request.
