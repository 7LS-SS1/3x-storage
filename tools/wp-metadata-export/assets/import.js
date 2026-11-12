/* global WPMBI */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const preview = byId('wpmb-import-preview');
  if (!preview) return;
  const status = byId('wpmb-import-status'), rows = byId('wpmb-import-rows');
  const fileInput = byId('wpmb-import-file'), typeInput = byId('wpmb-import-type');
  let busy = false, stopped = false, reviewed = false, queue = [], progress = () => {};
  const toolbar = document.createElement('p');rows.before(toolbar);
  function node(tag, text, parent) { const el=document.createElement(tag);el.textContent=text;parent.append(el);return el; }
  const approveAll = node('button','อนุมัติทั้งหมด / ยืนยันแก้ไขทั้งหมด',toolbar);approveAll.className='button button-primary';
  const stop = node('button','หยุดหลังรายการปัจจุบัน',toolbar);stop.className='button';
  function controls() {
    preview.disabled=busy;fileInput.disabled=busy;typeInput.disabled=busy;
    approveAll.disabled=busy || !reviewed || !queue.some(item=>item.state==='pending');
    stop.disabled=!busy;
    for(const item of queue)item.button.disabled=busy || !reviewed || item.state!=='pending';
  }
  function lock(value){busy=value;controls();}
  function invalidate(){reviewed=false;controls();status.textContent='ไฟล์หรือ post type เปลี่ยน กรุณาตรวจไฟล์ใหม่ก่อนยืนยัน';}
  fileInput.addEventListener('change',invalidate);typeInput.addEventListener('change',invalidate);
  stop.onclick=()=>{stopped=true;stop.disabled=true;status.textContent='กำลังหยุดหลังรายการปัจจุบัน รายการที่บันทึกแล้วคงอยู่และย้อนคืนได้';};
  controls();
  const call = async (operation, values) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({action:'wpmb_import',nonce:WPMBI.nonce,operation,...values})) data.append(key,value);
    const response = await fetch(WPMBI.url,{method:'POST',credentials:'same-origin',cache:'no-store',body:data});
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.data?.message || 'request_failed');
    return result.data;
  };
  function undoButton(token, parent, onUndo=()=>{}) {
    const button=node('button','ย้อนคืน embed เดิม',parent);button.className='button';
    button.onclick=async()=>{
      if(busy || !window.confirm('ยืนยันย้อนคืน embed เดิมของบทความนี้?'))return;
      lock(true);button.disabled=true;
      try { await call('undo',{token,confirmed:'yes'});node('p','ย้อนคืนสำเร็จ',parent);onUndo();progress(); }
      catch(e){button.disabled=false;node('p',`ย้อนคืนไม่สำเร็จ: ${e.message}`,parent);}
      finally{lock(false);}
    };
  }
  for (const entry of document.querySelectorAll('.wpmb-undo')) undoButton(entry.dataset.token,entry);
  async function applyItem(item) {
    try {
      const saved=await call('apply',{token:item.row.token,confirmed:'yes'});
      item.state=saved.status==='applied'?'applied':'unchanged';
      node('p',item.state==='applied'?'บันทึกสำเร็จ':'ค่า embed ตรงกันอยู่แล้ว',item.card);
      if(saved.undo_token)undoButton(saved.undo_token,item.card,()=>{item.state='undone';});
    } catch(e) {
      item.state='failed';
      node('p',`ไม่สำเร็จหรือยังยืนยันผลไม่ได้: ${e.message} — ตรวจประวัติและตรวจไฟล์ใหม่ก่อนลองอีกครั้ง`,item.card);
    }
    progress();
  }
  approveAll.onclick=async()=>{
    if(busy || !reviewed)return;
    const pending=queue.filter(item=>item.state==='pending');
    if(!pending.length || !window.confirm(`ยืนยันแก้ embed ทั้งหมด ${pending.length} รายการที่ผ่านการตรวจ? รายการชื่อซ้ำ หาไม่พบ หรือค่าเดิมตรงกันจะไม่ถูกแก้ไข`))return;
    stopped=false;lock(true);
    try { for(const item of pending){if(stopped)break;await applyItem(item);} }
    finally{lock(false);progress();}
  };
  preview.onclick=async()=>{
    if(busy)return;
    const file=fileInput.files[0];
    if(!file){status.textContent='เลือกไฟล์ CSV ก่อน';return;}
    const type=typeInput.value;
    reviewed=false;queue=[];stopped=false;lock(true);rows.replaceChildren();status.textContent='กำลังตรวจไฟล์…';
    try {
      const result=await call('preview',{file,post_type:type});
      const totals={ready:0,unchanged:0,blocked:0};
      for(const row of result.rows)totals[row.status]++;
      progress=()=>{
        const count=state=>queue.filter(item=>item.state===state).length;
        status.textContent=`Batch ${result.batch_id} • ทั้งหมด ${result.total} • รอบันทึก ${count('pending')} • ค่าเดิมตรงกัน ${totals.unchanged+count('unchanged')} • ข้าม ${totals.blocked} • บันทึกแล้ว ${count('applied')} • ผิดพลาด/ยังยืนยันไม่ได้ ${count('failed')} • ย้อนคืน ${count('undone')}${stopped?' • หยุดแล้ว':''}`;
      };
      for(const row of result.rows){
        const card=node('section','',rows);card.style.cssText='background:white;padding:16px;margin:12px 0;border:1px solid #ccc;overflow-wrap:anywhere';
        node('h2',`${row.row}. ${row.title}`,card);
        node('p',row.match_basis==='old_embed'?'จับคู่ด้วย URL ใน embed เดิม':'จับคู่ด้วยชื่อเรื่อง',card);
        node('p',`Post ID: ${row.post_id??'—'} • ${row.post_status??''} • ${row.status} ${row.reason??''}`,card);
        node('h3','embed ปัจจุบัน',card);node('pre',row.before??'(ไม่มีค่า)',card).style.whiteSpace='pre-wrap';
        node('h3','embed จากไฟล์',card);node('pre',row.after,card).style.whiteSpace='pre-wrap';
        if(row.status!=='ready')continue;
        const button=node('button','ยืนยันแก้ embed รายการนี้',card);button.className='button button-primary';
        const item={row,card,button,state:'pending'};queue.push(item);
        button.onclick=async()=>{
          if(busy || !reviewed || item.state!=='pending' || !window.confirm(`ยืนยันแก้เฉพาะ embed ของ Post ${row.post_id}: ${row.title}?`))return;
          stopped=false;lock(true);
          try{await applyItem(item);}finally{lock(false);}
        };
      }
      reviewed=true;progress();
    }catch(e){status.textContent=`ตรวจไม่สำเร็จ: ${e.message}`;}
    finally{lock(false);}
  };
})();
