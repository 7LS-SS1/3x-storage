import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ states: [] as any[], effects: [] as any[], deps: [] as any[], request: vi.fn() }));
vi.mock("react", () => ({ useRef: (current: unknown) => ({ current }), useEffect: (fn: unknown, deps: unknown) => { h.effects.push(fn); h.deps.push(deps); }, useState: (initial: unknown) => { const i = h.states.push(initial) - 1; return [initial, (v: any) => { h.states[i] = typeof v === "function" ? v(h.states[i]) : v; }]; } }));
vi.mock("@/lib/api-client", () => ({ apiRequest: h.request, ApiRequestError: class extends Error { status = 400; retryAfterMs = 0; } }));
import { mergeVideoMatches, useMetadataVideoScan } from "./metadata-video-scan";
beforeEach(() => { h.states = []; h.effects = []; h.deps = []; h.request.mockReset(); });
const step = (score = 80, id = "v1") => ({ scanId: "scan", done: true, loaded: 30, sourceTotal: 30, scanned: 1, total: 1, frames: 12, failed: 0, current: null, failure: null, sources: [], matches: [{ rowId: "row-29", score, panel: "ช่อง 2/3 จากซ้าย" }], frame: { id, publicId: id, title: "Generic fixture", seconds: 12.3, thumbnail: "data:image/jpeg;base64,fixture" } });
it("retains the best timestamp per video and only the best five candidates without granting exact-cover approval", () => {
  let result = mergeVideoMatches({}, step(85));
  result = mergeVideoMatches(result, step(70)); expect(result["row-29"]!.candidates[0]!.cover?.score).toBe(85);
  for (let i = 2; i < 9; i++) result = mergeVideoMatches(result, step(80 + i, `v${i}`));
  expect(result["row-29"]!.candidates).toHaveLength(5);
  expect(result["row-29"]!.candidates[0]!.frame?.seconds).toBe(12.3);
  expect(result["row-29"]!.candidates.every(c => !c.cover?.exact)).toBe(true);
  expect(result["row-29"]!.autoStatus).toBeUndefined();
});
it("starts only on request and never sends apply requests for even a 100-point frame match", async () => {
  const scan = useMetadataVideoScan("batch"); h.effects[0](); expect(h.request).not.toHaveBeenCalled();
  h.request.mockResolvedValueOnce(step(100)).mockResolvedValueOnce({ stopped: true });
  await scan.start(70, 60);
  expect(h.request.mock.calls.map(c => c[0])).toEqual(["/metadata-import/batches/batch/video-scan", "/metadata-import/batches/batch/video-scan/scan/stop"]);
  expect(JSON.parse(h.request.mock.calls[0]![1].body)).toEqual({ threshold: 70, samples: 60 });
  expect(h.states[0].done).toBe(true); expect(h.states[1]["row-29"].autoStatus).toBeUndefined();
  expect(h.deps[0]).toEqual(["batch"]);
});
it("stops after the in-flight frame, preserves results and does not request the next step", async () => {
  const scan = useMetadataVideoScan("batch");
  h.request.mockImplementationOnce(async () => { scan.stop(); return { ...step(), done: false }; }).mockResolvedValueOnce({ stopped: true });
  await scan.start(80, 30);
  expect(h.request).toHaveBeenCalledTimes(2); expect(h.states[0].running).toBe(false); expect(h.states[0].done).toBe(false);
  expect(h.states[1]["row-29"].candidates).toHaveLength(1);
});
