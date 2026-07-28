# Decisions

- ใช้ modular monolith และ shared packages ลด operational overhead
- Admin UI เป็นภาษาไทย; source/API/schema/docs เชิงเทคนิคใช้ English identifiers
- Luxury black/gold ใช้กับลำดับชั้นและ accent ไม่ใช้ทองเต็มพื้นที่เพื่อคง readability
- เก็บ original เสมอ; worker สร้าง MP4 fast-start เมื่อ source เล่นตรงไม่ได้
- Play count ยืนยันหลัง `playing` ต่อเนื่อง 3 วินาทีและ unique ต่อ playback session
- Analytics configuration ที่ขาดหายต้องแสดง notice และไม่สร้างค่าปลอม
- ผู้ใช้กำหนดให้ destructive actions ต้องมี confirmation; API delete ต้องเป็น soft delete
