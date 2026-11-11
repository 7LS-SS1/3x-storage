const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json'));
const {PrismaClient}=req('@prisma/client');
const target=process.env.METADATA_TEST_DATABASE_URL;
const u=new URL(target||'');
if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/video_metadata_test')throw new Error('Isolated fixture DB required');
const out=path.join(root,'artifacts/metadata-import');fs.mkdirSync(out,{recursive:true});
const schema=`metadata_migration_probe_${Date.now()}`;
const admin=new PrismaClient({datasources:{db:{url:target}}});
const probe=new URL(target);probe.searchParams.set('schema',schema);
const client=new PrismaClient({datasources:{db:{url:probe.toString()}}});
const cli=path.join(root,'packages/database/node_modules/prisma/build/index.js');
function command(args){const r=spawnSync(process.execPath,[cli,...args],{cwd:root,env:{...process.env,DATABASE_URL:probe.toString(),DIRECT_DATABASE_URL:probe.toString()},encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error('Migration fixture command failed: '+r.stderr);}
async function main(){
 try{
  const full=fs.readFileSync(path.join(root,'packages/database/prisma/schema.prisma'),'utf8');
  fs.writeFileSync(path.join(out,'baseline.prisma'),full.split('// Metadata import staging')[0].replace(/^  (metadataImage|wordpressSources|metadataChanges).*\r?\n/gm,''));
  command(['migrate','diff','--from-empty','--to-schema-datamodel',path.join(out,'baseline.prisma'),'--script','--output',path.join(out,'baseline.sql')]);
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  command(['db','execute','--file',path.join(out,'baseline.sql'),'--url',probe.toString()]);
  await client.user.create({data:{id:'owner',email:'owner@example.test',name:'Fixture Owner',role:'ADMIN',passwordHash:'fixture-only'}});
  await client.category.create({data:{id:'category',name:'Category',slug:'category'}});
  await client.video.create({data:{id:'video',publicId:'public-contract',title:'Existing title',description:'Existing description',status:'UPLOADING',uploadedById:'owner',originalKey:'original/contract.mp4',playbackKey:'playback/contract.mp4',posterKey:'poster/contract.jpg',categoryId:'category'}});
  await client.videoFile.create({data:{id:'file',videoId:'video',role:'ORIGINAL',storageKey:'original/contract.mp4',filename:'contract.mp4',extension:'mp4',mimeType:'video/mp4',sizeBytes:1024n}});
  await client.uploadSession.create({data:{videoId:'video',uploadedById:'owner',fileId:'upload-file',storageUploadId:'multipart-contract',storageKey:'in-flight/contract',originalFilename:'contract.mp4',extension:'mp4',mimeType:'video/mp4',sizeBytes:1024n,partSizeBytes:5120,expectedParts:1,expiresAt:new Date(Date.now()+3600000)}});
  await client.allowedDomain.create({data:{id:'domain',hostname:'example.test',videos:{create:{videoId:'video'}}}});
  const read=()=>client.video.findUniqueOrThrow({where:{id:'video'},include:{files:true,uploadSessions:true,allowedDomains:true,uploadedBy:true,category:true}});
  const serialize=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);
  const before=serialize(await read());
  command(['db','execute','--file',path.join(root,'packages/database/prisma/migrations/20261112090000_wordpress_metadata_import/migration.sql'),'--url',probe.toString()]);
  if(serialize(await read())!==before)throw new Error('Existing source data changed');
  const count=await client.metadataImportBatch.count();if(count!==0)throw new Error('Unexpected new data');
  const report={passed:true,schema,unchanged:['Video ID','publicId','owner','title','description','category','storage keys','VideoFile','UploadSession and multipart ID','domain access relations'],newTablesEmpty:true};
  fs.writeFileSync(path.join(out,'migration-test.json'),JSON.stringify(report,null,2));
  console.log('METADATA_MIGRATION_PRESERVATION_OK existing records, IDs, metadata, storage keys, domain permissions and in-flight upload unchanged');
 }finally{await client.$disconnect();await admin.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
