# Player Integration

ใช้ `SecureVideoPlayer` จาก `@video/player` โดยส่ง signed `source`, `poster`, `title`, `onEvent` และ `onRefreshAuthorization`.

event ที่รองรับ: `ready`, `play`, `playing`, `pause`, `ended`, `error`, `timeupdate`. ฝั่ง embed ต้องเริ่ม timer เมื่อได้รับ `playing`, ยกเลิกเมื่อ `pause`/`ended`, และหลังเล่นต่อเนื่อง 3 วินาทีจึง POST `play_started` พร้อม playback session token. Backend บังคับ uniqueness `(playbackSessionId,eventType)`.

CSS ถูก scope ด้วย prefix `.svp` เพื่อไม่รั่วสู่ host page.
