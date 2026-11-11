import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { MetadataCoverService } from "./metadata-cover.service";

function setup({duplicate=false,failed=false,next=null as string|null,changed=false,sourceDuplicate=false}={}) {
 const date=new Date(0);
 const prisma={metadataImportRow:{findUnique:vi.fn(async()=>({id:"row",batchId:"batch",status:"PENDING",normalizedJson:{imageUrl:"https://source.example/cover",title:"Imported",description:""}}))},video:{findFirst:vi.fn(async()=>({id:"video",posterKey:"poster",updatedAt:date}))}};
 const images={load:vi.fn(async(key:string)=>({sha256:changed&&key.startsWith("verify-poster")?"different":"identical"}))};
 const service=new MetadataCoverService(prisma as never,{createReadUrl:async()=>"https://poster.example/cover"} as never,images as never);
 const candidate=(id:string)=>({id,cover:{exact:true,score:100}});
 const page=vi.spyOn(service as any,"page").mockResolvedValue({ceiling:"z",next,total:1,scanned:1,compared:1,missing:0,failed:failed?[{videoId:"v",reason:"HTTP 403"}]:[],rows:[{rowId:"row",error:null,candidates:[candidate("video"),...(duplicate?[candidate("other")]:[])]},...(sourceDuplicate?[{rowId:"row2",error:null,candidates:[candidate("video")]}]:[])]});
 const imports={preview:vi.fn(async()=>({token:"token"})),applyOne:vi.fn(async()=>({rowId:"row",status:"APPLIED"}))};
 return {service,page,imports,prisma,images};
}
const actor={id:"admin",name:"Admin"};
describe("automatic exact-cover updates",()=>{
 it("requires a complete server scan, verifies fresh bytes, applies only nonempty text and records cover proof",async()=>{
  const {service,imports,images}=setup();const scan=await service.scan("batch",{page:1},actor.id);
  expect(scan.autoRows).toEqual(["row"]);
  await service.applyExact(scan.scanId!,"row",actor,imports as never);
  expect(images.load).toHaveBeenCalledTimes(2);
  expect(imports.preview).toHaveBeenCalledWith(actor,"row",{targetVideoId:"video",fields:["title"],allowEmpty:false,values:{}},false,expect.objectContaining({basis:"exact_cover_sha256",sha256:"identical"}));
  expect(imports.applyOne).toHaveBeenCalledWith(actor,"row","token");
 });
 it.each([{duplicate:true},{failed:true},{next:"more"},{sourceDuplicate:true}])("does not automatically write ambiguous or incomplete scans %j",async options=>{
  const {service,imports}=setup(options);const scan=await service.scan("batch",{page:1},actor.id);
  expect(scan.autoRows).toEqual([]);
  await expect(service.applyExact(scan.scanId!,"row",actor,imports as never)).rejects.toThrow();
  expect(imports.applyOne).not.toHaveBeenCalled();
 });
 it("rejects another user and forged/expired scan identity",async()=>{
  const {service,imports}=setup();const scan=await service.scan("batch",{page:1},actor.id);
  await expect(service.applyExact(scan.scanId!,"row",{...actor,id:"other"},imports as never)).rejects.toThrow();
  await expect(service.applyExact("forged","row",actor,imports as never)).rejects.toThrow();
  expect(imports.preview).not.toHaveBeenCalled();
 });
 it("rejects a cover changed after scan",async()=>{
  const {service,imports}=setup({changed:true});const scan=await service.scan("batch",{page:1},actor.id);
  await expect(service.applyExact(scan.scanId!,"row",actor,imports as never)).rejects.toThrow();
  expect(imports.applyOne).not.toHaveBeenCalled();
 });
 it("replaying an applied row does not write twice",async()=>{
  const {service,imports,prisma}=setup();const scan=await service.scan("batch",{page:1},actor.id);
  prisma.metadataImportRow.findUnique.mockResolvedValueOnce({id:"row",batchId:"batch",status:"APPLIED",normalizedJson:{imageUrl:"x",title:"x",description:""}});
  expect(await service.applyExact(scan.scanId!,"row",actor,imports as never)).toMatchObject({replay:true,status:"APPLIED"});expect(imports.applyOne).not.toHaveBeenCalled();
 });
 it("prevents skipping scan pages",async()=>{
  const {service}=setup();await expect(service.scan("batch",{page:1,after:"skip"},actor.id)).rejects.toThrow();
 });
});
