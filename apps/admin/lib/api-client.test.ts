import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadApiRequest } from "./api-client";

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
