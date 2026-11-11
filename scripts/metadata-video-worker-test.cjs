// Runs the actual compiled Nest worker against an explicitly isolated PostgreSQL database.
// No video/image network calls: the one source fixture intentionally has no image.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/api/package.json')),{PrismaClient}=req('@prisma/client');
const url=process.env.METADATA_JOBS_TEST_DATABASE_URL,u=new URL(url||'');
if(u.hostname!=='127.0.0.1'||u.pathname!=='/video_jobs_test')throw Error('Isolated local video_jobs_test database required');
const db=new PrismaClient({datasources:{db:{url}}}),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let child;
 try {
  await db.metadataVideoJob.updateMany({where:{status:'RUNNING'},data:{status:'PAUSED'}});
  const id='process-fixture-'+Date.now(),temp=path.join(root,'test-results/metadata-worker');
  fs.mkdirSync(temp,{recursive:true});
  await db.metadataImportBatch.create({data:{id,actorUserId:'fixture',filename:'generic.json',format:'json',headerJson:{},rows:{create:{id:id+'-row',ordinal:1,rawJson:{},normalizedJson:{},errorsJson:[],warningsJson:[]}}}});
  const job=await db.metadataVideoJob.create({data:{batchId:id,actorUserId:'fixture',threshold:80,samples:12,tasks:{create:{kind:'SOURCE',refId:id+'-row'}}}});
  child=spawn(process.execPath,[path.join(root,'apps/api/dist/metadata-video-worker.js')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,USERPROFILE:process.env.USERPROFILE,LOCALAPPDATA:process.env.LOCALAPPDATA,TEMP:temp,TMP:temp,NODE_ENV:'production',DATABASE_URL:url,DIRECT_DATABASE_URL:url,METADATA_VIDEO_CONCURRENCY:'2'}});
  let logs='';child.stdout.on('data',d=>{logs+=d;});child.stderr.on('data',d=>{logs+=d;});
  const until=Date.now()+30000;
  while(Date.now()<until){
   const current=await db.metadataVideoJob.findUniqueOrThrow({where:{id:job.id},include:{tasks:true}});
   if(current.status==='COMPLETED'){
    assert.equal(current.tasks[0].status,'FAILED');assert.equal(current.tasks[0].attempts,3);
    assert.ok(current.tasks[0].error.includes('ไม่มีรูปต้นทาง'));
    assert.ok(Number(fs.readFileSync(path.join(temp,'metadata-video-heartbeat'),'utf8'))>Date.now()-15000);
    console.log('METADATA_WORKER_PROCESS_OK actual Nest boot, PostgreSQL queue, bounded retries, persisted completion, database heartbeat');
    return;
   }
   if(child.exitCode!==null)throw Error('Worker exited before completion: '+logs);
   await delay(1000);
  }
  throw Error('Worker fixture timed out: '+logs);
 }finally{if(child){child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r);});}await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
