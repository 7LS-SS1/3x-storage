/* global WPMBI */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const preview = byId('wpmb-import-preview');
  if (!preview) return;
  const status = byId('wpmb-import-status'), rows = byId('wpmb-import-rows');
  let busy = false;
  const call = async (operation, values) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({action:'wpmb_import',nonce:WPMBI.nonce,operation,...values})) data.append(key,value);
    const response = await fetch(WPMBI.url,{method:'POST',credentials:'same-origin',cache:'no-store',body:data});
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.data?.message || 'request_failed');
    return result.data;
  };
  function node(tag, text, parent) { const el=document.createElement(tag);el.textContent=text;parent.append(el);return el; }
  function undoButton(token, parent) {
    const button=node('button','ย้อนคืน embed เดิม',parent);button.className='button';
    button.onclick=async()=>{
      if(busy || !window.confirm('ยืนยันย้อนคืน embed เดิมของบทความนี้?'))return;
      busy=true;button.disabled=true;
      try { await call('undo',{token,confirmed:'yes'});node('p','ย้อนคืนสำเร็จ',parent); }
      catch(e){button.disabled=false;node('p',`ย้อนคืนไม่สำเร็จ: ${e.message}`,parent);}
      finally{busy=false;}
    };
  }
  for (const entry of document.querySelectorAll('.wpmb-undo')) undoButton(entry.dataset.token,entry);
  preview.onclick=async()=>{
    if(busy)return;
    const file=byId('wpmb-import-file').files[0];
    if(!file){status.textContent='เลือกไฟล์ CSV ก่อน';return;}
    busy=true;preview.disabled=true;rows.replaceChildren();status.textContent='กำลังตรวจไฟล์…';
    try {
      const result=await call('preview',{file,post_type:byId('wpmb-import-type').value});
      const totals={ready:0,unchanged:0,blocked:0};let applied=0;
      for(const row of result.rows)totals[row.status]++;
      const progress=()=>{status.textContent=`Batch ${result.batch_id} • ทั้งหมด ${result.total} • พร้อม ${totals.ready} • ค่าเดิมตรงกัน ${totals.unchanged} • ไม่แก้ไข ${totals.blocked} • บันทึกแล้ว ${applied}`;};
      progress();
      for(const row of result.rows){
        const card=node('section','',rows);card.style.cssText='background:white;padding:16px;margin:12px 0;border:1px solid #ccc;overflow-wrap:anywhere';
        node('h2',`${row.row}. ${row.title}`,card);
        node('p',`Post ID: ${row.post_id??'—'} • ${row.post_status??''} • ${row.status} ${row.reason??''}`,card);
        node('h3','embed ปัจจุบัน',card);node('pre',row.before??'(ไม่มีค่า)',card).style.whiteSpace='pre-wrap';
        node('h3','embed จากไฟล์',card);node('pre',row.after,card).style.whiteSpace='pre-wrap';
        if(row.status!=='ready')continue;
        const button=node('button','ยืนยันแก้ embed รายการนี้',card);button.className='button button-primary';
        button.onclick=async()=>{
          if(busy || !window.confirm(`ยืนยันแก้เฉพาะ embed ของ Post ${row.post_id}: ${row.title}?`))return;
          busy=true;button.disabled=true;
          try{const saved=await call('apply',{token:row.token,confirmed:'yes'});applied++;progress();node('p',saved.status==='applied'?'บันทึกสำเร็จ':'ค่า embed ตรงกันอยู่แล้ว',card);if(saved.undo_token)undoButton(saved.undo_token,card);}
          catch(e){button.disabled=false;node('p',`ไม่สำเร็จ: ${e.message} — หากเครือข่ายขัดข้องให้ตรวจประวัติหรือโหลดตัวอย่างใหม่`,card);}
          finally{busy=false;}
        };
      }
    }catch(e){status.textContent=`ตรวจไม่สำเร็จ: ${e.message}`;}
    finally{busy=false;preview.disabled=false;}
  };
})();
