// Actual Next + Nest + PostgreSQL; only the media storage URL is a local fixture double.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {createRequire}=require('node:module'),root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'apps/admin/package.json'));
const {chromium}=req('@playwright/test');
const env={...process.env,NODE_ENV:'development',LOCAL_DATABASE_URL:'postgresql://video:local-metadata-fixture@localhost:55449/video_metadata_test',DATABASE_URL:'postgresql://video:local-metadata-fixture@localhost:55449/video_metadata_test',LOCAL_API_URL:'http://localhost:4008',LOCAL_ADMIN_URL:'http://localhost:3008',APP_URL:'http://localhost:3008',ADMIN_URL:'http://localhost:3008',PLAYER_URL:'http://localhost:3008',MEDIA_URL:'http://localhost:4018',SESSION_COOKIE_NAME:'video_session',SESSION_SECRET:'metadata-browser-session-secret-local-only',CSRF_SECRET:'metadata-browser-csrf-secret-local-only',IP_HASH_SALT:'metadata-browser-ip-secret-local-only'};
async function main(){
 const browser=await chromium.launch({channel:'chrome',headless:true});const children=[];let shuttingDown=false;
 const fixture=path.join(os.tmpdir(),`metadata-video-${Date.now()}.webm`);
 try{
  const generator=await browser.newPage();
  const bytes=await generator.evaluate(async()=>{
   const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d');
   const stream=c.captureStream(12),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
   const done=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())));});
   recorder.start();let n=0;const timer=setInterval(()=>{ctx.fillStyle=n++%2?'#304060':'#806030';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.fillText('Generic metadata fixture',30,90);},80);
   await new Promise(r=>setTimeout(r,1200));clearInterval(timer);recorder.stop();stream.getTracks().forEach(t=>t.stop());return done;
  });fs.writeFileSync(fixture,Buffer.from(bytes));await generator.close();
  function start(script,args,cwd){const child=spawn(process.execPath,[script,...args],{cwd,env:{...env,METADATA_TEST_MEDIA_FILE:fixture},windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);let log='';child.stdout.on('data',d=>{log+=d});child.stderr.on('data',d=>{log+=d});child.on('exit',code=>{if(!shuttingDown&&code&&code!==0)console.error('Fixture process failed',log.slice(-2000));});return child;}
  start(path.join(root,'scripts/metadata-import-local-runtime.cjs'),[],root);
  start(req.resolve('next/dist/bin/next'),['dev','--port','3008'],path.join(root,'apps/admin'));
  for(let i=0;i<90;i++){try{const r=await fetch('http://localhost:4008/api/v1/metadata-import/batches',{signal:AbortSignal.timeout(5000)});if(r.status===401)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===89)throw new Error('API startup timed out');}
  for(let i=0;i<90;i++){try{const r=await fetch('http://localhost:3008/login',{signal:AbortSignal.timeout(10000)});if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,500));if(i===89)throw new Error('Next startup timed out');}
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:3008/login');await page.locator('#email').fill('metadata-admin@example.test');await page.locator('#password').fill('Local-Metadata-Test-2026!');await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.waitForURL(/dashboard/);
  await page.goto('http://localhost:3008/metadata-import');
  const apiReq=createRequire(path.join(root,'apps/api/package.json'));const {PrismaClient}=apiReq('@prisma/client');const prisma=new PrismaClient({datasources:{db:{url:env.LOCAL_DATABASE_URL}}});
  const before=await prisma.video.findUniqueOrThrow({where:{id:'metadata-browser-video-1'}});await prisma.$disconnect();
  const record={site_url:`https://approval-${Date.now()}.example.test`,post_id:1,title:'ชื่อเรื่องจากไฟล์ตัวอย่าง',description:'<p>คำอธิบายภาษาไทยจากไฟล์</p>[shortcode]',iframe_sources:[{src_raw:'http://localhost:3008/embed/metadata-browser-public-1'}],video_urls:[{source_field:'video_url',value:'https://example.test/fixture.webm'}],filename:'image-cover.jpg'};
  const unmatched={site_url:record.site_url,post_id:2,title:'รายการที่ยังไม่มีคู่',description:''};
  await page.getByLabel('ไฟล์ metadata',{exact:true}).setInputFiles({name:'approval.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([record,unmatched]))});await page.getByRole('button',{name:'อัปโหลดและค้นหาคู่',exact:true}).click();
  const row=page.getByRole('article',{name:'ตรวจบทความ 1',exact:true});const matches=row.locator('section[aria-label^="วิดีโอ "]');await matches.nth(1).waitFor();
  assert.match(await row.innerText(),/origin ตรงกับการตั้งค่าแอป/);assert.equal(await page.locator('iframe').count(),0);
  assert.match(await page.getByRole('article',{name:'ตรวจบทความ 2',exact:true}).innerText(),/ไม่พบคู่จากข้อมูลอ้างอิง/);
  const attest=row.getByRole('checkbox',{name:'ฉันเล่นตรวจแล้ว และยืนยันว่าเนื้อหาตรงกับบทความนี้',exact:true});
  const prepare=row.getByRole('button',{name:'ตรวจชื่อเรื่อง/คำอธิบายก่อนอนุมัติ',exact:true});assert.equal(await prepare.isDisabled(),true);assert.equal(await attest.isDisabled(),true);
  async function playFirst(){await matches.first().getByRole('button',{name:'เล่นวิดีโอนี้เพื่อตรวจสอบ',exact:true}).click();await row.locator('video').waitFor();await row.locator('video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.2);}
  await playFirst();await attest.check();
  const out=path.join(root,'artifacts/metadata-import');await row.evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(out,'batch-review-desktop.png')});await row.getByRole('region',{name:'ตรวจเนื้อหาวิดีโอ',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'batch-review-player.png')});await page.setViewportSize({width:390,height:844});await row.evaluate(el=>el.scrollIntoView({block:'start'}));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.screenshot({path:path.join(out,'batch-review-mobile.png')});
  await prepare.click();const approvals=page.getByRole('region',{name:'อนุมัติข้อมูล',exact:true});await approvals.waitFor();assert.equal(await approvals.getByRole('button',{name:'อนุมัติและบันทึก 1 รายการ',exact:true}).isDisabled(),true);
  // Switching the inspected video invalidates both the content attestation and prepared approval.
  await matches.nth(1).getByRole('button',{name:'เล่นวิดีโอนี้เพื่อตรวจสอบ',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('section[aria-label="อนุมัติข้อมูล"]'));assert.equal(await attest.isChecked(),false);
  await playFirst();await attest.check();await prepare.click();await approvals.waitFor();
  assert.match(await approvals.innerText(),/ชื่อเรื่องจากไฟล์ตัวอย่าง/);assert.match(await approvals.innerText(),/คำอธิบายภาษาไทยจากไฟล์/);
  await approvals.getByRole('checkbox',{name:'ฉันอนุมัติให้ 3x-storage อัปเดตชื่อเรื่อง/คำอธิบายตามข้อมูลก่อน–หลังนี้',exact:true}).check();await approvals.getByRole('button',{name:'อนุมัติและบันทึก 1 รายการ',exact:true}).click();await page.waitForFunction(()=>document.querySelector('pre[role=status]')?.textContent?.includes('บันทึกแล้ว'));
  await prisma.$connect();const after=await prisma.video.findUniqueOrThrow({where:{id:before.id}});await prisma.$disconnect();assert.equal(after.title,record.title);assert.equal(after.description,record.description);assert.deepEqual(after,{...before,title:record.title,description:record.description,updatedAt:after.updatedAt});
  const history=page.locator('details').filter({has:page.locator('summary',{hasText:'metadata-browser-video-1'})}).first();await history.locator('summary').click();await history.getByRole('button',{name:'ตรวจและย้อนคืน',exact:true}).click();await history.getByRole('button',{name:'ยืนยันย้อนคืน',exact:true}).click();await page.waitForFunction(()=>document.querySelector('pre[role=status]')?.textContent?.includes('ย้อนคืนสำเร็จ'));
  await prisma.$connect();const reverted=await prisma.video.findUniqueOrThrow({where:{id:before.id}});await prisma.$disconnect();assert.equal(reverted.title,before.title);assert.equal(reverted.description,before.description);
  const staff=await browser.newPage();await staff.goto('http://localhost:3008/login');await staff.locator('#email').fill('metadata-staff@example.test');await staff.locator('#password').fill('Local-Metadata-Test-2026!');await staff.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await staff.waitForURL(/dashboard/);await staff.goto('http://localhost:3008/metadata-import');await staff.waitForURL(/dashboard/);
  assert.deepEqual(errors,[]);
  console.log('METADATA_BATCH_REVIEW_BROWSER_OK immediate candidates after upload, unmatched row, real playback, attestation gate, switching invalidation, source-only title/description approval, PostgreSQL persistence, unchanged protected fields, rollback, desktop/mobile; local media storage double');
 }finally{shuttingDown=true;await browser.close();for(const child of children){if(child.exitCode===null){if(process.platform==='win32')await new Promise(resolve=>{const k=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});k.on('exit',resolve);});else child.kill();}}fs.rmSync(fixture,{force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
