"use client";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, apiRequest } from "@/lib/api-client";
import type { Candidate } from "./metadata-batch-review-row";

export type CoverResult = { rowId: string; source: string | null; error: string | null; candidates: Candidate[] };
type ScanPage = { ceiling: string; next: string | null; total: number; scanned: number; compared: number; missing: number; failed: { videoId: string; reason: string }[]; rows: CoverResult[] };
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
      let after: string | undefined, ceiling: string | undefined;
      try {
        do {
          let response: ScanPage | undefined;
          for (let attempt = 0; !response; attempt++) {
            try { response = await apiRequest<ScanPage>(`/metadata-import/batches/${encodeURIComponent(batchId)}/cover-scan`, { method: "POST", signal: abort.signal, body: JSON.stringify({ page, after, ceiling }) }); }
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
          ceiling = response.ceiling; after = response.next || undefined;
          if (after) await pause(700, abort.signal);
        } while (after);
      } catch (e) { if (!abort.signal.aborted) setState(old => ({ ...old, running: false, error: e instanceof Error ? e.message : "เทียบรูปไม่สำเร็จ" })); }
    })();
    return () => abort.abort();
  }, [batchId, page, rowsKey, run]);
  return { results, state, stop: () => { controller.current?.abort(); setState(old => ({ ...old, running: false, done: false, error: "หยุดก่อนครบคลัง ผลที่เห็นเป็นเพียงบางส่วน" })); }, restart: () => setRun(n => n + 1) };
}
