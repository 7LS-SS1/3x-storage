const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
const {PrismaClient}=req('@prisma/client');
const target=process.env.METADATA_JOBS_TEST_DATABASE_URL;
const u=new URL(target||'');
if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/video_jobs_test')throw new Error('Isolated fixture DB required');
const out=path.join(root,'test-results/metadata-video-migration');fs.mkdirSync(out,{recursive:true});
const schema=`metadata_video_migration_probe_${Date.now()}`;
const admin=new PrismaClient({datasources:{db:{url:target}}});
const probe=new URL(target);probe.searchParams.set('schema',schema);
const client=new PrismaClient({datasources:{db:{url:probe.toString()}}});
const cli=path.join(root,'packages/database/node_modules/prisma/build/index.js');
function command(args){const r=spawnSync(process.execPath,[cli,...args],{cwd:root,env:{...process.env,DATABASE_URL:probe.toString(),DIRECT_DATABASE_URL:probe.toString()},encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error('Migration fixture command failed: '+r.stderr);}
async function main(){
 try{

  const migrations=path.join(root,'packages/database/prisma/migrations');
  const prior=fs.readdirSync(migrations).filter(n=>n<'20261112120000_metadata_video_jobs'&&fs.statSync(path.join(migrations,n)).isDirectory()).sort();
  fs.writeFileSync(path.join(out,'baseline.sql'),prior.map(n=>fs.readFileSync(path.join(migrations,n,'migration.sql'),'utf8')).join('\n'));
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  command(['db','execute','--file',path.join(out,'baseline.sql'),'--url',probe.toString()]);
  await client.user.create({data:{id:'owner',email:'owner@example.test',name:'Fixture Owner',role:'ADMIN',passwordHash:'fixture-only'}});
  await client.category.create({data:{id:'category',name:'Category',slug:'category'}});
  await client.video.create({data:{id:'video',publicId:'public-contract',title:'Existing title',description:'Existing description',status:'UPLOADING',uploadedById:'owner',originalKey:'original/contract.mp4',playbackKey:'playback/contract.mp4',posterKey:'poster/contract.jpg',categoryId:'category'}});
  await client.videoFile.create({data:{id:'file',videoId:'video',role:'ORIGINAL',storageKey:'original/contract.mp4',filename:'contract.mp4',extension:'mp4',mimeType:'video/mp4',sizeBytes:1024n}});
  await client.uploadSession.create({data:{videoId:'video',uploadedById:'owner',fileId:'upload-file',storageUploadId:'multipart-contract',storageKey:'in-flight/contract',originalFilename:'contract.mp4',extension:'mp4',mimeType:'video/mp4',sizeBytes:1024n,partSizeBytes:5120,expectedParts:1,expiresAt:new Date(Date.now()+3600000)}});
  await client.allowedDomain.create({data:{id:'domain',hostname:'example.test'}});
  await client.videoAllowedDomain.createMany({data:[{videoId:'video',allowedDomainId:'domain'}],skipDuplicates:true});
  const read=()=>client.video.findUniqueOrThrow({where:{id:'video'},include:{files:true,uploadSessions:true,allowedDomains:true,uploadedBy:true,category:true}});
  const serialize=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);
  const before=serialize(await read());
  command(['db','execute','--file',path.join(root,'packages/database/prisma/migrations/20261112120000_metadata_video_jobs/migration.sql'),'--url',probe.toString()]);
  if(serialize(await read())!==before)throw new Error('Existing source data changed');
  const count=await client.metadataVideoJob.count();if(count!==0)throw new Error('Unexpected new data');
  const report={passed:true,schema,unchanged:['Video ID','publicId','owner','title','description','category','storage keys','VideoFile','UploadSession and multipart ID','domain access relations'],newTablesEmpty:true};
  fs.writeFileSync(path.join(out,'migration-test.json'),JSON.stringify(report,null,2));
  console.log('METADATA_VIDEO_MIGRATION_PRESERVATION_OK existing records, IDs, metadata, storage keys, domain permissions and in-flight upload unchanged');
 }finally{await client.$disconnect();await admin.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
