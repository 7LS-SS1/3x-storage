import "reflect-metadata";
import {describe,it,expect,vi} from "vitest";
import {MetadataCoverService} from "./metadata-cover.service";
function setup(count=30,duplicate=false){
 const sources=Array.from({length:count},(_,i)=>({id:`row-${i}`,normalizedJson:{imageUrl:`https://source.test/${duplicate?0:i}`}}));
 const videos=Array.from({length:40},(_,i)=>({id:String(i).padStart(3,'0'),publicId:`public-${i}`,title:'old',posterKey:`${i}`,updatedAt:new Date(0)}));
 const prisma={metadataImportBatch:{findUnique:vi.fn(async()=>({id:'batch'}))},metadataImportRow:{findMany:vi.fn(async(_query:unknown)=>sources),findUnique:vi.fn(async({where}:any)=>({id:where.id,batchId:'batch',status:'PENDING',normalizedJson:{imageUrl:`https://source.test/${where.id.split('-')[1]}`,title:'new'}}))},video:{findFirst:vi.fn(async(q:any)=>q.orderBy?{id:'999'}:videos.find(v=>v.id===q.where.id)),count:vi.fn(async()=>videos.length),findMany:vi.fn(async(q:any)=>videos.filter(v=>v.id>q.where.id.gt).slice(0,17))}};
 const images={load:vi.fn(async(_key:string,getUrl:()=>Promise<string>)=>{const url=await getUrl();return {sha256:url.split('/').at(-1),thumbnail:'data:image/jpeg;base64,fixture'};})};
 const service=new MetadataCoverService(prisma as never,{createReadUrl:async(key:string)=>`https://poster.test/${key}`} as never,images as never);
 const imports={preview:vi.fn(async()=>({token:'token'})),applyOne:vi.fn(async()=>({status:'APPLIED'}))};
 return {service,prisma,imports};
}
describe('whole batch cover processing',()=>{
 it('loads all 30 rows beyond display page and scans library once, applies before final video chunk',async()=>{
  const {service,prisma,imports}=setup();let response:any;let scanId:string|undefined;
  for(let i=0;i<4;i++){response=await service.wholeStep('batch',{scanId},'admin');scanId=response.scanId;expect(response.autoRows).toEqual([]);}
  expect(response.sourceRead).toBe(30);expect(prisma.metadataImportRow.findMany).toHaveBeenCalledTimes(1);
  expect(prisma.metadataImportRow.findMany.mock.calls[0]![0]).not.toHaveProperty('skip');
  response=await service.wholeStep('batch',{scanId},'admin');
  expect(response.next).not.toBeNull();expect(response.autoRows).toHaveLength(16);
  await service.applyExact(scanId!,'row-0',{id:'admin',name:'Admin'},imports as never);
  expect(imports.applyOne).toHaveBeenCalledTimes(1);
  response=await service.wholeStep('batch',{scanId},'admin');expect(response.autoRows).toContain('row-29');expect(response.next).toBeNull();
  expect(prisma.video.findMany).toHaveBeenCalledTimes(2);
 });
 it('does not let duplicate source covers overwrite one video across display pages',async()=>{
  const {service,prisma}=setup(30,true);let response:any,scanId:string|undefined;
  do{response=await service.wholeStep('batch',{scanId},'admin');scanId=response.scanId;expect(response.autoRows).toEqual([]);}while(response.next);
  expect(prisma.video.findMany).not.toHaveBeenCalled();
 });
 it('rejects another user resuming a whole-batch session',async()=>{
  const {service}=setup();const first=await service.wholeStep('batch',{},'admin');
  await expect(service.wholeStep('batch',{scanId:first.scanId},'other')).rejects.toThrow();
 });
});
