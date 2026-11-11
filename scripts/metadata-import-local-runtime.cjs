// Isolated runtime for browser verification. Not included in production AppModule startup.
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {createRequire}=require('node:module');
const apiRequire=createRequire(path.join(root,'apps/api/package.json'));
apiRequire('reflect-metadata');
const {Module}=apiRequire('@nestjs/common');
const {NestFactory}=apiRequire('@nestjs/core');
const {PrismaService}=require('../apps/api/dist/prisma.service');
const {MetadataImportService}=require('../apps/api/dist/metadata-import.service');
const {MetadataImportController,MetadataAdminGuard}=require('../apps/api/dist/metadata-import.controller');
const {MetadataCoverController,MetadataCoverService}=require('../apps/api/dist/metadata-cover.service');
const {fingerprintCover}=require('../apps/api/dist/metadata-cover-image');
const {AdminSessionGuard,CsrfGuard}=require('../apps/api/dist/admin-auth.guard');
const {CategoriesController}=require('../apps/api/dist/categories.controller');
const {VideosController}=require('../apps/api/dist/videos.controller');
const {StorageService}=require('../apps/api/dist/storage.service');
const argon2=apiRequire('argon2');
async function main(){
 const db=new URL(process.env.LOCAL_DATABASE_URL||'');
 if(!['localhost','127.0.0.1'].includes(db.hostname)||db.pathname!=='/video_metadata_test')throw new Error('Refusing non-fixture database');
 const prisma=new PrismaService();await prisma.$connect();
 const hash=await argon2.hash('Local-Metadata-Test-2026!');
 for(const [suffix,role] of [['admin','ADMIN'],['staff','STAFF']])await prisma.user.upsert({where:{id:`metadata-browser-${suffix}`},create:{id:`metadata-browser-${suffix}`,email:`metadata-${suffix}@example.test`,name:`Metadata ${suffix}`,role,passwordHash:hash},update:{passwordHash:hash,failedLoginCount:0,lockedUntil:null}});
 for(const n of [1,2])await prisma.video.upsert({where:{id:`metadata-browser-video-${n}`},create:{id:`metadata-browser-video-${n}`,publicId:`metadata-browser-public-${n}`,title:`วิดีโอทดลองเดิม ${n}`,description:'คำอธิบายเดิม',status:'READY',uploadedById:'metadata-browser-admin',originalKey:`fixture/${n}/original.mp4`,posterKey:`fixture/${n}/poster.jpg`},update:{}});
 let mediaServer;
 if(process.env.METADATA_TEST_MEDIA_FILE){
  const bytes=require('node:fs').readFileSync(process.env.METADATA_TEST_MEDIA_FILE);
  mediaServer=require('node:http').createServer((req,res)=>{if(req.url!=='/fixture.webm'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'video/webm','Content-Length':bytes.length,'Access-Control-Allow-Origin':'http://localhost:3008'});res.end(bytes);});
  await new Promise(resolve=>mediaServer.listen(4018,'127.0.0.1',resolve));
  for(const n of [1,2]){
   await prisma.video.update({where:{id:`metadata-browser-video-${n}`},data:{posterKey:null}});
   const data={videoId:`metadata-browser-video-${n}`,role:'ORIGINAL',storageKey:`fixture/${n}/original.webm`,filename:'fixture.webm',extension:'webm',mimeType:'video/webm',sizeBytes:BigInt(bytes.length),width:320,height:180};
   await prisma.videoFile.upsert({where:{id:`metadata-browser-file-${n}`},create:{id:`metadata-browser-file-${n}`,...data},update:data});
  }
 }
 class LocalModule{};
 // Generic synthetic cover bytes only; no external images or R2 access in this runtime.
 const sharp=apiRequire('sharp');
 const coverBytes=await sharp(Buffer.from('<svg width="240" height="180"><rect width="240" height="180" fill="#154060"/><rect x="30" y="30" width="80" height="120" fill="#d0b060"/><circle cx="170" cy="90" r="40" fill="#80bbcc"/></svg>')).png().toBuffer();
 const fixtureCover=await fingerprintCover(coverBytes);
 const coverImages={load:async(key)=>{if(key==='source:https://example.test/cover-fixture.png'||key.startsWith('poster:fixture/1/poster.jpg:'))return fixtureCover;throw new Error('Fixture cover unavailable');}};
 if(process.env.METADATA_TEST_COVERS==='1')await prisma.video.update({where:{id:'metadata-browser-video-1'},data:{posterKey:'fixture/1/poster.jpg'}});
 const storage={createReadUrl:async(key)=>{if(/^fixture\/[12]\/original\.webm$/.test(key))return 'http://localhost:4018/fixture.webm';if(key==='fixture/1/poster.jpg')return 'https://example.test/cover-fixture.png';throw new Error('Fixture media only');}};
 const covers=new MetadataCoverService(prisma,storage,coverImages);
 Module({controllers:[MetadataImportController,MetadataCoverController,CategoriesController,...(mediaServer?[VideosController]:[])],providers:[{provide:PrismaService,useValue:prisma},{provide:MetadataCoverService,useValue:covers},...(mediaServer?[{provide:StorageService,useValue:storage}]:[]),MetadataImportService,MetadataAdminGuard,AdminSessionGuard,CsrfGuard]})(LocalModule);
 const app=await NestFactory.create(LocalModule,{logger:false});app.setGlobalPrefix('api/v1');
 await app.listen(4008,'127.0.0.1');console.log('METADATA_LOCAL_API_READY http://localhost:4008 (isolated fixtures only)');
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();process.exit(0);});
}
main().catch(e=>{console.error(e.message);process.exit(1);});
