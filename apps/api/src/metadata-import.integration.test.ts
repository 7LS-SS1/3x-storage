import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "./prisma.service";
import { AdminSessionGuard, CsrfGuard } from "./admin-auth.guard";
import { MetadataAdminGuard, MetadataImportController } from "./metadata-import.controller";
import { MetadataImportService } from "./metadata-import.service";
import { MetadataCoverController, MetadataCoverService } from "./metadata-cover.service";
import { fingerprintCover } from "./metadata-cover-image";
import sharp from "sharp";

// Explicitly opt in to an isolated local database; never use the project's production env.
const db = process.env.METADATA_TEST_DATABASE_URL;
describe.skipIf(!db)("Metadata import PostgreSQL + authenticated HTTP", () => {
  let prisma: PrismaService, service: MetadataImportService, app: INestApplication, url: string;
  const prefix = `metadata-fixture-${Date.now()}`;
  const actor = { id: `${prefix}-admin`, name: "Metadata Test Admin" };
  const video = `${prefix}-video`, video2 = `${prefix}-video2`, failVideo = `${prefix}-fail`;
  const csrf = randomBytes(32).toString("base64url"), session = randomBytes(32).toString("base64url"), staffSession = randomBytes(32).toString("base64url");
  const createdBatches: string[] = [];
  const origin = "http://localhost:3000";
  const input = (post = 1, extra = {}) => ({ site_url: `https://${prefix}.example.test`, post_id: post, title: "ชื่อใหม่ภาษาไทย", description: '<p>คำอธิบายต้นฉบับ</p>[caption]', categories: ["หนึ่ง", "สอง"], tags: ["tag1", "tag2"], image_url: "https://example.test/cover.jpg", ...extra });
  async function stage(post = 1, extra = {}, targetVideoId = video) {
    const data = input(post, extra);
    const b = await service.stage(actor, { buffer: Buffer.from(JSON.stringify([data])), originalname: `${prefix}.json` }); createdBatches.push(b.id);
    const r = (await service.batch(b.id, 1)).rows[0]!;
    const p = await service.preview(actor, r.id, { targetVideoId, fields: ["title", "description", "imageUrl"], values: {} });
    return { b, r, p, data };
  }
  async function http(path: string, method = "GET", body?: unknown, overrides: Record<string, string> = {}) {
    const headers = { cookie: `video_session=${session}; video_csrf=${csrf}`, origin, "x-csrf-token": csrf, ...(body ? { "content-type": "application/json" } : {}), ...overrides };
    return fetch(`${url}/metadata-import${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  }
  beforeAll(async () => {
    const target = new URL(db!);
    if (!['localhost','127.0.0.1'].includes(target.hostname) || target.pathname !== '/video_metadata_test') throw new Error('Refusing non-isolated test database');
    process.env.NODE_ENV = "test"; process.env.LOCAL_DATABASE_URL = db; process.env.LOCAL_ADMIN_URL = origin; process.env.CSRF_SECRET = "metadata-test-csrf-secret-only-1234567890"; process.env.SESSION_SECRET = "metadata-test-session-secret-only-1234567890"; process.env.SESSION_COOKIE_NAME = "video_session";
    prisma = new PrismaService(); await prisma.$connect(); service = new MetadataImportService(prisma);
    await prisma.user.createMany({ data: [{ ...actor, email: `${prefix}@example.test`, passwordHash: "fixture-only", role: "ADMIN" }, { id: `${prefix}-staff`, name: "Test Staff", email: `${prefix}-staff@example.test`, passwordHash: "fixture-only", role: "STAFF" }] });
    await prisma.category.create({ data: { id: `${prefix}-cat`, name: `${prefix} category`, slug: `${prefix}-category` } });
    for (const id of [video, video2, failVideo]) await prisma.video.create({ data: { id, publicId: `${id}-public`, title: "ชื่อเดิม", description: "คำอธิบายเดิม", uploadedById: actor.id, status: "READY", originalKey: `${id}/original.mp4`, playbackKey: `${id}/play.mp4`, posterKey: `${id}/poster.jpg` } });
    for (const [token, userId] of ([[session, actor.id], [staffSession, `${prefix}-staff`]] as const)) await prisma.session.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), csrfHash: createHmac("sha256", process.env.CSRF_SECRET).update(csrf).digest("hex"), expiresAt: new Date(Date.now()+3600000), absoluteExpiresAt: new Date(Date.now()+7200000) } });
    // Vitest/esbuild does not emit TypeScript design:paramtypes. Production tsc does.
    Reflect.defineMetadata("design:paramtypes", [MetadataImportService], MetadataImportController);
    const fixtureCover = await fingerprintCover(await sharp({ create: { width: 32, height: 32, channels: 3, background: "#306090" } }).png().toBuffer());
    const coverService = new MetadataCoverService(prisma, { createReadUrl: async () => "https://example.test/cover.jpg" } as never, { load: async () => fixtureCover } as never);
    Reflect.defineMetadata("design:paramtypes", [MetadataCoverService, MetadataImportService], MetadataCoverController);
    Reflect.defineMetadata("design:paramtypes", [PrismaService], AdminSessionGuard);
    Reflect.defineMetadata("design:paramtypes", [PrismaService], CsrfGuard);
    @Module({ controllers: [MetadataImportController, MetadataCoverController], providers: [{ provide: PrismaService, useValue: prisma }, { provide: MetadataImportService, useValue: service }, { provide: MetadataCoverService, useValue: coverService }, AdminSessionGuard, MetadataAdminGuard, CsrfGuard] }) class TestModule {}
    app = await NestFactory.create(TestModule, { logger: false }); await app.listen(0, "127.0.0.1"); url = await app.getUrl();
  }, 30000);
  afterAll(async () => {
    if (app) await app.close();
    // Keep generic fixtures in this isolated database for manual inspection; no shared-data cleanup.
    if (prisma) await prisma.$disconnect();
  });

  it("checks live schema and denies anonymous STAFF missing CSRF wrong origin", async () => {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'Metadata%'`;
    expect(tables.length).toBe(3);
    expect((await http('/batches')).headers.get('cache-control')).toContain('no-store');
    expect((await http('/batches','GET',undefined,{cookie:''})).status).toBe(401);
    expect((await http('/batches','GET',undefined,{cookie:`video_session=${staffSession}; video_csrf=${csrf}`})).status).toBe(403);
    expect((await http('/apply','POST',{confirm:true,items:[]},{'x-csrf-token':''})).status).toBe(403);
    expect((await http('/apply','POST',{confirm:true,items:[]},{origin:'https://wrong.example.test'})).status).toBe(403);
  });
  it("protects cover comparison with ADMIN and CSRF and never changes staged data or videos", async () => {
    const { b, r } = await stage(985, { target_video_id: undefined, image_url: "https://example.test/cover.jpg" });
    const before = await prisma.video.findUniqueOrThrow({ where: { id: video } });
    const rowBefore = await prisma.metadataImportRow.findUniqueOrThrow({ where: { id: r.id } });
    const path = `/batches/${b.id}/cover-scan`;
    expect((await http(path, 'POST', { page: 1 }, { cookie: '' })).status).toBe(401);
    expect((await http(path, 'POST', { page: 1 }, { cookie: `video_session=${staffSession}; video_csrf=${csrf}` })).status).toBe(403);
    expect((await http(path, 'POST', { page: 1 }, { 'x-csrf-token': '' })).status).toBe(403);
    expect((await http(path, 'POST', { page: 1 }, { origin: 'https://wrong.example.test' })).status).toBe(403);
    const response = await http(path, 'POST', { page: 1 });
    expect(response.status).toBe(201); expect(response.headers.get('cache-control')).toContain('no-store');
    const result = await response.json();
    expect(result.rows[0].source).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.scanned).toBeLessThanOrEqual(16);
    expect(await prisma.video.findUniqueOrThrow({ where: { id: video } })).toEqual(before);
    expect(await prisma.metadataImportRow.findUniqueOrThrow({ where: { id: r.id } })).toEqual(rowBefore);
  });
  it("requires confirmation and caps server-side apply at two", async () => {
    const items = [1,2,3].map(i=>({rowId:String(i),token:randomUUID()}));
    expect((await http('/apply','POST',{confirm:false,items:items.slice(0,1)})).status).toBe(400);
    expect((await http('/apply','POST',{confirm:true,items})).status).toBe(400);
    expect((await http('/apply','POST',{confirm:true,items:[items[0],items[0]]})).status).toBe(400);
  });
  it("uploads real multipart CSV, normalizes duplicate source keys, and never auto-matches title", async () => {
    const form = new FormData(); form.append('file',new Blob(['site_url,post_id,title\nhttps://example.test,1,ชื่อเดิม\nhttps://example.test/,1,ชื่อเดิม']),`${prefix}.csv`);
    const response=await fetch(`${url}/metadata-import/batches`,{method:'POST',headers:{cookie:`video_session=${session}; video_csrf=${csrf}`,origin,'x-csrf-token':csrf},body:form});
    expect(response.status).toBe(201); const {batch}=await response.json();createdBatches.push(batch.id);
    const result=await service.batch(batch.id,1);expect(result.rows.every(r=>r.status==='INVALID')).toBe(true);
    expect(await service.targets('ชื่อเดิม')).toEqual([]);
    expect((await service.targets(`${video}-public`))[0]!.id).toBe(video);
  });
  it("updates only chosen fields, preserves protected media fields, replays without duplication and rolls back", async () => {
    const before=await prisma.video.findUniqueOrThrow({where:{id:video}});
    const {r,p,data}=await stage();
    expect((await prisma.video.findUniqueOrThrow({where:{id:video}})).title).toBe(before.title);
    const applied=await service.applyOne(actor,r.id,p.token);expect(applied.status).toBe('APPLIED');
    const current=await prisma.video.findUniqueOrThrow({where:{id:video}});
    for(const field of ['id','publicId','uploadedById','originalKey','playbackKey','posterKey','status'] as const)expect(current[field]).toBe(before[field]);
    expect(current.title).toBe(data.title);expect(current.description).toBe(data.description);
    expect((await prisma.videoMetadataImage.findUniqueOrThrow({where:{videoId:video}})).imageUrl).toBe(data.image_url);
    expect((await service.applyOne(actor,r.id,p.token)).replay).toBe(true);
    const again=await stage();expect((await service.applyOne(actor,again.r.id,again.p.token)).status).toBe('NOOP');
    expect(await prisma.wordPressMetadataSource.count({where:{siteUrl:data.site_url,postId:'1'}})).toBe(1);
    expect(await prisma.metadataChange.count({where:{rowId:r.id}})).toBe(1);
    const source=await prisma.wordPressMetadataSource.findUniqueOrThrow({where:{siteUrl_postId:{siteUrl:data.site_url,postId:'1'}}});expect(source.rawJson).toEqual({record:data});
    const change=await prisma.metadataChange.findFirstOrThrow({where:{rowId:r.id,revertedAt:null}});expect(change.actorUserId).toBe(actor.id);expect(change.rowId).toBe(r.id);
    await service.rollback(actor,change.id);expect((await prisma.video.findUniqueOrThrow({where:{id:video}})).title).toBe(before.title);expect((await service.rollback(actor,change.id)).replay).toBe(true);
  });
  it("skips empty by default, supports explicit clear, rejects stale and cross-actor previews", async () => {
    const {r}=await stage(2,{description:''},video2);
    const p=await service.preview(actor,r.id,{targetVideoId:video2,fields:['description'],values:{}});expect(p.after.description).toBe('คำอธิบายเดิม');
    await expect(service.applyOne({id:'another-admin',name:'Another'},r.id,p.token)).rejects.toThrow();
    const clear=await service.preview(actor,r.id,{targetVideoId:video2,fields:['description'],values:{},allowEmpty:true});expect(clear.after.description).toBeNull();
    await prisma.video.update({where:{id:video2},data:{title:'เปลี่ยนหลังตรวจ'}});await expect(service.applyOne(actor,r.id,clear.token)).rejects.toThrow(/ตรวจใหม่/);
    const refreshed=await service.preview(actor,r.id,{targetVideoId:video2,fields:['description'],values:{},allowEmpty:true});await service.applyOne(actor,r.id,refreshed.token);expect((await prisma.video.findUniqueOrThrow({where:{id:video2}})).description).toBeNull();
  });
  it("refuses source remap and rollback over a later edit", async () => {
    const {r,p}=await stage(3,{},video);const result=await service.applyOne(actor,r.id,p.token);
    const next=await stage(3,{},video);await expect(service.preview(actor,next.r.id,{targetVideoId:video2,fields:['title'],values:{}})).rejects.toThrow(/อื่น/);
    await prisma.video.update({where:{id:video},data:{title:'งานใหม่ต้องเก็บ'}});await expect(service.rollback(actor,result.changeId!)).rejects.toThrow(/งานใหม่/);expect((await prisma.video.findUniqueOrThrow({where:{id:video}})).title).toBe('งานใหม่ต้องเก็บ');
  });
  it("rolls back every write when an actual PostgreSQL audit trigger fails, while another row commits", async () => {
    const failed=await stage(40,{},failVideo), ok=await stage(41,{title:'รายการสำเร็จแยก transaction'},video2);
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION metadata_fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId" = '${failVideo}' AND NEW.action = 'WORDPRESS_METADATA_APPLIED' THEN RAISE EXCEPTION 'intentional fixture failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER metadata_fixture_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION metadata_fixture_fail_audit()');
    try {
      const response=await http('/apply','POST',{confirm:true,items:[{rowId:ok.r.id,token:ok.p.token},{rowId:failed.r.id,token:failed.p.token}]});expect(response.status).toBe(201);
      const result=await response.json();expect(result.results.map((r:{success:boolean})=>r.success)).toEqual([true,false]);
      expect((await prisma.video.findUniqueOrThrow({where:{id:failVideo}})).title).toBe('ชื่อเดิม');expect(await prisma.videoMetadataImage.count({where:{videoId:failVideo}})).toBe(0);expect(await prisma.metadataChange.count({where:{rowId:failed.r.id}})).toBe(0);expect(await prisma.wordPressMetadataSource.count({where:{targetVideoId:failVideo}})).toBe(0);expect((await service.detail(failed.r.id)).row.status).toBe('PENDING');
    }finally{await prisma.$executeRawUnsafe('DROP TRIGGER metadata_fixture_audit_failure ON "AuditLog"');await prisma.$executeRawUnsafe('DROP FUNCTION metadata_fixture_fail_audit()');}
    expect((await service.applyOne(actor,failed.r.id,failed.p.token)).status).toBe('APPLIED');
  });
  it("serializes concurrent confirms for one row and preserves one journal",async()=>{
    const {r,p}=await stage(50,{title:'concurrent'},video2);const result=await Promise.all([service.applyOne(actor,r.id,p.token),service.applyOne(actor,r.id,p.token)]);expect(result.filter(r=>r.replay).length).toBe(1);expect(await prisma.metadataChange.count({where:{rowId:r.id}})).toBe(1);
  });
  it("rejects protected field injection and expired previews, and validates category selection",async()=>{
    const {r}=await stage(55,{},video2);
    await expect(service.preview(actor,r.id,{targetVideoId:video2,fields:['title'],values:{originalKey:'tampered'}})).rejects.toThrow();
    await expect(service.preview(actor,r.id,{targetVideoId:'missing-video',fields:['title'],values:{}})).rejects.toThrow();
    await expect(service.preview(actor,r.id,{targetVideoId:video2,fields:['categoryId'],values:{categoryId:'missing-category'}})).rejects.toThrow();
    const p=await service.preview(actor,r.id,{targetVideoId:video2,fields:['categoryId'],values:{categoryId:`${prefix}-cat`}});
    await prisma.metadataImportRow.update({where:{id:r.id},data:{previewJson:JSON.parse(JSON.stringify({...p,expiresAt:0}))}});
    await expect(service.applyOne(actor,r.id,p.token)).rejects.toThrow(/หมดอายุ/);
    const fresh=await service.preview(actor,r.id,{targetVideoId:video2,fields:['categoryId'],values:{categoryId:`${prefix}-cat`}});await service.applyOne(actor,r.id,fresh.token);
    expect((await prisma.video.findUniqueOrThrow({where:{id:video2}})).categoryId).toBe(`${prefix}-cat`);
  });
  it("discovers exact embed and file candidates without binding, fetching URLs or changing videos", async () => {
    const before = await prisma.video.findUniqueOrThrow({ where: { id: video2 } });
    const name = `${prefix}-same.mp4`;
    for (const id of [video, video2]) await prisma.videoFile.create({ data: { id: `${id}-discovery-file`, videoId: id, role: "ORIGINAL", filename: name, storageKey: `${id}/discovery.mp4`, mimeType: "video/mp4", extension: "mp4", sizeBytes: 123456789012345n, width: 1920, height: 1080 } });
    const batch = await service.stage(actor, { originalname: "discovery.json", buffer: Buffer.from(JSON.stringify([input(90, { iframe_sources: [{ src_raw: `https://foreign.example.test/embed/${video2}-public`, parsed_embed_id: "wrong" }], video_urls: [{ source_field: "video_url", value: `https://media.example.test/${name}` }] })])) });
    const row = (await service.batch(batch.id, 1)).rows[0]!;
    const response = await http(`/rows/${row.id}/candidates`);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    const result = await response.json(); expect(result.candidates).toHaveLength(2);
    const candidate = result.candidates.find((c: { id: string }) => c.id === video2);
    expect(candidate.evidence.join(" ")).toContain("origin ยังไม่ยืนยัน");
    expect(candidate.files[0].sizeBytes).toBe("123456789012345");
    expect(JSON.stringify(result)).not.toContain("storageKey");
    expect((await prisma.metadataImportRow.findUniqueOrThrow({ where: { id: row.id } })).previewToken).toBeNull();
    expect(await prisma.video.findUniqueOrThrow({ where: { id: video2 } })).toEqual(before);
    expect((await http(`/rows/${row.id}/candidates`, "GET", undefined, { cookie: "" })).status).toBe(401);
    expect((await http(`/rows/${row.id}/candidates`, "GET", undefined, { cookie: `video_session=${staffSession}` })).status).toBe(403);
    await prisma.video.update({ where: { id: video2 }, data: { deletedAt: new Date() } });
    expect((await service.candidates(row.id)).candidates.map(c => c.id)).toEqual([video]);
    await prisma.video.update({ where: { id: video2 }, data: { deletedAt: null } });
    const empty = await service.stage(actor, { originalname: "no-references.json", buffer: Buffer.from(JSON.stringify([input(91, { title: before.title, filename: name, parsed_embed_id: before.publicId })])) });
    expect((await service.candidates((await service.batch(empty.id, 1)).rows[0]!.id)).candidates).toEqual([]);
  });
  it("returns discovered candidates directly with each paginated batch row without writes", async () => {
    const batch = await service.stage(actor, { originalname: "batch-review.json", buffer: Buffer.from(JSON.stringify(Array.from({ length: 26 }, (_, i) => input(200 + i, { target_video_id: video2 })))) });
    const before = await prisma.metadataChange.count();
    const first = await http(`/batches/${batch.id}/review?page=1`); expect(first.status).toBe(200);
    const page1 = await first.json(); expect(page1.rows).toHaveLength(25); expect(page1.total).toBe(26);
    expect(page1.rows[0].discovery.candidates.map((v: { id: string }) => v.id)).toEqual([video2]);
    const page2 = await service.reviewBatch(batch.id, 2); expect(page2.rows).toHaveLength(1); expect(page2.rows[0]?.ordinal).toBe(26);
    expect(await prisma.metadataChange.count()).toBe(before);
    expect(await prisma.metadataImportRow.count({ where: { batchId: batch.id, previewToken: { not: null } } })).toBe(0);
    expect((await http(`/batches/${batch.id}/review`, "GET", undefined, { cookie: `video_session=${staffSession}` })).status).toBe(403);
  });
  it("requires content approval and imports only staged title/description without accepting browser overrides", async () => {
    const batch = await service.stage(actor, { originalname: "text-approval.json", buffer: Buffer.from(JSON.stringify([input(300, { title: "ชื่อจากไฟล์เท่านั้น", description: "<p>คำอธิบายจากไฟล์</p>[shortcode]", target_video_id: video2 })])) });
    const row = (await service.batch(batch.id, 1)).rows[0]!;
    const route = `/rows/${row.id}/review-preview`, body = { targetVideoId: video2, contentConfirmed: true };
    for (const invalid of [{ targetVideoId: video2 }, { ...body, contentConfirmed: false }, { ...body, values: { title: "tampered" } }, { ...body, fields: ["categoryId"] }]) expect((await http(route, "POST", invalid)).status).toBe(400);
    expect((await http(route, "POST", body, { "x-csrf-token": "wrong" })).status).toBe(403);
    const before = await prisma.video.findUniqueOrThrow({ where: { id: video2 } });
    const image = await prisma.videoMetadataImage.findUnique({ where: { videoId: video2 } });
    const response = await http(route, "POST", body); expect(response.status).toBe(201); const plan = await response.json();
    expect(plan.fields.sort()).toEqual(["description", "title"]); expect(plan.contentReviewedAt).toEqual(expect.any(String));
    expect((await prisma.video.findUniqueOrThrow({ where: { id: video2 } })).title).toBe(before.title);
    await service.applyOne(actor, row.id, plan.token);
    const after = await prisma.video.findUniqueOrThrow({ where: { id: video2 } });
    expect(after).toEqual({ ...before, title: "ชื่อจากไฟล์เท่านั้น", description: "<p>คำอธิบายจากไฟล์</p>[shortcode]", updatedAt: after.updatedAt });
    expect(await prisma.videoMetadataImage.findUnique({ where: { videoId: video2 } })).toEqual(image);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: video2, action: "WORDPRESS_METADATA_APPLIED" }, orderBy: { createdAt: "desc" } });
    expect(audit.metadataJson).toMatchObject({ contentReviewedAt: plan.contentReviewedAt });
  });
  it("keeps existing text for empty import fields and rejects an entirely empty approval", async () => {
    const batch = await service.stage(actor, { originalname: "empty-text.json", buffer: Buffer.from(JSON.stringify([input(301, { title: "ใหม่", description: "" }), input(302, { title: "", description: "" })])) });
    const rows = (await service.batch(batch.id, 1)).rows;
    const plan = await service.reviewPreview(actor, rows[0]!.id, { targetVideoId: video2, contentConfirmed: true });
    expect(plan.after.description).toBe(plan.before.description); expect(plan.fields).toEqual(["title"]);
    await expect(service.reviewPreview(actor, rows[1]!.id, { targetVideoId: video2, contentConfirmed: true })).rejects.toThrow(/ไม่มีชื่อเรื่อง/);
  });
  it("undoes two successive changes in reverse order without overwriting journal snapshots",async()=>{
    const original=await prisma.video.findUniqueOrThrow({where:{id:video2}});
    const a=await stage(60,{title:'รุ่น A'},video2);const appliedA=await service.applyOne(actor,a.r.id,a.p.token);
    const b=await stage(60,{title:'รุ่น B'},video2);const appliedB=await service.applyOne(actor,b.r.id,b.p.token);
    await expect(service.rollback(actor,appliedA.changeId!)).rejects.toThrow();
    await service.rollback(actor,appliedB.changeId!);expect((await prisma.video.findUniqueOrThrow({where:{id:video2}})).title).toBe('รุ่น A');
    await service.rollback(actor,appliedA.changeId!);expect((await prisma.video.findUniqueOrThrow({where:{id:video2}})).title).toBe(original.title);
    expect((await prisma.metadataChange.findUniqueOrThrow({where:{id:appliedA.changeId!}})).afterJson).toMatchObject({title:'รุ่น A'});
  });
});
