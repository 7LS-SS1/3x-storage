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
  const record={site_url:`https://discovery-${Date.now()}.example.test`,post_id:1,title:'ตัวอย่างวิดีโอทั่วไป',iframe_sources:[{src_raw:'http://localhost:3008/embed/metadata-browser-public-1'}],video_urls:[{source_field:'video_url',value:'https://example.test/fixture.webm'}],filename:'image-cover.jpg'};
  await page.getByLabel('ไฟล์ metadata',{exact:true}).setInputFiles({name:'discovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([record]))});await page.getByRole('button',{name:'ตรวจไฟล์และสร้าง Batch',exact:true}).click();await page.getByRole('button',{name:'เลือกคู่ / ตรวจแก้',exact:true}).first().click();
  const matches=page.getByRole('region',{name:'วิดีโอที่ค้นพบอัตโนมัติ'});await matches.locator('article').nth(1).waitFor();
  assert.equal(await page.getByLabel('Video ID ปลายทาง',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('button',{name:'แสดงข้อมูลก่อน–หลัง (ยังไม่บันทึก)',exact:true}).isDisabled(),true);
  assert.match(await matches.innerText(),/origin ตรงกับการตั้งค่าแอป/);assert.equal(await page.locator('iframe').count(),0);
  await matches.getByRole('button',{name:'เปิดวิดีโอในแอปเพื่อตรวจสอบ',exact:true}).first().click();await page.locator('video').waitFor();await page.locator('video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.2);
  const out=path.join(root,'artifacts/metadata-import');await matches.locator('article').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'discovery-desktop.png')});await page.setViewportSize({width:390,height:844});await matches.locator('article').first().scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.screenshot({path:path.join(out,'discovery-mobile.png')});
  await matches.getByRole('button',{name:'ยืนยันเลือกวิดีโอนี้เป็นคู่',exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('input[aria-label="Video ID ปลายทาง"]')?.value==='metadata-browser-video-1');assert.equal(await page.getByLabel('Video ID ปลายทาง',{exact:true}).inputValue(),'metadata-browser-video-1');
  await page.getByRole('button',{name:'แสดงข้อมูลก่อน–หลัง (ยังไม่บันทึก)',exact:true}).click();await page.getByRole('heading',{name:'3. ตรวจและยืนยัน 1 รายการ',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'บันทึก 1 รายการ',exact:true}).isDisabled(),true);assert.deepEqual(errors,[]);
  console.log('METADATA_DISCOVERY_BROWSER_OK automatic two candidates, no automatic binding, exact origin evidence, original video plays, explicit selection, confirmation gate, desktop/mobile; local media storage double, no production R2');
 }finally{shuttingDown=true;await browser.close();for(const child of children){if(child.exitCode===null){if(process.platform==='win32')await new Promise(resolve=>{const k=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});k.on('exit',resolve);});else child.kill();}}fs.rmSync(fixture,{force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
