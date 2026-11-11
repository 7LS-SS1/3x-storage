const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),out=path.join(root,'artifacts/wp-metadata-export');
const pkg=fs.readdirSync(path.join(root,'node_modules/.pnpm')).find(n=>/^playwright@/.test(n));
const {chromium}=require(path.join(root,'node_modules/.pnpm',pkg,'node_modules/playwright'));
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(fs.readFileSync(path.join(out,'import-preview.html'),'utf8').replace(/data-token="[^"]*"/g,'data-token="fixture"'));
 await page.evaluate(()=>{
  window.WPMBI={url:'/fixture',nonce:'fixture'};window.mode='failure';window.applies=[];window.active=0;window.maxActive=0;
  window.fetch=async(_url,{body})=>{
   const op=body.get('operation');let data;
   if(op==='preview')data={batch_id:'bulk-fixture',total:5,rows:[...Array.from({length:3},(_,i)=>({row:i+1,post_id:i+1,title:'ตัวอย่าง '+(i+1),status:'ready',before:'old',after:'<iframe></iframe>',token:String(i+1)})),{row:4,title:'ซ้ำ',status:'blocked',reason:'duplicate_title_in_wordpress',after:'<iframe></iframe>'},{row:5,title:'เหมือนเดิม',status:'unchanged',after:'<iframe></iframe>'}]};
   else if(op==='apply'){
    const token=body.get('token');window.applies.push(token);window.active++;window.maxActive=Math.max(window.maxActive,window.active);await new Promise(r=>setTimeout(r,20));window.active--;
    if(window.mode==='stop' && token==='1') [...document.querySelectorAll('button')].find(b=>b.textContent==='หยุดหลังรายการปัจจุบัน').click();
    if(window.mode==='failure' && token==='2') return {ok:false,json:async()=>({success:false,data:{message:'embed_changed_since_preview'}})};
    data={status:window.mode==='failure' && token==='3'?'unchanged':'applied',undo_token:'undo-'+token};
   } else data={status:'rolled_back'};
   return {ok:true,json:async()=>({success:true,data})};
  };
 });
 await page.addScriptTag({path:path.join(__dirname,'../assets/import.js')});
 const all=page.getByRole('button',{name:'อนุมัติทั้งหมด / ยืนยันแก้ไขทั้งหมด',exact:true});
 assert.equal(await all.isDisabled(),true);
 const input=page.locator('#wpmb-import-file');await input.setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from('fixture')});
 await page.click('#wpmb-import-preview');await all.waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.startsWith('อนุมัติทั้งหมด')&&!b.disabled));
 page.once('dialog',d=>d.dismiss());await all.click();assert.deepEqual(await page.evaluate(()=>window.applies),[]);
 page.once('dialog',d=>d.accept());await all.click();await page.waitForFunction(()=>document.querySelector('#wpmb-import-status').textContent.includes('รอบันทึก 0'));
 assert.deepEqual(await page.evaluate(()=>window.applies),['1','2','3']);assert.equal(await page.evaluate(()=>window.maxActive),1);
 const summary=await page.locator('#wpmb-import-status').textContent();assert.match(summary,/บันทึกแล้ว 1/);assert.match(summary,/ผิดพลาด\/ยังยืนยันไม่ได้ 1/);assert.match(summary,/ค่าเดิมตรงกัน 2/);assert.match(summary,/ข้าม 1/);assert.equal(await all.isDisabled(),true);
 assert.equal(await page.locator('iframe').count(),0);
 await page.evaluate(()=>{window.mode='stop';window.applies=[];});await page.click('#wpmb-import-preview');
 page.once('dialog',d=>d.accept());await all.click();await page.waitForFunction(()=>document.querySelector('#wpmb-import-status').textContent.includes('หยุดแล้ว'));
 assert.deepEqual(await page.evaluate(()=>window.applies),['1']);assert.match(await page.locator('#wpmb-import-status').textContent(),/รอบันทึก 2/);
 await page.evaluate(()=>{window.mode='ok';});page.once('dialog',d=>d.accept());await all.click();await page.waitForFunction(()=>document.querySelector('#wpmb-import-status').textContent.includes('รอบันทึก 0'));
 assert.deepEqual(await page.evaluate(()=>window.applies),['1','2','3']);
 await page.screenshot({path:path.join(out,'import-bulk-1.1.3.png'),fullPage:true});
 await page.click('#wpmb-import-preview');assert.equal(await all.isDisabled(),false);
 await input.setInputFiles({name:'changed.csv',mimeType:'text/csv',buffer:Buffer.from('changed')});assert.equal(await all.isDisabled(),true);
 assert.deepEqual(errors,[]);console.log('WPMB_BULK_BROWSER_OK one confirmation, cancel, ready-only serial queue, per-row failure isolation, stop/resume without replay, summary, escaped iframe, stale file invalidation');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
