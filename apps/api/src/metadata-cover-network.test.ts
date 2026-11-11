import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ dns: vi.fn(), request: vi.fn(), responses: [] as { status: number; headers: Record<string, string | undefined>; bytes?: Buffer }[] }));
vi.mock("node:dns/promises", () => ({ lookup: network.dns }));
vi.mock("node:http", () => ({ request: network.request }));
vi.mock("node:https", () => ({ request: network.request }));
import { fetchCoverBytes } from "./metadata-cover-image";

describe("bounded public image HTTP reader", () => {
  beforeEach(() => {
    vi.clearAllMocks(); network.responses = [];
    network.dns.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    network.request.mockImplementation((_url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (e: Error) => void };
      request.destroy = e => { request.emit("error", e); request.emit("close"); };
      request.end = () => queueMicrotask(() => {
        const response = network.responses.shift()!;
        const stream = Object.assign(new PassThrough(), { statusCode: response.status, headers: response.headers });
        stream.on("close", () => request.emit("close"));
        callback(stream); stream.end(response.bytes || Buffer.alloc(0));
      });
      return request;
    });
  });
  it("pins resolved public address and does not send credentials", async () => {
    network.responses.push({ status: 200, headers: { "content-type": "image/png" }, bytes: Buffer.from("bytes") });
    expect(await fetchCoverBytes("https://public.example.test/cover.png")).toEqual(Buffer.from("bytes"));
    const options = network.request.mock.calls[0]![1]; const callback = vi.fn(); options.lookup("public.example.test", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "1.1.1.1", 4);
    expect(options.agent).toBe(false); expect(options.headers.Authorization).toBeUndefined(); expect(options.headers.Cookie).toBeUndefined();
  });
  it("revalidates redirect DNS and never connects to a private target", async () => {
    network.responses.push({ status: 302, headers: { location: "http://internal.example.test/secret" } });
    network.dns.mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(fetchCoverBytes("https://public.example.test/cover.png")).rejects.toThrow(/ไม่อนุญาต/);
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it("rejects mixed public/private DNS answers before any connection", async () => {
    network.dns.mockResolvedValue([{ address: "1.1.1.1", family: 4 }, { address: "169.254.169.254", family: 4 }]);
    await expect(fetchCoverBytes("https://public.example.test/cover.png")).rejects.toThrow(/ไม่อนุญาต/);
    expect(network.request).not.toHaveBeenCalled();
  });
  it("rejects malformed redirect locations without an uncaught callback exception", async () => {
    network.responses.push({ status: 302, headers: { location: "https://[invalid" } });
    await expect(fetchCoverBytes("https://public.example.test/cover.png")).rejects.toThrow(/redirect/);
  });
  it.each([
    { status: 403, headers: { "content-type": "text/html" }, bytes: Buffer.from("denied") },
    { status: 200, headers: { "content-type": "text/html" }, bytes: Buffer.from("<script/>") },
    { status: 200, headers: { "content-type": "image/png", "content-length": String(6 * 1024 * 1024) } },
    { status: 200, headers: { "content-type": "image/png" }, bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }
  ])("reports HTTP/type/size failure rather than a negative image match", async response => {
    network.responses.push(response); await expect(fetchCoverBytes("https://public.example.test/cover.png")).rejects.toThrow();
  });
});
