const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const adminRequire=createRequire(path.resolve(__dirname,'../apps/admin/package.json'));
const {chromium}=adminRequire('@playwright/test');
const base='http://localhost:3008';
const output=path.resolve(__dirname,'../artifacts/metadata-import');
async function main(){
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/metadata-import`,{timeout:90000});await page.waitForURL(/login/);
  await page.locator('#email').fill('metadata-admin@example.test');await page.locator('#password').fill('Local-Metadata-Test-2026!');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.waitForURL(/dashboard/,{timeout:90000});
  await page.goto(`${base}/metadata-import`,{timeout:90000});await page.getByRole('heading',{name:'นำเข้าและตรวจสอบ Metadata',exact:true}).waitFor();
  const records=[1,2].map(n=>({site_url:`https://browser-${Date.now()}.example.test`,post_id:n,title:`ข้อมูลนำเข้าไทย ${n}`,description:`<p>คำอธิบาย ${n}</p>[shortcode]`,categories:['ทั่วไป','การศึกษา'],tags:['ตัวอย่าง'],image_url:'https://example.test/image.jpg',target_video_id:`metadata-browser-video-${n}`}));
  await page.getByLabel('ไฟล์ metadata',{exact:true}).setInputFiles({name:'browser-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schema_version:'1.0.0',records}))});
  await page.getByRole('button',{name:'ตรวจไฟล์และสร้าง Batch',exact:true}).click();await page.getByRole('button',{name:'เลือกคู่ / ตรวจแก้',exact:true}).first().waitFor();
  await page.getByRole('button',{name:'เลือกคู่ / ตรวจแก้',exact:true}).first().click();await page.getByLabel('Video ID ปลายทาง',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Video ID ปลายทาง',{exact:true}).inputValue(),'metadata-browser-video-1');
  await page.getByRole('button',{name:'แสดงข้อมูลก่อน–หลัง (ยังไม่บันทึก)',exact:true}).click();
  await page.getByRole('heading',{name:'3. ตรวจและยืนยัน 1 รายการ',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'บันทึก 1 รายการ',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('iframe').count(),0);
  await page.screenshot({path:path.join(output,'review-desktop.png'),fullPage:true});
  await page.getByRole('checkbox',{name:'ตรวจ Video ID และข้อมูลก่อน–หลังแล้ว ยืนยันบันทึกเฉพาะรายการข้างต้น',exact:true}).check();
  await page.getByRole('button',{name:'บันทึก 1 รายการ',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent?.includes('บันทึกแล้ว'));
  await page.reload();await page.getByRole('heading',{name:'ประวัติและย้อนคืน'}).waitFor();
  const history=page.locator('details').filter({has:page.locator('summary', {hasText:'metadata-browser-video-1'})}).first();
  await history.locator('summary').click();await history.getByRole('button',{name:'ตรวจและย้อนคืน',exact:true}).click();
  await history.getByRole('button',{name:'ยืนยันย้อนคืน',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent?.includes('ย้อนคืนสำเร็จ'));
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'review-mobile.png'),fullPage:true});
  // The actual server-side page gate redirects STAFF even with a valid session.
  const staff=await browser.newPage();await staff.goto(`${base}/login`);await staff.locator('#email').fill('metadata-staff@example.test');await staff.locator('#password').fill('Local-Metadata-Test-2026!');await staff.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await staff.waitForURL(/dashboard/);await staff.goto(`${base}/metadata-import`);await staff.waitForURL(/dashboard/);
  assert.deepEqual(errors,[]);
  console.log('METADATA_BROWSER_E2E_OK real Next login/cookies + Nest guards + PostgreSQL; upload, review, confirm, reload, rollback, STAFF redirect, desktop/mobile; no mocks');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
