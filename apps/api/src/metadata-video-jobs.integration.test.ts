import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { MetadataVideoJobs, MetadataVideoJobsController } from "./metadata-video-jobs.service";
import { MetadataVideoProcessor, packImage, frameIdentity } from "./metadata-video-processor";
import * as images from "./metadata-cover-image";

// Explicit opt-in to the isolated fixture database; never use DATABASE_URL.
const url = process.env.METADATA_JOBS_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/video_jobs_test")) throw new Error("Use isolated local video_jobs_test database only");
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://invalid/unused" } } });
const jobs = new MetadataVideoJobs(db as never);
let image: images.CoverFingerprint, bytes: Buffer, version: { etag: string; size: number; bucket: string; endpoint: string };
let frames: any, storage: any, processor: MetadataVideoProcessor;
async function batch(id = "batch") {
  await db.metadataImportBatch.create({ data: { id, actorUserId: "admin", filename: "generic.json", format: "json", headerJson: {}, rows: { create: { id: id+"-row", ordinal: 1, siteUrl: "https://example.test", postId: "1", rawJson: {}, normalizedJson: { imageUrl: "https://example.test/fixture.png" }, errorsJson: [], warningsJson: [] } } } });
}
async function createVideo(id = "video") {
  return db.video.create({ data: { id, publicId: "public-"+id, title: "Generic scene", description: "Original description", status: "UPLOADED", originalKey: id+".mp4", uploadedById: "admin" } });
}
async function next() {
  await db.metadataVideoTask.updateMany({ where: { status: "PENDING" }, data: { runAfter: new Date(0) } });
  const task = await jobs.claim(2); expect(task).not.toBeNull(); await processor.process(task!); return task!;
}
async function drain() {
  for (let i=0;i<30;i++) {
    if (!await db.metadataVideoJob.count({ where: { status: "RUNNING" } })) break;
    await next();
  }
}
describe.skipIf(!url)("durable video jobs against PostgreSQL", () => {
  beforeAll(async () => {
    const pixels=Buffer.alloc(64*96*3);
    for(let y=0;y<96;y++) for(let x=0;x<64;x++) {
      const i=(y*64+x)*3; pixels[i]=x*4;pixels[i+1]=y*2;pixels[i+2]=((x>>3)+(y>>3))%2?220:10;
    }
    bytes=await sharp(pixels,{raw:{width:64,height:96,channels:3}}).png().toBuffer();
    image=await images.fingerprintCover(bytes);
    await db.$connect();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.$executeRawUnsafe('TRUNCATE "MetadataVideoJob","MetadataVideoIndex","MetadataImportBatch","Video","User" CASCADE');
    await db.user.create({ data: { id:"admin",email:"fixture@example.test",name:"Fixture admin",passwordHash:"not-a-login",role:"ADMIN" } });
    await batch(); await createVideo();
    vi.spyOn(images,"fetchCoverBytes").mockResolvedValue(bytes);
    version={etag:'"v1"',size:12345,bucket:"test",endpoint:"https://storage.example.test"};
    storage={ objectVersion: vi.fn(async()=>({...version})) };
    frames={duration:vi.fn(async()=>120),frame:vi.fn(async()=>image)};
    processor=new MetadataVideoProcessor(db as never,storage,frames,jobs);
  });
  afterAll(async()=>{ vi.restoreAllMocks(); await db.$disconnect(); });

  it("starts once, snapshots eligible videos, gates sources and caps concurrent claims", async()=>{
    await createVideo("video2"); await createVideo("with-poster");
    await db.video.update({where:{id:"with-poster"},data:{posterKey:"poster.jpg"}});
    const starts=await Promise.all([jobs.start("batch","admin",{samples:12}),jobs.start("batch","admin",{samples:12})]);
    expect(starts[0]).toEqual(starts[1]); expect(await db.metadataVideoTask.count()).toBe(3);
    const source=await jobs.claim(2); expect(source?.kind).toBe("SOURCE"); expect(await jobs.claim(2)).toBeNull();
    await processor.process(source!);
    const claims=await Promise.all(Array.from({length:5},()=>jobs.claim(2)));
    expect(claims.filter(Boolean)).toHaveLength(2);
    await Promise.all(claims.filter(Boolean).map(t=>processor.process(t!)));
    expect((await jobs.status("batch","admin",1)).job?.status).toBe("COMPLETED");
    expect((await jobs.status("batch","other-admin",1)).job).toBeNull();
    await expect(jobs.control("batch","other-admin","pause")).rejects.toThrow();
  });

  it("pauses after the current frame and a new worker resumes without decoding that frame again", async()=>{
    await jobs.start("batch","admin",{samples:12}); await next();
    frames.frame.mockImplementationOnce(async()=>{await jobs.control("batch","admin","pause");return image;});
    await next();
    expect(await db.metadataVideoFrame.count()).toBe(1);
    expect(await db.metadataVideoMatch.count()).toBe(0);
    expect((await jobs.status("batch","admin",1)).job?.status).toBe("PAUSED");
    expect(await jobs.claim(2)).toBeNull();
    await jobs.control("batch","admin","resume");
    processor=new MetadataVideoProcessor(db as never,storage,frames,new MetadataVideoJobs(db as never));
    await drain();
    expect(frames.frame).toHaveBeenCalledTimes(12);
    const status=await jobs.status("batch","admin",1);
    expect(status.job).toMatchObject({status:"COMPLETED",scanned:1,frames:12,cached:1});
    expect(status.rows[0]?.candidates[0]?.cover.exact).toBe(false);
  });

  it("reuses all frames across batches and invalidates the cache when the object ETag changes", async()=>{
    const before=await db.video.findMany(); await jobs.start("batch","admin",{samples:12}); await drain();
    const coldReads=frames.frame.mock.calls.length;
    await batch("second"); await jobs.start("second","admin",{samples:12}); await drain();
    expect(frames.frame.mock.calls.length).toBe(coldReads);
    expect((await jobs.status("second","admin",1)).job?.cached).toBe(12);
    version.etag='"v2"'; await batch("third"); await jobs.start("third","admin",{samples:12}); await drain();
    expect(frames.frame.mock.calls.length).toBe(coldReads+12);
    expect(await db.video.findMany()).toEqual(before);
    expect(await db.metadataChange.count()).toBe(0);
    expect(frames.frame.mock.calls.every((c:any[])=>c.length===3&&c[2])).toBe(true);
    console.log("CACHE_FIXTURE: cold=12 decodes; warm=0 decodes; changed ETag=12 decodes");
  });

  it("fences expired workers and recovers their queued work after restart", async()=>{
    await jobs.start("batch","admin",{samples:12}); const first=await jobs.claim(2);
    await db.metadataVideoTask.update({where:{id:first!.id},data:{leaseUntil:new Date(0)}});
    const second=await jobs.claim(2); expect(second!.id).toBe(first!.id); expect(second!.leaseToken).not.toBe(first!.leaseToken);
    expect(await jobs.renew(first!,{status:"DONE"})).toBe(false);
    await jobs.release(first!,"stale");
    expect((await db.metadataVideoTask.findUniqueOrThrow({where:{id:second!.id}})).leaseToken).toBe(second!.leaseToken);
    await processor.process(second!); await drain();
    expect((await jobs.status("batch","admin",1)).job?.status).toBe("COMPLETED");
  });

  it("waits for in-flight work to acknowledge pause before retrying failed sources", async()=>{
    await jobs.start("batch","admin",{samples:12}); await next();
    const task=await jobs.claim(2); expect(task?.kind).toBe("VIDEO");
    await jobs.control("batch","admin","pause");
    await expect(jobs.control("batch","admin","retry")).rejects.toThrow("รอเฟรมปัจจุบัน");
    expect(await jobs.renew(task!)).toBe(false);
    await jobs.release(task!); await jobs.control("batch","admin","retry"); await drain();
    expect((await jobs.status("batch","admin",1)).job?.status).toBe("COMPLETED");
  });

  it("rolls back a failed result transaction, keeps frame checkpoints and retries without decoding again", async()=>{
    await jobs.start("batch","admin",{samples:12}); await next();
    await db.$executeRawUnsafe(`CREATE FUNCTION fixture_fail_match() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fixture_fail_match BEFORE INSERT ON "MetadataVideoMatch" FOR EACH ROW EXECUTE FUNCTION fixture_fail_match()`);
    try { await next(); expect(await db.metadataVideoMatch.count()).toBe(0); expect(await db.metadataVideoTask.count({where:{kind:"VIDEO",status:"DONE"}})).toBe(0); expect(await db.metadataVideoFrame.count()).toBe(12); }
    finally { await db.$executeRawUnsafe('DROP TRIGGER fixture_fail_match ON "MetadataVideoMatch"'); await db.$executeRawUnsafe("DROP FUNCTION fixture_fail_match()"); }
    await drain(); expect(frames.frame).toHaveBeenCalledTimes(12);
    expect(await db.metadataVideoMatch.count()).toBe(1);
  });

  it("retries failed source images and re-compares videos that finished while no source was usable", async()=>{
    vi.mocked(images.fetchCoverBytes).mockRejectedValue(new Error("fixture offline"));
    await jobs.start("batch","admin",{samples:12}); await drain();
    expect((await jobs.status("batch","admin",1)).job).toMatchObject({sourceFailed:1,status:"COMPLETED"});
    expect(frames.frame).not.toHaveBeenCalled();
    vi.mocked(images.fetchCoverBytes).mockResolvedValue(bytes);
    await jobs.control("batch","admin","retry"); await drain();
    expect((await jobs.status("batch","admin",1)).job).toMatchObject({sourceFailed:0,status:"COMPLETED"});
    expect(await db.metadataVideoMatch.count()).toBe(1);
  });

  it("retains only five best candidates under concurrent completion and replaces jobs without deleting frame cache", async()=>{
    for(let i=2;i<=7;i++)await createVideo("video"+i);
    await jobs.start("batch","admin",{samples:12}); await next();
    for(let i=0;i<4;i++){const a=await jobs.claim(2),b=await jobs.claim(2);await Promise.all([a,b].filter(Boolean).map(t=>processor.process(t!)));}
    expect(await db.metadataVideoMatch.count()).toBe(5);
    const old=(await jobs.status("batch","admin",1)).job!;
    const cached=await db.metadataVideoFrame.count();
    const fresh=await jobs.start("batch","admin",{samples:30,restart:true});
    expect(fresh.jobId).not.toBe(old.id);expect(await db.metadataVideoMatch.count()).toBe(0);expect(await db.metadataVideoFrame.count()).toBe(cached);
    await expect(jobs.start("batch","admin",{restart:true})).rejects.toThrow();
  });
});
it("requires admin/session/CSRF guards and accepts only bounded frame settings", async()=>{
  expect(Reflect.getMetadata("__guards__",MetadataVideoJobsController).map((g:any)=>g.name)).toEqual(["AdminSessionGuard","MetadataAdminGuard","CsrfGuard"]);
  for(const name of ["start","status","control"] as const) expect(Reflect.getMetadata("__headers__",MetadataVideoJobsController.prototype[name])).toContainEqual({name:"Cache-Control",value:"private, no-store"});
  await expect(jobs.start("unused","admin",{samples:1000})).rejects.toThrow();
  await expect(jobs.start("unused","admin",{url:"http://localhost/private"})).rejects.toThrow();
  const version={etag:"a",size:1,bucket:"b",endpoint:"e"};
  expect(frameIdentity("v","key",version)).not.toBe(frameIdentity("v","other",version));
  expect(packImage({sha256:"x",pixels:Buffer.from([1]),edges:Buffer.from([0]),thumbnail:"",width:1,height:1}).pixels).toBe("AQ==");
});
