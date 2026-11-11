"use client";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, apiRequest } from "@/lib/api-client";
import type { CoverResult } from "./metadata-cover-scan";
import type { Candidate } from "./metadata-batch-review-row";

type FrameStep = {
  scanId: string; done: boolean; loaded: number; sourceTotal: number; total: number; scanned: number; frames: number; failed: number;
  current: { id: string; sample: number; samples: number } | null;
  sources: CoverResult[]; matches: { rowId: string; score: number; panel: string }[];
  frame: { id: string; publicId: string; title: string; seconds: number; thumbnail: string } | null;
  failure: { videoId: string; reason: string } | null;
};
const empty = { running: false, done: false, loaded: 0, sourceTotal: 0, total: 0, scanned: 0, frames: 0, failed: 0, current: null as FrameStep["current"], error: "", reasons: [] as { videoId: string; reason: string }[] };

async function pause(ms: number, job: { stop: boolean }) {
  const deadline = Date.now() + ms;
  while (!job.stop && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(500, deadline - Date.now())));
}

export function mergeVideoMatches(previous: Record<string, CoverResult>, response: FrameStep) {
  const next = { ...previous };
  for (const source of response.sources) next[source.rowId] = source;
  if (response.frame) for (const match of response.matches) {
    const old = next[match.rowId] || { rowId: match.rowId, source: null, error: null, candidates: [] };
    const v = response.frame;
    const candidate: Candidate = { id: v.id, publicId: v.publicId, title: v.title, evidence: [`เฟรมที่ ${v.seconds.toFixed(1)} วินาที • ${match.panel} • คะแนนความคล้าย ${match.score}/100 (ไม่ใช่ความน่าจะเป็น)`], frame: { seconds: v.seconds, panel: match.panel }, cover: { score: match.score, exact: false, thumbnail: v.thumbnail } };
    const unique = new Map(old.candidates.map(c => [c.id, c]));
    if (match.score > (unique.get(v.id)?.cover?.score || 0)) unique.set(v.id, candidate);
    next[match.rowId] = { ...old, candidates: [...unique.values()].sort((a, b) => (b.cover?.score || 0) - (a.cover?.score || 0) || a.id.localeCompare(b.id)).slice(0, 5) };
  }
  return next;
}

export function useMetadataVideoScan(batchId?: string) {
  const [state, setState] = useState(empty), [results, setResults] = useState<Record<string, CoverResult>>({});
  const current = useRef<{ stop: boolean; abort: AbortController } | null>(null);
  useEffect(() => {
    setState(empty); setResults({});
    return () => { if (current.current) { current.current.stop = true; current.current.abort.abort(); current.current = null; } };
  }, [batchId]);

  async function start(threshold: number, samples: number) {
    if (!batchId || current.current) return;
    const job = { stop: false, abort: new AbortController() }; current.current = job;
    setResults({}); setState({ ...empty, running: true });
    let scanId: string | undefined;
    try {
      while (!job.stop) {
        let response: FrameStep | undefined;
        for (let attempt = 0; !response && !job.stop; attempt++) {
          try { response = await apiRequest<FrameStep>(`/metadata-import/batches/${encodeURIComponent(batchId)}/video-scan`, { method: "POST", signal: job.abort.signal, body: JSON.stringify({ scanId, threshold, samples }) }); }
          catch (e) {
            if (!(e instanceof ApiRequestError) || e.status !== 429 || attempt >= 4) throw e;
            await pause(Math.max(2000, e.retryAfterMs), job);
          }
        }
        if (!response) break;
        scanId = response.scanId;
        if (current.current !== job) return;
        setResults(old => mergeVideoMatches(old, response));
        setState(old => ({ ...old, loaded: response.loaded, sourceTotal: response.sourceTotal, total: response.total, scanned: response.scanned, frames: response.frames, failed: response.failed, current: response.current, done: response.done, reasons: response.failure ? [...old.reasons, response.failure].slice(-100) : old.reasons }));
        if (response.done) break;
        await pause(700, job);
      }
    } catch (e) {
      if (current.current === job && !job.abort.signal.aborted) setState(old => ({ ...old, error: e instanceof Error ? e.message : "ตรวจวิดีโอไม่สำเร็จ" }));
    } finally {
      if (scanId) await apiRequest(`/metadata-import/batches/${encodeURIComponent(batchId)}/video-scan/${scanId}/stop`, { method: "POST", body: "{}" }).catch(() => undefined);
      if (current.current === job) {
        current.current = null;
        setState(old => ({ ...old, running: false, error: job.stop ? "หยุดแล้ว ผลที่แสดงเป็นส่วนที่ตรวจสำเร็จ กดเริ่มใหม่เพื่อตรวจอีกครั้ง" : old.error }));
      }
    }
  }
  return { state, results, start, stop: () => { if (current.current) current.current.stop = true; setState(old => ({ ...old, error: "กำลังหยุดหลังอ่านเฟรมปัจจุบัน (ไม่เกินประมาณ 20 วินาที)" })); } };
}
