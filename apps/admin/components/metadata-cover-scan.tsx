"use client";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, apiRequest } from "@/lib/api-client";
import type { Candidate } from "./metadata-batch-review-row";

export type CoverResult = { rowId: string; source: string | null; error: string | null; candidates: Candidate[]; autoStatus?: string; autoError?: string };
type ScanPage = { scanId?: string; autoRows?: string[]; ceiling: string; next: string | null; total: number; scanned: number; compared: number; missing: number; failed: { videoId: string; reason: string }[]; rows: CoverResult[] };
const empty = { scanned: 0, compared: 0, missing: 0, failed: 0, total: 0, done: false, running: false, error: "", reasons: [] as { videoId: string; reason: string }[] };

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error("หยุดแล้ว")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
}

export function useMetadataCoverScan(batchId: string | undefined, page: number, rowsKey: string) {
  const [results, setResults] = useState<Record<string, CoverResult>>({});
  const [state, setState] = useState(empty), [run, setRun] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!batchId || !rowsKey) { setResults({}); setState(empty); return; }
    const abort = new AbortController(); controller.current = abort;
    setResults({}); setState({ ...empty, running: true });
    void (async () => {
      let after: string | undefined, ceiling: string | undefined, scanId: string | undefined;
      try {
        do {
          let response: ScanPage | undefined;
          for (let attempt = 0; !response; attempt++) {
            try { response = await apiRequest<ScanPage>(`/metadata-import/batches/${encodeURIComponent(batchId)}/cover-scan`, { method: "POST", signal: abort.signal, body: JSON.stringify({ page, after, ceiling, scanId }) }); }
            catch (e) { if (!(e instanceof ApiRequestError) || e.status !== 429 || attempt >= 4) throw e; await pause(Math.max(2000, e.retryAfterMs), abort.signal); }
          }
          if (abort.signal.aborted) return;
          setResults(previous => {
            const next = { ...previous };
            for (const row of response.rows) {
              const unique = new Map((previous[row.rowId]?.candidates || []).map(c => [c.id, c]));
              for (const candidate of row.candidates) unique.set(candidate.id, candidate);
              next[row.rowId] = { ...row, candidates: [...unique.values()].sort((a, b) => (b.cover?.score || 0) - (a.cover?.score || 0) || a.id.localeCompare(b.id)).slice(0, 20) };
            }
            return next;
          });
          const noSource = response.rows.length > 0 && response.rows.every(r => !r.source);
          setState(old => ({ ...old, scanned: old.scanned + response.scanned, compared: old.compared + response.compared, missing: old.missing + response.missing, failed: old.failed + response.failed.length, reasons: [...old.reasons, ...response.failed], total: response.total, done: !response.next && !noSource, running: !!response.next, error: noSource ? "ไม่มีรูปต้นทางที่อ่านได้ ยังไม่ได้เปรียบเทียบคลังวิดีโอ" : "" }));
          scanId = response.scanId;
          if (!response.next && scanId) {
            setState(old => ({ ...old, running: true }));
            for (const rowId of response.autoRows || []) {
              if (abort.signal.aborted) return;
              try {
                const applied = await apiRequest<{ status: string }>(`/metadata-import/rows/${encodeURIComponent(rowId)}/auto-cover-apply`, { method: "POST", signal: abort.signal, body: JSON.stringify({ scanId }) });
                setResults(old => ({ ...old, [rowId]: { ...old[rowId]!, autoStatus: applied.status } }));
              } catch (e) {
                if (abort.signal.aborted) return;
                setResults(old => ({ ...old, [rowId]: { ...old[rowId]!, autoError: e instanceof Error ? e.message : "บันทึกอัตโนมัติไม่สำเร็จ" } }));
              }
            }
          }
          if (!response.next) setState(old => ({ ...old, running: false }));
          ceiling = response.ceiling; after = response.next || undefined;
          if (after) await pause(700, abort.signal);
        } while (after);
      } catch (e) { if (!abort.signal.aborted) setState(old => ({ ...old, running: false, error: e instanceof Error ? e.message : "เทียบรูปไม่สำเร็จ" })); }
    })();
    return () => abort.abort();
  }, [batchId, page, rowsKey, run]);
  return { results, state, stop: () => { controller.current?.abort(); setState(old => ({ ...old, running: false, done: false, error: "หยุดแล้ว ผลที่เห็นอาจเป็นเพียงบางส่วน รายการที่บันทึกแล้วคงอยู่และย้อนคืนได้ในประวัติ" })); }, restart: () => setRun(n => n + 1) };
}
