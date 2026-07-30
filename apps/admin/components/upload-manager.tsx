"use client";

import {
  AlertTriangle,
  Check,
  Cloud,
  FileVideo,
  Laptop,
  Pause,
  RefreshCw,
  Tags,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { GoogleDriveImporter } from "@/components/google-drive-importer";
import { apiRequest } from "@/lib/api-client";

type Category = { id: string; name: string; active: boolean };
type UploadStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "completing"
  | "completed"
  | "error"
  | "cancelled";

type UploadItem = {
  localId: string;
  file: File;
  title: string;
  categoryId: string;
  status: UploadStatus;
  progress: number;
  speedBytesPerSecond: number;
  uploadedBytes: number;
  error: string;
  sessionId: string | null;
  videoId: string | null;
};

type UploadSessionResponse = {
  upload: {
    id: string;
    videoId: string;
    filename: string;
    sizeBytes: string;
    partSizeBytes: number;
    expectedParts: number;
    status: string;
    expiresAt: string;
    completedParts: Array<{ partNumber: number; etag: string }>;
  };
  resumed: boolean;
};

type UploadConfiguration = {
  allowedExtensions: string[];
  uploadsEnabled: boolean;
  defaultCategoryId: string | null;
  maxFileBytes: string;
  maxConcurrentFiles: number;
  maxConcurrentParts: number;
  partSizeBytes: number;
};

const maxUploadPartAttempts = 5;
const uploadPartTimeoutMs = 15 * 60 * 1000;

class UploadPartError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "UploadPartError";
  }
}

const allowedExtensions = [
  ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".ts",
  ".m2ts", ".mts", ".mpg", ".mpeg", ".avi", ".ogv"
];

const statusLabels: Record<UploadStatus, string> = {
  queued: "รออัปโหลด",
  preparing: "กำลังเตรียมไฟล์",
  uploading: "กำลังอัปโหลด",
  completing: "กำลังยืนยันไฟล์",
  completed: "อัปโหลดสำเร็จ",
  error: "เกิดข้อผิดพลาด",
  cancelled: "ยกเลิกแล้ว"
};

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function extensionOf(filename: string) {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : "";
}

function titleFromFilename(filename: string) {
  const extension = extensionOf(filename);
  return filename.slice(0, filename.length - extension.length).slice(0, 200);
}

function wait(milliseconds: number) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

function retryDelay(attempt: number) {
  const exponentialDelay = Math.min(1000 * 2 ** (attempt - 1), 8000);
  return exponentialDelay + Math.floor(Math.random() * 500);
}

async function signatureBase64(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function uploadPart(
  url: string,
  part: Blob,
  onProgress: (loaded: number) => void,
  register: (xhr: XMLHttpRequest) => void,
  unregister: (xhr: XMLHttpRequest) => void
) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open("PUT", url);
    xhr.timeout = uploadPartTimeoutMs;
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onerror = () => {
      unregister(xhr);
      reject(new UploadPartError(
        "การเชื่อมต่อกับพื้นที่จัดเก็บขาดหายระหว่างส่งข้อมูล ระบบจะลองเชื่อมต่อใหม่",
        true
      ));
    };
    xhr.ontimeout = () => {
      unregister(xhr);
      reject(new UploadPartError(
        "หมดเวลารอการอัปโหลดส่วนไฟล์ ระบบจะลองส่งส่วนนี้ใหม่",
        true
      ));
    };
    xhr.onabort = () => {
      unregister(xhr);
      reject(new UploadPartError("ยกเลิกการอัปโหลดแล้ว", false));
    };
    xhr.onload = () => {
      unregister(xhr);
      if (xhr.status < 200 || xhr.status >= 300) {
        const retryable = xhr.status === 408 || xhr.status === 429 || xhr.status >= 500;
        reject(new UploadPartError(
          `อัปโหลดส่วนไฟล์ไม่สำเร็จ (HTTP ${xhr.status})`,
          retryable
        ));
        return;
      }
      const etag = xhr.getResponseHeader("ETag");
      if (!etag) {
        reject(new UploadPartError(
          "พื้นที่จัดเก็บไม่เปิดเผย ETag กรุณาตั้งค่า CORS ให้ ExposeHeaders: ETag",
          false
        ));
        return;
      }
      resolve(etag);
    };
    xhr.send(part);
  });
}

