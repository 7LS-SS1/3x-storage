# Backup and Restore

ทำ PostgreSQL logical backup รายวันและทดสอบ restore รายเดือน เก็บ R2 versioning/lifecycle ตามนโยบายองค์กร สำรอง configuration โดยไม่รวม secrets.

Restore: หยุด API/worker, restore database ไป instance ใหม่, ตรวจ migration version, ตรวจ R2 binding, เปลี่ยน connection secret และรัน readiness checks ก่อนเปิด traffic.
