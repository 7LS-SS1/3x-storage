import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ states: [] as any[], effects: [] as any[], deps: [] as any[], request: vi.fn() }));
vi.mock("react", () => ({ useRef: (current: unknown) => ({ current }), useEffect: (fn: unknown, deps: unknown) => { h.effects.push(fn); h.deps.push(deps); }, useState: (initial: unknown) => { const i = h.states.push(initial) - 1; return [initial, (v: any) => { h.states[i] = typeof v === "function" ? v(h.states[i]) : v; }]; } }));
vi.mock("@/lib/api-client", () => ({ apiRequest: h.request }));
import { useMetadataVideoScan } from "./metadata-video-scan";
beforeEach(() => { vi.useFakeTimers(); h.states = []; h.effects = []; h.deps = []; h.request.mockReset(); });
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
const response={job:{id:"job",status:"RUNNING"},rows:[{rowId:"row-29",candidates:[{id:"video",cover:{exact:false,score:100}}]}]};
it("only reads the persisted job on mount and leaves it running on unmount", async()=>{
  h.request.mockResolvedValue(response);
  useMetadataVideoScan("batch",2);h.effects[0](); const cleanup=h.effects[1]();
  await Promise.resolve();
  expect(h.request.mock.calls[0]![0]).toBe("/metadata-import/batches/batch/video-job?page=2");
  expect(h.states[1]["row-29"].candidates[0].cover.exact).toBe(false);
  cleanup();await vi.advanceTimersByTimeAsync(30000);
  expect(h.request).toHaveBeenCalledTimes(1);
  expect(h.request.mock.calls[0]![1].signal.aborted).toBe(true);
});
it("sends explicit start/pause/resume only, never automatic metadata writes", async()=>{
  h.request.mockResolvedValue({jobId:"job"});
  const scan=useMetadataVideoScan("batch");
  await scan.start(70,12); await scan.control("pause"); await scan.control("resume");
  expect(h.request.mock.calls.map(c=>c[0])).toEqual(["/metadata-import/batches/batch/video-job","/metadata-import/batches/batch/video-job/pause","/metadata-import/batches/batch/video-job/resume"]);
  expect(JSON.parse(h.request.mock.calls[0]![1].body)).toEqual({threshold:70,samples:12,restart:false});
});
it("ignores a late GET after leaving the batch",async()=>{
  let resolve!: (value:unknown)=>void; h.request.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  useMetadataVideoScan("batch");h.effects[0](); const cleanup=h.effects[1]();cleanup();
  resolve(response); await Promise.resolve();
  expect(h.states[0]).toBeNull();expect(h.states[1]).toEqual({});
});
