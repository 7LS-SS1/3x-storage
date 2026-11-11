/* global WPMB */
(() => {
  'use strict';
  const form = document.getElementById('wpmb-form');
  if (!form) return;
  const preview = document.getElementById('wpmb-preview');
  const download = document.getElementById('wpmb-download');
  const cancel = document.getElementById('wpmb-cancel');
  const status = document.getElementById('wpmb-status');
  let reviewed = null, stopped = false, running = false;
  const fields = () => Object.fromEntries(new FormData(form));
  const fingerprint = () => JSON.stringify(fields());
  const request = async (operation, extra = {}) => {
    const body = new URLSearchParams({ ...fields(), ...extra, action: 'wpmb_export', nonce: WPMB.nonce, operation });
    const res = await fetch(WPMB.url, { method: 'POST', credentials: 'same-origin', body, cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.data?.message || 'Request failed');
    return data.data;
  };
  function busy(value) {
    running = value;
    for (const el of form.querySelectorAll('input, select')) el.disabled = value;
    preview.disabled = value; download.disabled = value || reviewed !== fingerprint(); cancel.disabled = !value;
  }
  // Keep FormData available while controls are disabled during an export.
  let frozen = null;
  const startRequest = async (operation) => {
    const body = new URLSearchParams({ ...frozen, action: 'wpmb_export', nonce: WPMB.nonce, operation });
    const res = await fetch(WPMB.url, { method: 'POST', credentials: 'same-origin', body, cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.data?.message || 'Request failed');
    return data.data;
  };
  form.addEventListener('submit', e => e.preventDefault());
  form.addEventListener('input', () => { reviewed = null; download.disabled = true; });
  preview.addEventListener('click', async () => {
    if (running) return;
    const current = fingerprint(); frozen = fields(); stopped = false; reviewed = null; busy(true);
    try {
      const data = await startRequest('preview');
      let batch = data.preview, count = 0, failed = 0;
      while (true) {
        if (stopped) throw new Error('ผู้ใช้หยุดการตรวจ — ยังตรวจไม่ครบ');
        count += batch.records.length; failed += batch.failed.length;
        status.textContent = `ตรวจแล้ว ${count + failed}/${data.expected_records} • สำเร็จ ${count} • ล้มเหลว ${failed}`;
        if (batch.done) break;
        batch = await request('batch', { cursor: batch.cursor });
      }
      if (count + failed !== data.expected_records) throw new Error('จำนวนรายการเปลี่ยนระหว่างตรวจ กรุณาตรวจใหม่');
      reviewed = current;
      status.textContent = `ตรวจครบ ${data.expected_records} รายการ • สำเร็จ ${count} • ข้าม ${data.skipped.length} • ล้มเหลว ${failed} — รายละเอียดรายการและข้อจำกัดจะอยู่ในไฟล์ JSON และ report`;
    } catch (e) { reviewed = null; status.textContent = `ตรวจไม่สำเร็จ: ${e.message}`; }
    finally { busy(false); }
  });
  cancel.addEventListener('click', () => { stopped = true; status.textContent = 'กำลังหยุดหลัง batch ปัจจุบัน…'; });
  download.addEventListener('click', async () => {
    if (running || reviewed !== fingerprint()) return;
    if (!window.showDirectoryPicker) { status.textContent = 'ต้องใช้ Chrome/Edge บน HTTPS หรือ localhost ที่รองรับ File System Access'; return; }
    if (!window.confirm('ยืนยัน export ตามตัวกรองที่ตรวจแล้วไปยังโฟลเดอร์ส่วนตัวบนเครื่อง? จะไม่แก้ข้อมูลต้นทาง')) return;
    frozen = fields(); let jsonFile, csvFile; let jsonCommitted = false;
    stopped = false; busy(true);
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID();
      const prefix = `retrotube-metadata-${stamp}`;
      const jsonHandle = await dir.getFileHandle(`${prefix}.json`, { create: true });
      const csvHandle = await dir.getFileHandle(`${prefix}.csv`, { create: true });
      jsonFile = await jsonHandle.createWritable(); csvFile = await csvHandle.createWritable();
      const start = await startRequest('start');
      await jsonFile.write(JSON.stringify(start.header).slice(0, -1) + ',"records":[');
      await csvFile.write('\uFEFF' + start.csv_header);
      let cursor = start.cursor, count = 0, failedCount = 0, first = true;
      // Failure details are streamed to a separate array by a small side file, not retained in memory.
      // At most 50 failures per batch are written inline as events in a local report stream.
      const reportHandle = await dir.getFileHandle(`${prefix}-report.json`, { create: true });
      const report = await reportHandle.createWritable();
      try {
        await report.write('{"skipped":' + JSON.stringify(start.skipped) + ',"failed":[');
        let firstFailure = true;
        while (true) {
          if (stopped) throw new Error('ผู้ใช้หยุด export; ไฟล์ที่เขียนไม่ครบถูกยกเลิก');
          const batch = await request('batch', { cursor });
          for (const record of batch.records) {
            await jsonFile.write((first ? '' : ',') + JSON.stringify(record)); first = false; count++;
          }
          await csvFile.write(batch.csv);
          for (const failure of batch.failed) { await report.write((firstFailure ? '' : ',') + JSON.stringify(failure)); firstFailure = false; failedCount++; }
          status.textContent = `สำเร็จ ${count} • ข้าม ${start.skipped.length} • ล้มเหลว ${failedCount} • คาดไว้ ${start.expected_records}`;
          cursor = batch.cursor;
          if (batch.done) break;
        }
        if (stopped) throw new Error('ผู้ใช้หยุด export');
        const summary = { successful: count, skipped: start.skipped.length, failed: failedCount, expected_records: start.expected_records, count_matches: count + failedCount === start.expected_records, completed: true, completed_at_utc: new Date().toISOString(), report_file: `${prefix}-report.json` };
        await jsonFile.write('],"total_records":' + count + ',"summary":' + JSON.stringify(summary) + '}');
        await report.write('],"summary":' + JSON.stringify(summary) + '}');
        await jsonFile.close(); jsonCommitted = true; await csvFile.close(); await report.close();
        status.textContent = `เสร็จแล้ว: สำเร็จ ${count} • ข้าม ${summary.skipped} • ล้มเหลว ${failedCount}${summary.count_matches ? '' : ' • จำนวนเปลี่ยนระหว่าง export โปรดตรวจใหม่'} — ${prefix} (JSON, CSV, report)`;
      } catch (e) { await report.abort().catch(() => {}); throw e; }
    } catch (e) {
      await jsonFile?.abort().catch(() => {}); await csvFile?.abort().catch(() => {});
      status.textContent = `export ไม่สมบูรณ์: ${e.message}${jsonCommitted ? ' — JSON บันทึกแล้ว แต่ชุดไฟล์ยังไม่ครบ' : ' — อาจมีไฟล์ชื่อใหม่ขนาด 0 ไบต์ สามารถลบทิ้งได้'}`;
    } finally { busy(false); }
  });
})();
