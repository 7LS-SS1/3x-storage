const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const artifacts=path.join(root,'artifacts/wp-metadata-export');
const pkg=fs.readdirSync(path.join(root,'node_modules/.pnpm')).find(n=>/^playwright@/.test(n));
const {chromium}=require(path.join(root,'node_modules/.pnpm',pkg,'node_modules/playwright'));
const fixture=JSON.parse(fs.readFileSync(path.join(artifacts,'sample.json'),'utf8'));
const script=fs.readFileSync(path.join(__dirname,'../assets/admin.js'),'utf8');
const html=fs.readFileSync(path.join(artifacts,'admin-preview.html'),'utf8').replace('</html>','<script>window.WPMB={url:"/ajax",nonce:"fixture-only"};</script><script src="/admin.js"></script></html>');
const server=http.createServer((req,res)=>{
  if(req.url==='/admin.js'){res.setHeader('Content-Type','application/javascript');res.end(script);return;}
  if(req.url==='/ajax'){
    let body='';req.on('data',b=>body+=b);req.on('end',()=>{
      const operation=new URLSearchParams(body).get('operation');
      const batch={records:fixture.records,failed:[],csv:'https://example.test,900001\r\n',cursor:'next',done:true};
      const header={...fixture};delete header.records;delete header.total_records;
      const start={cursor:'fixture',expected_records:2,skipped:[],header,csv_header:'site_url,post_id\r\n'};
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data:operation==='preview'?{...start,preview:batch}:operation==='start'?start:batch}));
    });return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.fill('[name=post_ids]','900001,900002');
    await page.click('#wpmb-preview');await page.waitForFunction(()=>!document.querySelector('#wpmb-download').disabled);
    assert.equal(await page.locator('iframe').count(),0);
    assert.equal(await page.locator('#wpmb-preview-data').count(),0);
    assert.match(await page.locator('#wpmb-status').textContent(),/ตรวจครบ 2 รายการ/);
    await page.screenshot({path:path.join(artifacts,'admin-preview.png'),fullPage:true});
    await page.evaluate(()=>{window.testFiles=[];window.showDirectoryPicker=async()=>({getFileHandle:async name=>({createWritable:async()=>{const f={name,text:'',closed:false,async write(t){this.text+=t;},async close(){this.closed=true;},async abort(){this.aborted=true;}};window.testFiles.push(f);return f;}})});});
    page.on('dialog',d=>d.accept());await page.click('#wpmb-download');
    await page.waitForFunction(()=>document.querySelector('#wpmb-status').textContent.startsWith('เสร็จแล้ว'));
    const files=await page.evaluate(()=>window.testFiles.map(({name,text,closed})=>({name,text,closed})));
    assert.equal(files.length,3);assert.ok(files.every(f=>f.closed));assert.equal(JSON.parse(files[0].text).records.length,2);assert.equal(JSON.parse(files[0].text).records[0].content_raw,fixture.records[0].content_raw);
    await page.fill('[name=post_ids]','900003');assert.equal(await page.locator('#wpmb-download').isDisabled(),true);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(artifacts,'admin-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('WPMB_BROWSER_FIXTURE_OK preview escaped, zero iframes, streamed output, review invalidation, no console errors; mocked AJAX and file picker');
  } finally {if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
