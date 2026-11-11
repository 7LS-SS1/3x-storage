import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageService } from "./storage.service";

afterEach(() => vi.unstubAllEnvs());

it("reads object identity and pins every frame range to that ETag", async () => {
  const send = vi.fn().mockResolvedValueOnce({ ETag: '"version-1"', ContentLength: 100 }).mockResolvedValueOnce({ Body: "fixture" });
  const service = new StorageService();
  (service as any).configuration = { bucket: "fixture", endpoint: "https://storage.example.test" };
  (service as any).client = { send };
  expect(await service.objectVersion("selected-key")).toEqual({ etag: '"version-1"', size: 100, bucket: "fixture", endpoint: "https://storage.example.test" });
  await service.readRange("selected-key", "bytes=0-99", new AbortController().signal, '"version-1"');
  expect(send.mock.calls[1]![0].input).toEqual({ Bucket: "fixture", Key: "selected-key", Range: "bytes=0-99", IfMatch: '"version-1"' });
});

describe("browser multipart signing", () => {
  it("does not sign an empty-body checksum before the browser supplies the part", async () => {
    vi.stubEnv("STORAGE_DRIVER", "r2");
    vi.stubEnv("R2_BUCKET", "test");
    vi.stubEnv("R2_S3_ENDPOINT", "https://example.r2.cloudflarestorage.com");
    vi.stubEnv("R2_ACCESS_KEY_ID", "test");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "test");
    const url = new URL(await new StorageService().presignPart("video/test.mp4", "upload-id", 1, 120));
    expect(url.searchParams.get("partNumber")).toBe("1");
    expect(url.searchParams.get("uploadId")).toBe("upload-id");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect([...url.searchParams.keys()].some(key => key.toLowerCase().startsWith("x-amz-checksum-"))).toBe(false);
  });
});
