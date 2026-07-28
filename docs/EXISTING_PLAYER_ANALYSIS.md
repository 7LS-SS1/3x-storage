# Existing Player Analysis

ตรวจสอบแบบ read-only จาก `D:\developer\media-storage-platform` เมื่อ 28 กรกฎาคม 2026 โดยไม่มีการแก้ไขไฟล์ต้นฉบับ

## ส่วนประกอบที่พบ

- `components/video-player.tsx` เป็น controller หลัก ดึง metadata/source จาก API, fallback ไป embed API เมื่อ 401/403, รองรับ MP4 แบบ native และ MPEG-TS ผ่าน `mpegts.js`
- `components/video-controls.tsx` เป็น control surface มี play/pause, ข้าม ±10 วินาที, seek, mute, speed 0.5–2x, Picture-in-Picture และ fullscreen
- `hooks/use-video-controls.ts` ผูก DOM events (`loadedmetadata`, `durationchange`, `timeupdate`, `play`, `pause`, `volumechange`, `ratechange`) และรองรับ WebKit fullscreen
- `hooks/use-playback-protection.ts` บล็อก playback เมื่อตรวจพบการเข้าถึงที่ไม่อนุญาต
- CSS ของ range control อยู่ที่ `app/globals.css`

## พฤติกรรมที่รักษาไว้

แพ็กเกจ `@video/player` ใช้ native video, custom overlay controls, seek ±10 วินาที, mute, fullscreen, poster, context-menu protection และ typed events เดิม โดยเปลี่ยนการรับ source ให้เป็น signed source จาก playback authorization และเพิ่ม callback ต่ออายุสิทธิ์ ไม่มีการคัดลอก network controller เก่าที่ผูกกับ API เดิมโดยตรง เพื่อป้องกัน coupling และไม่นับ play ตอนโหลดหน้า

## ความแตกต่างที่ตั้งใจ

ไม่ย้าย MPEG-TS เนื่องจากระบบใหม่กำหนด output playback เป็น MP4/HLS ผ่าน worker; Picture-in-Picture และ playback speed ไม่เปิดในรุ่นแรกเพื่อจำกัดการส่งออก content. การนับ play ต้องเริ่มจาก `playing` ต่อเนื่องประมาณ 3 วินาทีแล้วส่ง event ที่ idempotent ไป API
