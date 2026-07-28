# Database

Prisma schema ครอบคลุม User/Session, Video/VideoFile, Category, AllowedDomain, multipart UploadSession, PlaybackSession, idempotent PlayEvent, BandwidthDaily และ AuditLog.

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

ใช้ soft delete ผ่าน `Video.deletedAt`; service queries ต้องกรอง `deletedAt: null` เป็นค่าเริ่มต้น.