export function UploadManager() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [batchCategoryId, setBatchCategoryId] = useState("");
  const [sourceMode, setSourceMode] = useState<"local" | "drive">("local");
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [configuration, setConfiguration] = useState<UploadConfiguration>({
    allowedExtensions,
    uploadsEnabled: true,
    defaultCategoryId: null,
    maxFileBytes: String(10 * 1024 ** 3),
    maxConcurrentFiles: 1,
    maxConcurrentParts: 2,
    partSizeBytes: 16 * 1024 ** 2
  });
  const xhrByItem = useRef(new Map<string, Set<XMLHttpRequest>>());
  const cancelled = useRef(new Set<string>());

  useEffect(() => {
    Promise.all([
      apiRequest<{ categories: Category[] }>("/categories"),
      apiRequest<UploadConfiguration>("/uploads/configuration")
    ])
      .then(([categoryResult, uploadConfiguration]) => {
        setCategories(categoryResult.categories.filter(category => category.active));
        setConfiguration(uploadConfiguration);
        const defaultCategoryId = uploadConfiguration.defaultCategoryId || "";
        setBatchCategoryId(defaultCategoryId);
        if (defaultCategoryId) {
          setItems(current =>
            current.map(item =>
              ["queued", "error"].includes(item.status) && !item.categoryId
                ? { ...item, categoryId: defaultCategoryId }
                : item
            )
          );
        }
        if (!uploadConfiguration.uploadsEnabled) {
          setGlobalError("ระบบปิดรับการอัปโหลดชั่วคราวโดยผู้ดูแลระบบ");
        }
      })
      .catch(error =>
        setGlobalError(error instanceof Error ? error.message : "โหลดการตั้งค่าอัปโหลดไม่สำเร็จ")
      );
  }, []);

  function patch(localId: string, update: Partial<UploadItem>) {
    setItems(current =>
      current.map(item => (item.localId === localId ? { ...item, ...update } : item))
    );
  }

  function addFiles(files: File[]) {
    setGlobalError("");
    const accepted: UploadItem[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      if (!allowedExtensions.includes(extensionOf(file.name))) {
        rejected.push(file.name);
        continue;
      }
      if (file.size > Number(configuration.maxFileBytes)) {
        rejected.push(`${file.name} (ขนาดเกิน ${formatBytes(Number(configuration.maxFileBytes))})`);
        continue;
      }
      accepted.push({
        localId: crypto.randomUUID(),
        file,
        title: titleFromFilename(file.name),
        categoryId: batchCategoryId,
        status: "queued",
        progress: 0,
        speedBytesPerSecond: 0,
        uploadedBytes: 0,
        error: "",
        sessionId: null,
        videoId: null
      });
    }
    setItems(current => [...current, ...accepted]);
    if (rejected.length) {
      setGlobalError(`ข้ามไฟล์ที่ไม่รองรับ: ${rejected.join(", ")}`);
    }
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  function applyBatchCategory(categoryId: string) {
    setBatchCategoryId(categoryId);
    setItems(current =>
      current.map(item =>
        ["queued", "error"].includes(item.status)
          ? { ...item, categoryId }
          : item
      )
    );
  }

  function dropFiles(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function registerXhr(localId: string, xhr: XMLHttpRequest) {
    const set = xhrByItem.current.get(localId) || new Set<XMLHttpRequest>();
    set.add(xhr);
    xhrByItem.current.set(localId, set);
  }

  function unregisterXhr(localId: string, xhr: XMLHttpRequest) {
    const set = xhrByItem.current.get(localId);
    set?.delete(xhr);
    if (!set?.size) xhrByItem.current.delete(localId);
  }

  async function processItem(item: UploadItem) {
    const localId = item.localId;
    let stopped = false;
    cancelled.current.delete(localId);
    patch(localId, {
      status: "preparing",
      progress: 0,
      uploadedBytes: 0,
      speedBytesPerSecond: 0,
      error: ""
    });
    const startedAt = performance.now();
    try {
      const signature = await signatureBase64(item.file);
      if (cancelled.current.has(localId)) return;
      const initiated = await apiRequest<UploadSessionResponse>("/uploads/initiate", {
        method: "POST",
        body: JSON.stringify({
          filename: item.file.name,
          title: item.title.trim() || titleFromFilename(item.file.name),
          categoryId: item.categoryId || null,
          sizeBytes: item.file.size,
          mimeType: item.file.type,
          signatureBase64: signature
        })
      });
      const session = initiated.upload;
      patch(localId, {
        sessionId: session.id,
        videoId: session.videoId,
        status: "uploading"
      });

      const completed = new Map(
        session.completedParts.map(part => [part.partNumber, part.etag])
      );
      let committedBytes = 0;
      for (const partNumber of completed.keys()) {
        const start = (partNumber - 1) * session.partSizeBytes;
        committedBytes += Math.min(session.partSizeBytes, item.file.size - start);
      }
      const inflight = new Map<number, number>();

      const reportProgress = () => {
        const inflightBytes = [...inflight.values()].reduce((sum, value) => sum + value, 0);
        const uploadedBytes = Math.min(item.file.size, committedBytes + inflightBytes);
        const elapsedSeconds = Math.max(0.1, (performance.now() - startedAt) / 1000);
        patch(localId, {
          uploadedBytes,
          progress: Math.min(99, (uploadedBytes / item.file.size) * 100),
          speedBytesPerSecond: uploadedBytes / elapsedSeconds
        });
      };

      const remaining = Array.from(
        { length: session.expectedParts },
        (_, index) => index + 1
      ).filter(partNumber => !completed.has(partNumber));
      let cursor = 0;
      const uploadWorker = async () => {
        while (cursor < remaining.length) {
          if (stopped || cancelled.current.has(localId)) {
            throw new UploadPartError("ยกเลิกการอัปโหลดแล้ว", false);
          }
          const partNumber = remaining[cursor++];
          if (partNumber === undefined) return;
          const start = (partNumber - 1) * session.partSizeBytes;
          const end = Math.min(item.file.size, start + session.partSizeBytes);
          const part = item.file.slice(start, end);
          let etag = "";
          for (let attempt = 1; attempt <= maxUploadPartAttempts; attempt += 1) {
            try {
              const presigned = await apiRequest<{
                parts: Array<{ partNumber: number; url: string }>;
              }>(`/uploads/${session.id}/parts/presign`, {
                method: "POST",
                body: JSON.stringify({ partNumbers: [partNumber] })
              });
              const url = presigned.parts[0]?.url;
              if (!url) throw new Error("ไม่ได้รับ URL สำหรับอัปโหลดส่วนไฟล์");
              etag = await uploadPart(
                url,
                part,
                loaded => {
                  inflight.set(partNumber, loaded);
                  reportProgress();
                },
                xhr => registerXhr(localId, xhr),
                xhr => unregisterXhr(localId, xhr)
              );
              break;
            } catch (error) {
              inflight.delete(partNumber);
              reportProgress();
              if (stopped || cancelled.current.has(localId)) throw error;
              const retryable = !(error instanceof UploadPartError) || error.retryable;
              if (!retryable || attempt === maxUploadPartAttempts) {
                const message = error instanceof Error ? error.message : "ไม่ทราบสาเหตุ";
                throw new Error(
                  `ส่วนที่ ${partNumber} อัปโหลดไม่สำเร็จหลังลอง ${attempt} ครั้ง: ${message}`
                );
              }
              await wait(retryDelay(attempt));
            }
          }
          if (!etag) throw new Error(`ส่วนที่ ${partNumber} ไม่ได้รับ ETag`);
          await apiRequest(`/uploads/${session.id}/parts/record`, {
            method: "POST",
            body: JSON.stringify({
              partNumber,
              etag,
              sizeBytes: part.size
            })
          });
          completed.set(partNumber, etag);
          committedBytes += part.size;
          inflight.delete(partNumber);
          reportProgress();
        }
      };

      const concurrentParts = Math.min(configuration.maxConcurrentParts, remaining.length);
      await Promise.all(Array.from({ length: concurrentParts }, () => uploadWorker()));
      if (cancelled.current.has(localId)) return;
      patch(localId, { status: "completing", progress: 99 });
      await apiRequest(`/uploads/${session.id}/complete`, {
        method: "POST",
        body: JSON.stringify({
          parts: [...completed.entries()]
            .sort(([left], [right]) => left - right)
            .map(([partNumber, etag]) => ({
              partNumber,
              etag,
              sizeBytes: Math.min(
                session.partSizeBytes,
                item.file.size - (partNumber - 1) * session.partSizeBytes
              )
            }))
        })
      });
      patch(localId, {
        status: "completed",
        progress: 100,
        uploadedBytes: item.file.size,
        speedBytesPerSecond: item.file.size / Math.max(0.1, (performance.now() - startedAt) / 1000)
      });
    } catch (error) {
      stopped = true;
      xhrByItem.current.get(localId)?.forEach(xhr => xhr.abort());
      xhrByItem.current.delete(localId);
      if (cancelled.current.has(localId)) {
        patch(localId, { status: "cancelled", speedBytesPerSecond: 0 });
      } else {
        patch(localId, {
          status: "error",
          speedBytesPerSecond: 0,
          error: error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ"
        });
      }
    }
  }

  async function startAll() {
    if (running) return;
    if (!configuration.uploadsEnabled) {
      setGlobalError("ระบบปิดรับการอัปโหลดชั่วคราวโดยผู้ดูแลระบบ");
      return;
    }
    const queue = items.filter(item => item.status === "queued" || item.status === "error");
    if (!queue.length) return;
    setRunning(true);
    setGlobalError("");
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        if (!item) return;
        await processItem(item);
      }
    };
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(configuration.maxConcurrentFiles, queue.length) },
          () => worker()
        )
      );
    } finally {
      setRunning(false);
    }
  }

  async function cancelItem(item: UploadItem) {
    cancelled.current.add(item.localId);
    xhrByItem.current.get(item.localId)?.forEach(xhr => xhr.abort());
    xhrByItem.current.delete(item.localId);
    if (item.sessionId) {
      await apiRequest(`/uploads/${item.sessionId}/abort`, {
        method: "POST",
        body: JSON.stringify({})
      }).catch(() => undefined);
    }
    patch(item.localId, { status: "cancelled", speedBytesPerSecond: 0 });
  }

  function removeItem(item: UploadItem) {
    if (["preparing", "uploading", "completing", "error"].includes(item.status)) {
      void cancelItem(item);
    }
    setItems(current => current.filter(entry => entry.localId !== item.localId));
  }

  const completedCount = items.filter(item => item.status === "completed").length;
  const activeCount = items.filter(item =>
    ["preparing", "uploading", "completing"].includes(item.status)
  ).length;

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">DIRECT MULTIPART / MINIO & R2</span>
          <h1>อัปโหลดวิดีโอ</h1>
          <p>ส่งไฟล์ตรงจากเบราว์เซอร์เข้าสู่พื้นที่จัดเก็บโดยไม่ผ่านเว็บเซิร์ฟเวอร์</p>
        </div>
        <div className="upload-summary">
          <span>ทั้งหมด <b>{items.length}</b></span>
          <span>กำลังทำงาน <b>{activeCount}</b></span>
          <span>สำเร็จ <b>{completedCount}</b></span>
        </div>
      </header>

      {globalError && <div className="notice error-notice"><AlertTriangle />{globalError}</div>}

      <section className="upload-layout">
        <article className="panel upload-main">
          <div className="upload-source-tabs" role="tablist" aria-label="แหล่งวิดีโอ">
            <button
              aria-selected={sourceMode === "local"}
              className={sourceMode === "local" ? "active" : ""}
              onClick={() => setSourceMode("local")}
              role="tab"
              type="button"
            >
              <Laptop />จากเครื่องนี้
            </button>
            <button
              aria-selected={sourceMode === "drive"}
              className={sourceMode === "drive" ? "active" : ""}
              onClick={() => setSourceMode("drive")}
              role="tab"
              type="button"
            >
              <Cloud />Google Drive
            </button>
          </div>

          {sourceMode === "local" ? (
            <label
              className={`upload-dropzone ${dragging ? "dragging" : ""}`}
              onDragEnter={() => setDragging(true)}
              onDragLeave={() => setDragging(false)}
              onDragOver={event => event.preventDefault()}
              onDrop={dropFiles}
            >
              <input
                accept={allowedExtensions.join(",")}
                multiple
                onChange={chooseFiles}
                type="file"
              />
              <span className="upload-icon"><Upload /></span>
              <strong>ลากไฟล์วิดีโอมาวางที่นี่</strong>
              <p>หรือคลิกเพื่อเลือกหลายไฟล์จากเครื่อง</p>
              <small>รองรับ MP4, MOV, WebM, MKV, MPEG-TS, AVI, OGV และ MPEG</small>
            </label>
          ) : (
            <GoogleDriveImporter
              categories={categories}
              categoryId={batchCategoryId}
              onCategoryChange={applyBatchCategory}
            />
          )}

          {(sourceMode === "local" || items.length > 0) && (
            <>
            <div className="queue-heading">
            <div>
              <span className="section-number">UPLOAD QUEUE</span>
              <h2>คิวการอัปโหลด</h2>
            </div>
            <button
              className="primary-button"
              disabled={running || !items.some(item => ["queued", "error"].includes(item.status))}
              onClick={() => void startAll()}
              type="button"
            >
              <Upload />{running ? "กำลังอัปโหลด…" : "เริ่มอัปโหลดทั้งหมด"}
            </button>
            </div>

            <div className="upload-batch-category">
            <div>
              <Tags />
              <span>
                <b>หมวดหมู่สำหรับการอัปโหลดรอบนี้</b>
                <small>กำหนดให้ไฟล์ที่รออัปโหลดทั้งหมดในครั้งเดียว และยังแก้รายไฟล์ได้</small>
              </span>
            </div>
            <select
              aria-label="หมวดหมู่สำหรับไฟล์ที่อัปโหลดรอบนี้ทั้งหมด"
              disabled={running}
              onChange={event => applyBatchCategory(event.target.value)}
              value={batchCategoryId}
            >
              <option value="">ไม่มีหมวดหมู่</option>
              {categories.map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            </div>

            {!items.length ? (
              <div className="queue-empty">
                <FileVideo /><span>ไฟล์ที่เลือกจะแสดงที่นี่</span>
              </div>
            ) : (
              <div className="upload-queue">
              {items.map(item => (
                <article className={`upload-item upload-${item.status}`} key={item.localId}>
                  <div className="file-badge"><FileVideo /></div>
                  <div className="upload-item-main">
                    <div className="upload-item-top">
                      <div>
                        <input
                          aria-label={`ชื่อวิดีโอสำหรับ ${item.file.name}`}
                          disabled={!["queued", "error"].includes(item.status)}
                          maxLength={200}
                          onChange={event => patch(item.localId, { title: event.target.value })}
                          value={item.title}
                        />
                        <small>{item.file.name} • {formatBytes(item.file.size)}</small>
                      </div>
                      <span className={`upload-status upload-status-${item.status}`}>
                        {item.status === "completed" && <Check />}
                        {item.status === "error" && <AlertTriangle />}
                        {statusLabels[item.status]}
                      </span>
                    </div>
                    <div className="upload-meta-row">
                      <select
                        aria-label={`หมวดหมู่ของ ${item.file.name}`}
                        disabled={!["queued", "error"].includes(item.status)}
                        onChange={event => patch(item.localId, { categoryId: event.target.value })}
                        value={item.categoryId}
                      >
                        <option value="">ไม่มีหมวดหมู่</option>
                        {categories.map(category => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </select>
                      <span>{item.progress.toFixed(1)}%</span>
                      <span>
                        {item.speedBytesPerSecond
                          ? `${formatBytes(item.speedBytesPerSecond)}/s`
                          : "—"}
                      </span>
                      <span>{formatBytes(item.uploadedBytes)} / {formatBytes(item.file.size)}</span>
                    </div>
                    <div className="progress-track">
                      <i style={{ width: `${item.progress}%` }} />
                    </div>
                    {item.error && <p className="upload-error">{item.error}</p>}
                  </div>
                  <div className="upload-item-actions">
                    {item.status === "error" && (
                      <button
                        aria-label="ลองอัปโหลดอีกครั้ง"
                        disabled={running}
                        onClick={() => void processItem(item)}
                        title="ลองใหม่"
                        type="button"
                      >
                        <RefreshCw />
                      </button>
                    )}
                    {["preparing", "uploading", "completing"].includes(item.status) && (
                      <button
                        aria-label="ยกเลิกการอัปโหลด"
                        onClick={() => void cancelItem(item)}
                        title="ยกเลิก"
                        type="button"
                      >
                        <Pause />
                      </button>
                    )}
                    <button
                      aria-label="นำไฟล์ออกจากรายการ"
                      onClick={() => removeItem(item)}
                      title="นำออก"
                      type="button"
                    >
                      {item.status === "completed" ? <X /> : <Trash2 />}
                    </button>
                  </div>
                </article>
              ))}
              </div>
            )}
            </>
          )}
        </article>

        <aside className="panel upload-guide">
          <span className="section-number">UPLOAD POLICY</span>
          <h2>ข้อกำหนดไฟล์</h2>
          <ul>
            <li><Check /> ตรวจนามสกุล MIME และ file signature</li>
            <li><Check /> แบ่งไฟล์เป็นส่วนและ retry แยกส่วน</li>
            <li><Check /> บันทึก ETag เพื่อรองรับการอัปโหลดต่อ</li>
            <li><Check /> URL อัปโหลดมีอายุสั้น</li>
            <li><Check /> ไฟล์ส่งตรงเข้า MinIO หรือ Cloudflare R2</li>
          </ul>
          <div className="security-callout">
            <AlertTriangle />
            <p>
              อย่าปิดหน้าต่างระหว่างอัปโหลด ระบบสามารถต่อจากส่วนที่สำเร็จเมื่อเลือกไฟล์เดิมอีกครั้ง
            </p>
          </div>
          <div className="supported-list">
            <span>นามสกุลที่รองรับ</span>
            <p>{allowedExtensions.join(" · ")}</p>
          </div>
        </aside>
      </section>
    </>
  );
}
