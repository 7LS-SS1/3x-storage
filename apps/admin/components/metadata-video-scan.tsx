"use client";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { CoverResult } from "./metadata-cover-scan";

export type VideoJob = {
  id: string; status: "RUNNING" | "PAUSED" | "COMPLETED"; threshold: number; samples: number;
  createdAt: string; lastActivityAt: string; sourceTotal: number; loaded: number; total: number;
  scanned: number; failed: number; sourceFailed: number; frames: number; cached: number;
  current: { refId: string; framesDone: number }[];
  failures: { refId: string; kind: string; error: string | null }[];
};
type Status = { job: VideoJob | null; rows: CoverResult[] };

// Cleanup cancels only GET requests, never the durable worker.
export function useMetadataVideoScan(batchId?: string, page = 1) {
  const [job, setJob] = useState<VideoJob | null>(null);
  const [results, setResults] = useState<Record<string, CoverResult>>({});
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0), command = useRef(false);
  useEffect(() => { setJob(null); setResults({}); }, [batchId]);
  useEffect(() => {
    const version = ++generation.current;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setLoading(true); setResults({}); setError("");
    async function poll() {
      if (!batchId) { setLoading(false); return; }
      try {
        const response = await apiRequest<Status>(`/metadata-import/batches/${encodeURIComponent(batchId)}/video-job?page=${page}`, { signal: abort.signal });
        if (generation.current !== version || abort.signal.aborted) return;
        setJob(response.job); setResults(Object.fromEntries(response.rows.map(row => [row.rowId, row]))); setError(""); setLoading(false);
        timer = setTimeout(() => void poll(), response.job?.status === "RUNNING" ? 3000 : 15000);
      } catch (e) {
        if (generation.current !== version || abort.signal.aborted) return;
        setError(e instanceof Error ? e.message : "อ่านความคืบหน้าไม่สำเร็จ"); setLoading(false);
        timer = setTimeout(() => void poll(), 5000);
      }
    }
    void poll();
    return () => { ++generation.current; abort.abort(); clearTimeout(timer); };
  }, [batchId, page, revision]);

  async function send(path: string, body: object = {}) {
    if (!batchId || command.current) return;
    command.current = true; setBusy(true); setError("");
    const version = generation.current;
    try {
      await apiRequest(`/metadata-import/batches/${encodeURIComponent(batchId)}/video-job${path}`, { method: "POST", body: JSON.stringify(body) });
      if (generation.current === version) setRevision(n => n + 1);
    } catch (e) {
      if (generation.current === version) setError(e instanceof Error ? e.message : "ส่งคำสั่งไม่สำเร็จ");
    } finally { command.current = false; setBusy(false); }
  }
  return { job, results, error, loading, busy, start: (threshold: number, samples: number, restart = false) => send("", { threshold, samples, restart }),
    control: (action: "pause" | "resume" | "retry") => send(`/${action}`), refresh: () => setRevision(n => n + 1) };
}
