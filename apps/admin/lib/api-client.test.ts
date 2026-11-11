import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, uploadApiRequest } from "./api-client";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("multipart record retries", () => {
  it("waits for Retry-After before repeating an idempotent record", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { cookie: "video_csrf=test" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Too Many Requests" }), { status: 429, headers: { "Retry-After": "60" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ recorded: true })));
    vi.stubGlobal("fetch", fetchMock);
    const result = uploadApiRequest("/uploads/test/parts/record", { method: "POST", body: "{}" });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ recorded: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry rejected permissions", async () => {
    vi.stubGlobal("document", { cookie: "video_csrf=test" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadApiRequest("/uploads/test/parts/record", { method: "POST" })).rejects.toThrow("Forbidden");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("API error details", () => {
  it.each([
    [{ error: "Bad Request", message: "นำเข้าได้ไม่เกิน 500 รายการต่อไฟล์" }, "นำเข้าได้ไม่เกิน 500 รายการต่อไฟล์"],
    [{ error: "Bad Request", message: ["invalid file", "invalid row"] }, "invalid file, invalid row"],
    [{ error: { message: "specific failure" } }, "specific failure"],
    [{ error: "Bad Request", message: "" }, "Bad Request"]
  ])("shows the actionable message for %j", async (payload, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 400 })));
    await expect(apiRequest("/metadata-import/batches")).rejects.toThrow(expected);
  });
});
