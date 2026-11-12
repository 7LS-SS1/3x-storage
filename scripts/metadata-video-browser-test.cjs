// Actual React components/browser, synthetic API responses. No production writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),admin=createRequire(path.join(root,'apps/admin/package.json')),api=createRequire(path.join(root,'apps/api/package.json'));
const vite=createRequire(createRequire(api.resolve('vitest/package.json')).resolve('vite')),esbuild=vite('esbuild');
const {chromium}=admin('@playwright/test'),sharp=api('sharp');
(async()=>{
 const out=path.join(root,'test-results/metadata-video');fs.mkdirSync(out,{recursive:true});
 const built=await esbuild.build({stdin:{contents:'import React from "react";import{createRoot}from"react-dom/client";import{MetadataImportManager}from"./components/metadata-import-manager";createRoot(document.getElementById("root")).render(<MetadataImportManager/>);',resolveDir:path.join(root,'apps/admin'),loader:'tsx'},bundle:true,write:false,outdir:out,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'alias',setup(build){build.onResolve({filter:/^@\//},args=>({path:path.join(root,'apps/admin',args.path.slice(2)+'.ts')}));}}]});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'';
 const poster='data:image/jpeg;base64,'+(await sharp(Buffer.from('<svg width="320" height="180"><rect width="320" height="180" fill="#34495e"/><rect x="40" y="30" width="70" height="110" fill="#f1c40f"/><circle cx="230" cy="90" r="45" fill="#1abc9c"/></svg>')).jpeg().toBuffer()).toString('base64');
 const rows=Array.from({length:26},(_,i)=>({id:'row-'+i,ordinal:i+1,siteUrl:'https://example.test',postId:String(i+1),status:'PENDING',normalizedJson:{title:'วิดีโอทดสอบทั่วไป '+(i+1),description:'คำอธิบายจากไฟล์ทดสอบ'},errorsJson:[],warningsJson:[],discovery:{candidates:[],warnings:[],truncated:false},discoveryError:null}));
 const batch={id:'batch',filename:'generic-fixture.json',createdAt:new Date().toISOString()};let calls=[],job=null;
 const media=fs.readFileSync(process.env.METADATA_VIDEO_FIXTURE || path.join(out,'generic.mp4'));
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/fixture.mp4'){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),media.length-1):media.length-1;res.writeHead(range?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})});res.end(media.subarray(start,end+1));return;}
  if(!req.url.startsWith('/backend')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><head><style>body{background:#101114;color:#eee;font-family:Arial}button,select{padding:10px} ${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);return;}
  let body='';for await(const chunk of req)body+=chunk;calls.push({url:req.url,body,method:req.method});let data;
  if(req.url==='/backend/metadata-import/batches')data={batches:[batch]};
  else if(req.url.startsWith('/backend/metadata-import/history'))data={changes:[],total:0,page:1};
  else if(req.url.includes('/review?page=')){const page=Number(new URL(req.url,'http://localhost').searchParams.get('page'));data={batch,rows:rows.slice((page-1)*25,page*25),total:26,page};}

  else if(req.url.endsWith('/video-job') && req.method==='POST'){
   assert.equal(JSON.parse(body).threshold,0);assert.equal(JSON.parse(body).samples,12);
   job={id:'job',status:'RUNNING',threshold:0,samples:12,createdAt:new Date().toISOString(),lastActivityAt:new Date().toISOString(),loaded:26,sourceTotal:26,total:1,scanned:0,frames:1,cached:0,applied:0,skipped:0,failed:0,sourceFailed:0,current:[{refId:'generic-video',framesDone:1}],failures:[]};
   data={jobId:'job'};
  } else if(req.url.includes('/video-job?page=')){
   const p=Number(new URL(req.url,'http://localhost').searchParams.get('page'));
   data={job,rows:job?rows.slice((p-1)*25,p*25).map(r=>({rowId:r.id,autoBasis:'video_frame_similarity',autoStatus:job.status==='COMPLETED'&&['row-0','row-25'].includes(r.id)?'APPLIED':undefined,source:poster,error:null,candidates:['row-0','row-25'].includes(r.id)?[{id:'generic-video',publicId:'public-fixture',title:'วิดีโอไม่มีปก',evidence:['ผลทดสอบเฟรม'],frame:{seconds:2.5,panel:'ช่อง 2/3 จากซ้าย'},cover:{score:86.4,exact:false,thumbnail:poster}}]:[]})):[]};
  } else if(req.url.endsWith('/video-job/pause')){job.status='PAUSED';data={jobId:'job'};}
  else if(req.url.endsWith('/video-job/resume')){job.status='COMPLETED';job.applied=2;job.scanned=1;job.frames=12;job.cached=1;job.current=[];data={jobId:'job'};}
  else if(req.url.includes('/admin-preview-token'))data={preview:{title:'วิดีโอทดสอบ',url:`http://${req.headers.host}/fixture.mp4`,mimeType:'video/mp4',posterUrl:null}};
  else {res.statusCode=400;data={message:'Unexpected fixture request'};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().addCookies([{name:'video_csrf',value:'fixture-csrf',url:origin}]);await page.goto(origin);
  await page.getByLabel('โหมดจับคู่',{exact:true}).selectOption('video');await page.getByLabel('เลือก batch',{exact:true}).selectOption('batch');
  await page.getByRole('heading',{name:'ตรวจจับด้วยวิดีโอ',exact:true}).waitFor();
  assert.equal(calls.some(c=>c.url.includes('scan')),false);
  await page.getByLabel('จำนวนเฟรม',{exact:true}).selectOption('12');
  await page.getByLabel('คะแนนขั้นต่ำ',{exact:true}).selectOption('0');
  await page.getByRole('button',{name:'เริ่มตรวจจับด้วยวิดีโอ',exact:true}).click();

  await page.getByText(/กำลังตรวจเบื้องหลัง/).waitFor();
  await page.reload();
  await page.getByLabel('โหมดจับคู่',{exact:true}).selectOption('video');
  await page.getByLabel('เลือก batch',{exact:true}).selectOption('batch');
  await page.getByText(/กำลังตรวจเบื้องหลัง/).waitFor();
  assert.equal(calls.filter(c=>c.method==='POST'&&c.url.endsWith('/video-job')).length,1);
  assert.equal(calls.some(c=>c.url.endsWith('/pause')||c.url.endsWith('/stop')),false);
  await page.getByRole('button',{name:'พักงานตรวจวิดีโอ',exact:true}).click();
  await page.getByText(/พักงานแล้ว/).waitFor();
  await page.getByRole('button',{name:'ทำต่อจากงานเดิม',exact:true}).click();
  await page.getByText(/จบรอบตรวจแล้ว/).waitFor();


  await page.getByText('บันทึกชื่อเรื่อง/คำอธิบายอัตโนมัติจากไฟล์ เพราะผ่านเกณฑ์การจับคู่ที่ตั้งไว้ — ย้อนคืนได้ในประวัติ',{exact:true}).waitFor();
  const starts=calls.filter(c=>c.method==='POST'&&c.url.endsWith('/video-job')).length;
  await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
  await page.getByRole('heading',{name:/รายการ 26.*บันทึกแล้ว/}).waitFor();
  assert.equal(calls.filter(c=>c.method==='POST'&&c.url.endsWith('/video-job')).length,starts);
  assert.equal(await page.getByRole('button',{name:'ตรวจชื่อเรื่อง/คำอธิบายก่อนอนุมัติ',exact:true}).count(),0);
  assert.equal(calls.some(c=>/review-preview|admin-preview-token|\/apply|whole-cover-scan/.test(c.url)),false);
  await page.getByText(/Video ID: generic-video.*86.4/).waitFor();
  await page.screenshot({path:path.join(out,'video-mode-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'video-mode-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('METADATA_VIDEO_BROWSER_OK background job resumes after reload, pause/resume, no duplicate start, cross-page persisted results, automatic applied status without approval/player requests, selected 0 threshold, proof visible');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
