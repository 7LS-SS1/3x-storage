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
const {AdminSessionGuard,CsrfGuard}=require('../apps/api/dist/admin-auth.guard');
const {CategoriesController}=require('../apps/api/dist/categories.controller');
const argon2=apiRequire('argon2');
async function main(){
 const db=new URL(process.env.LOCAL_DATABASE_URL||'');
 if(!['localhost','127.0.0.1'].includes(db.hostname)||db.pathname!=='/video_metadata_test')throw new Error('Refusing non-fixture database');
 const prisma=new PrismaService();await prisma.$connect();
 const hash=await argon2.hash('Local-Metadata-Test-2026!');
 for(const [suffix,role] of [['admin','ADMIN'],['staff','STAFF']])await prisma.user.upsert({where:{id:`metadata-browser-${suffix}`},create:{id:`metadata-browser-${suffix}`,email:`metadata-${suffix}@example.test`,name:`Metadata ${suffix}`,role,passwordHash:hash},update:{passwordHash:hash,failedLoginCount:0,lockedUntil:null}});
 for(const n of [1,2])await prisma.video.upsert({where:{id:`metadata-browser-video-${n}`},create:{id:`metadata-browser-video-${n}`,publicId:`metadata-browser-public-${n}`,title:`วิดีโอทดลองเดิม ${n}`,description:'คำอธิบายเดิม',status:'READY',uploadedById:'metadata-browser-admin',originalKey:`fixture/${n}/original.mp4`,posterKey:`fixture/${n}/poster.jpg`},update:{}});
 class LocalModule{};
 Module({controllers:[MetadataImportController,CategoriesController],providers:[{provide:PrismaService,useValue:prisma},MetadataImportService,MetadataAdminGuard,AdminSessionGuard,CsrfGuard]})(LocalModule);
 const app=await NestFactory.create(LocalModule,{logger:false});app.setGlobalPrefix('api/v1');
 await app.listen(4008,'127.0.0.1');console.log('METADATA_LOCAL_API_READY http://localhost:4008 (isolated fixtures only)');
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await app.close();process.exit(0);});
}
main().catch(e=>{console.error(e.message);process.exit(1);});
