const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../assets/admin.js'),'utf8');

function harness({failWrite=false, failBatch=false, cancelAfterBatch=false, previewPages=1}={}) {
  const nodes = {};
  for (const id of ['wpmb-form','wpmb-preview','wpmb-download','wpmb-cancel','wpmb-status','wpmb-preview-data']) {
    nodes[id] = {disabled:false, textContent:'', append(t){this.textContent+=t;}, handlers:{}, addEventListener(name,fn){this.handlers[name]=fn;}, querySelectorAll(){return [];}};
  }
  let values = {post_type:'post',post_status:'publish',post_ids:'101,102',scope:'ids'};
  const files = [], requests = []; let exporting=false; let remaining=previewPages-1;
  const row = {site_url:'https://example.test',post_id:101,content_raw:'<iframe src="https://example.test/embed/a"></iframe>',title:'ไทย'};
  const start = {cursor:'signed',expected_records:2*previewPages,skipped:[],header:{schema_version:'1.0.0'},csv_header:'site_url,post_id\r\n'};
  const batch = {cursor:'next',done:true,records:[row],failed:[{post_id:102,reason:'read_failed'}],csv:'https://example.test,101\r\n'};
  const context={document:{getElementById:id=>nodes[id],createTextNode:t=>t},WPMB:{url:'/ajax',nonce:'fixture'},URLSearchParams,JSON,Date,Error,crypto:{randomUUID:()=> 'uuid'},FormData:class{[Symbol.iterator](){return Object.entries(values)[Symbol.iterator]();}},window:{confirm:()=>true,showDirectoryPicker:async()=>({getFileHandle:async(name)=>({createWritable:async()=>{const f={name,text:'',closed:false,aborted:false,async write(t){if(failWrite&&name.endsWith('.csv'))throw new Error('disk full');this.text+=t;},async close(){this.closed=true;},async abort(){this.aborted=true;}};files.push(f);return f;}})})},fetch:async(url,{body})=>{const op=body.get('operation');requests.push(Object.fromEntries(body));if(op==='start')exporting=true;if(op==='batch'&&exporting&&failBatch)throw new Error('network failure');if(op==='batch'&&exporting&&cancelAfterBatch)nodes['wpmb-cancel'].handlers.click();return {ok:true,json:async()=>({success:true,data:op==='preview'?{...start,preview:{...batch,done:remaining===0}}:op==='start'?start:{...batch,done:exporting || --remaining===0}})};}};
  vm.runInNewContext(source,context);
  return {nodes,files,requests,change(){values.post_ids='103';nodes['wpmb-form'].handlers.input();},click: id=>nodes[id].handlers.click()};
}
test('preview uses text, explicit review gates download, changes invalidate review',async()=>{
  const h=harness();await h.click('wpmb-download');assert.equal(h.files.length,0);
  await h.click('wpmb-preview');assert.match(h.nodes['wpmb-preview-data'].textContent,/<iframe/);assert.equal(h.nodes['wpmb-download'].disabled,false);
  h.change();assert.equal(h.nodes['wpmb-download'].disabled,true);await h.click('wpmb-download');assert.equal(h.files.length,0);
});
test('streamed JSON CSV report complete with failed item accounting',async()=>{
  const h=harness();await h.click('wpmb-preview');await h.click('wpmb-download');assert.equal(h.files.length,3);assert.ok(h.files.every(f=>f.closed));
  const main=JSON.parse(h.files[0].text),report=JSON.parse(h.files[2].text);assert.equal(main.total_records,1);assert.equal(main.summary.failed,1);assert.equal(main.summary.count_matches,true);assert.equal(report.failed[0].post_id,102);
  assert.equal(h.requests.find(r=>r.operation==='start').post_ids,'101,102');assert.ok(h.files[1].text.startsWith('\uFEFF'));assert.match(h.nodes['wpmb-status'].textContent,/เสร็จแล้ว/);
});
test('disk write failure aborts incomplete output',async()=>{
  const h=harness({failWrite:true});await h.click('wpmb-preview');await h.click('wpmb-download');assert.ok(h.files.every(f=>f.aborted&&!f.closed));assert.match(h.nodes['wpmb-status'].textContent,/ไม่สมบูรณ์/);
});
test('network batch failure aborts all streams and offers retry',async()=>{
  const h=harness({failBatch:true});await h.click('wpmb-preview');await h.click('wpmb-download');assert.ok(h.files.every(f=>f.aborted&&!f.closed));assert.equal(h.nodes['wpmb-download'].disabled,false);
});
test('cancel after in-flight batch aborts instead of committing partial result',async()=>{
  const h=harness({cancelAfterBatch:true});await h.click('wpmb-preview');await h.click('wpmb-download');assert.ok(h.files.every(f=>f.aborted&&!f.closed));assert.match(h.nodes['wpmb-status'].textContent,/ผู้ใช้หยุด/);
});

test('preview follows every batch before allowing download',async()=>{
 const h=harness({previewPages:3});await h.click('wpmb-preview');
 assert.equal(h.requests.filter(r=>r.operation==='batch').length,2);
 assert.match(h.nodes['wpmb-status'].textContent,/ตรวจครบ 6 รายการ/);
 assert.equal(h.nodes['wpmb-download'].disabled,false);
 assert.equal((h.nodes['wpmb-preview-data'].textContent.match(/content_raw/g)||[]).length,3);
});
