import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageService } from "./storage.service";

afterEach(() => vi.unstubAllEnvs());

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
