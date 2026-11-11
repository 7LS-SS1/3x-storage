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
 const batch={id:'batch',filename:'generic-fixture.json',createdAt:new Date().toISOString()};let calls=[],step=0;
 const media=fs.readFileSync(process.env.METADATA_VIDEO_FIXTURE || path.join(out,'generic.mp4'));
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/fixture.mp4'){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),media.length-1):media.length-1;res.writeHead(range?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})});res.end(media.subarray(start,end+1));return;}
  if(!req.url.startsWith('/backend')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><head><style>body{background:#101114;color:#eee;font-family:Arial}button,select{padding:10px} ${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`);return;}
  let body='';for await(const chunk of req)body+=chunk;calls.push({url:req.url,body});let data;
  if(req.url==='/backend/metadata-import/batches')data={batches:[batch]};
  else if(req.url.startsWith('/backend/metadata-import/history'))data={changes:[],total:0,page:1};
  else if(req.url.includes('/review?page=')){const page=Number(new URL(req.url,'http://localhost').searchParams.get('page'));data={batch,rows:rows.slice((page-1)*25,page*25),total:26,page};}
  else if(req.url.endsWith('/video-scan')){
   assert.equal(JSON.parse(body).threshold,70);assert.equal(JSON.parse(body).samples,12);
   data={scanId:'scan',done:step>0,loaded:26,sourceTotal:26,total:1,scanned:step>0?1:0,frames:step>0?12:1,failed:0,current:null,failure:null,sources:step?[]:rows.map(r=>({rowId:r.id,source:poster,error:null,candidates:[]})),matches:step?[]:[{rowId:'row-0',score:86.4,panel:'ช่อง 2/3 จากซ้าย'},{rowId:'row-25',score:86.4,panel:'ช่อง 2/3 จากซ้าย'}],frame:step?null:{id:'generic-video',publicId:'public-fixture',title:'วิดีโอไม่มีปก',seconds:2.5,thumbnail:poster}};step++;
  } else if(req.url.endsWith('/stop'))data={stopped:true};
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
  await page.getByLabel('คะแนนขั้นต่ำ',{exact:true}).selectOption('70');await page.getByLabel('จำนวนเฟรม',{exact:true}).selectOption('12');
  await page.getByRole('button',{name:'เริ่มตรวจจับด้วยวิดีโอ',exact:true}).click();
  await page.getByText(/จบรอบตรวจแล้ว/).waitFor();
  assert.equal(await page.getByRole('button',{name:'เล่นตรวจจาก 2.5 วินาที',exact:true}).count(),1);
  const before=calls.filter(c=>c.url.endsWith('/video-scan')).length;
  await page.getByRole('button',{name:'ถัดไป',exact:true}).click();
  await page.getByRole('heading',{name:/รายการ 26/}).waitFor();
  assert.equal(await page.getByRole('button',{name:'เล่นตรวจจาก 2.5 วินาที',exact:true}).count(),1);
  assert.equal(calls.filter(c=>c.url.endsWith('/video-scan')).length,before);
  assert.equal(calls.some(c=>/apply|whole-cover-scan|review-preview/.test(c.url)),false);
  await page.getByRole('button',{name:'เล่นตรวจจาก 2.5 วินาที',exact:true}).click();
  assert.ok(calls.some(c=>c.url.includes('/videos/generic-video/admin-preview-token?source=original')));
  assert.equal(await page.getByRole('button',{name:'ตรวจชื่อเรื่อง/คำอธิบายก่อนอนุมัติ',exact:true}).isDisabled(),true);
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&Math.abs(v.currentTime-2.5)<0.2;});
  await page.getByRole('button',{name:'เล่น',exact:true}).click();
  const confirm=page.getByRole('checkbox',{name:'ฉันเล่นตรวจแล้ว และยืนยันว่าเนื้อหาตรงกับบทความนี้',exact:true});await confirm.waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('input[type=checkbox]')].some(e=>e.parentElement.textContent.includes('ฉันเล่นตรวจแล้ว')&&!e.disabled));
  await confirm.check();assert.equal(await page.getByRole('button',{name:'ตรวจชื่อเรื่อง/คำอธิบายก่อนอนุมัติ',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'หยุดชั่วคราว',exact:true}).click();
  await page.screenshot({path:path.join(out,'video-mode-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'video-mode-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('METADATA_VIDEO_BROWSER_OK mode, explicit start, threshold, samples, frame/time, cross-page result persistence, no automatic writes, manual approval gate, real synthetic MP4 seek/play');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
