import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminSessionGuard } from "./admin-auth.guard";
import { PrismaService } from "./prisma.service";
import { StorageService } from "./storage.service";

function configuredCapacity() {
  const value = process.env.STORAGE_CAPACITY_BYTES?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    const capacity = BigInt(value);
    return capacity > 0n ? capacity : null;
  } catch {
    return null;
  }
}

@Controller("storage")
@UseGuards(AdminSessionGuard)
export class StorageController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  @Get("summary")
  async summary() {
    const [
      files,
      filesByRole,
      videosByStatus,
      activeUploads,
      recentFiles,
      storageHealth
    ] = await Promise.all([
      this.prisma.videoFile.aggregate({
        _sum: { sizeBytes: true },
        _count: { id: true }
      }),
      this.prisma.videoFile.groupBy({
        by: ["role"],
        _sum: { sizeBytes: true },
        _count: { id: true }
      }),
      this.prisma.video.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { id: true }
      }),
      this.prisma.uploadSession.count({
        where: {
          status: { in: ["INITIATED", "UPLOADING", "COMPLETING"] },
          expiresAt: { gt: new Date() }
        }
      }),
      this.prisma.videoFile.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          filename: true,
          role: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          video: { select: { id: true, title: true } }
        }
      }),
      this.storage.health()
    ]);

    const usedBytes = files._sum.sizeBytes || 0n;
    const capacityBytes = configuredCapacity();
    return {
      storage: storageHealth,
      usage: {
        usedBytes: usedBytes.toString(),
        capacityBytes: capacityBytes?.toString() || null,
        percent:
          capacityBytes && capacityBytes > 0n
            ? Math.min(100, Number((usedBytes * 10_000n) / capacityBytes) / 100)
            : null,
        objectCount: files._count.id,
        activeUploads
      },
      byRole: filesByRole.map(item => ({
        role: item.role,
        bytes: (item._sum.sizeBytes || 0n).toString(),
        count: item._count.id
      })),
      videosByStatus: videosByStatus.map(item => ({
        status: item.status,
        count: item._count.id
      })),
      recentFiles: recentFiles.map(file => ({
        id: file.id,
        filename: file.filename,
        role: file.role,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes.toString(),
        createdAt: file.createdAt.toISOString(),
        video: file.video
      }))
    };
  }
}
