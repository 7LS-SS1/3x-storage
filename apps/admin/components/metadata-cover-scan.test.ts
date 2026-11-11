import { beforeEach, describe, expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({effects:[] as (()=>unknown)[],states:[] as any[],request:vi.fn()}));
vi.mock("react",()=>({useRef:(current:unknown)=>({current}),useEffect:(fn:()=>unknown)=>h.effects.push(fn),useState:(initial:unknown)=>{const index=h.states.push(initial)-1;return [initial,(value:any)=>{h.states[index]=typeof value==='function'?value(h.states[index]):value;}];}}));
vi.mock("@/lib/api-client",()=>({apiRequest:h.request,ApiRequestError:class extends Error{status=400;retryAfterMs=0;}}));
import { useMetadataCoverScan } from "./metadata-cover-scan";
beforeEach(()=>{h.effects=[];h.states=[];h.request.mockReset();});
const page=(autoRows:string[])=>({scanId:"server-scan",autoRows,ceiling:"v",next:null,total:1,scanned:1,compared:1,missing:0,failed:[],rows:[{rowId:"row",source:"data:image/jpeg;base64,x",error:null,candidates:[]}]});
describe("automatic cover updates in the review screen",()=>{
 it("applies server-eligible rows without playback or a confirmation click",async()=>{
  h.request.mockResolvedValueOnce(page(["row"])).mockResolvedValueOnce({status:"APPLIED"});
  useMetadataCoverScan("batch",1,"row");h.effects[0]!();
  await vi.waitFor(()=>expect(h.states[0].row.autoStatus).toBe("APPLIED"));
  expect(h.request.mock.calls[1]![0]).toBe("/metadata-import/rows/row/auto-cover-apply");
  expect(JSON.parse(h.request.mock.calls[1]![1].body)).toEqual({scanId:"server-scan"});
 });
 it("does not write when the server finds no eligible exact match",async()=>{
  h.request.mockResolvedValueOnce(page([]));useMetadataCoverScan("batch",1,"row");h.effects[0]!();
  await vi.waitFor(()=>expect(h.states[1].done).toBe(true));expect(h.request).toHaveBeenCalledTimes(1);
 });
 it("shows a failed auto-write without claiming success",async()=>{
  h.request.mockResolvedValueOnce(page(["row"])).mockRejectedValueOnce(new Error("changed cover"));
  useMetadataCoverScan("batch",1,"row");h.effects[0]!();
  await vi.waitFor(()=>expect(h.states[0].row.autoError).toBe("changed cover"));expect(h.states[0].row.autoStatus).toBeUndefined();
 });
});
