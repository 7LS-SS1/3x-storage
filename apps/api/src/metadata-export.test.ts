import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./poster-delivery-url",()=>({createPosterDeliveryUrl:()=>"https://media.example.test/poster"}));
import { MetadataImportService, sourceOldEmbed } from "./metadata-import.service";
afterEach(()=>vi.unstubAllEnvs());
const video=(id:string)=>({id,title:'ชื่อที่แก้แล้ว "ไทย"',publicId:`public-${id}`,posterKey:'poster',category:{name:'ทั่วไป'},files:[{id:'file',role:'ORIGINAL'}]});
function setup(changes:any[],exists=true){
 const tx={metadataImportBatch:{findUnique:vi.fn(async()=>exists?{id:'batch'}:null)},metadataChange:{findMany:vi.fn(async(_query:unknown)=>changes)}};
 const prisma={$transaction:vi.fn(async(fn:any)=>fn(tx))};
 return {service:new MetadataImportService(prisma as never),tx};
}
describe('export changed metadata batch',()=>{
 it('exports all applied current videos across pages, deduplicates, excludes empty changes',async()=>{
  vi.stubEnv('PLAYER_URL','https://player.example.test');
  const changes=Array.from({length:30},(_,i)=>({fieldsJson:['title'],video:video(String(i))}));
  changes.push({fieldsJson:['description'],video:video('0')},{fieldsJson:[],video:video('noop')});
  const {service,tx}=setup(changes);const result=await service.exportChanged('batch');
  expect(result.videos).toHaveLength(30);expect(result.videos[0]).toEqual({oldEmbed:'',title:'ชื่อที่แก้แล้ว "ไทย"',category:'ทั่วไป',embedUrl:'https://player.example.test/embed/public-0',thumbnailUrl:'https://media.example.test/poster'});
  expect(tx.metadataChange.findMany.mock.calls[0]![0]).toMatchObject({where:{revertedAt:null,row:{batchId:'batch',status:'APPLIED'},video:{deletedAt:null,status:{notIn:['DELETING','DELETED']}}}});
 });
 it('returns empty without exporting the whole library when no changed records exist',async()=>{
  const {service}=setup([]);expect((await service.exportChanged('batch')).videos).toEqual([]);
 });
 it('reports unknown batch instead of exporting unrelated records',async()=>{
  const {service,tx}=setup([],false);await expect(service.exportChanged('missing')).rejects.toThrow('ไม่พบ batch');expect(tx.metadataChange.findMany).not.toHaveBeenCalled();
 });
 it('requires a configured player URL for nonempty exports',async()=>{
  vi.stubEnv('PLAYER_URL','');vi.stubEnv('ADMIN_URL','');const {service}=setup([{fieldsJson:['title'],video:video('1')}]);
  await expect(service.exportChanged('batch')).rejects.toThrow('PLAYER_URL');
 });
});

it('preserves the evidenced old embed verbatim and never guesses missing or ambiguous fields', () => {
 const value = '<iframe src="https://old.example/embed/a?x=1&amp;y=2"></iframe>';
 expect(sourceOldEmbed({record:{video_embed_code_raw:[{source_field:'embed',value}]}})).toBe(value);
 expect(sourceOldEmbed({record:{video_embed_code_raw:[{source_field:'other',value}]}})).toBe('');
 expect(sourceOldEmbed({record:{video_embed_code_raw:[{source_field:'embed',value},{source_field:'embed',value}]}})).toBe('');
});
