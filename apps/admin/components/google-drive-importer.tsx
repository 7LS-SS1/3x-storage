"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Unlink,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Category = { id: string; name: string; active: boolean };
type DriveStatus = {
  configured: boolean;
  missingSettings: string[];
  connected: boolean;
  connection: { email: string; updatedAt: string } | null;
};
type PickerToken = {
  accessToken: string;
  expiresIn: number;
  apiKey: string;
  appId: string;
};
type DriveImport = {
  id: string;
  filename: string;
  title: string;
  sizeBytes: string;
  status:
    | "QUEUED"
    | "VALIDATING"
    | "TRANSFERRING"
    | "COMPLETING"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED";
  progress: number;
  transferredBytes: string;
  videoId: string;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  completedAt: string | null;
};

type PickerBuilderInstance = {
  addView(value: unknown): PickerBuilderInstance;
  enableFeature(value: string): PickerBuilderInstance;
  setAppId(value: string): PickerBuilderInstance;
  setCallback(
    callback: (data: { action?: string; docs?: Array<{ id?: string }> }) => void
  ): PickerBuilderInstance;
  setDeveloperKey(value: string): PickerBuilderInstance;
  setOAuthToken(value: string): PickerBuilderInstance;
  setOrigin(value: string): PickerBuilderInstance;
  build(): { setVisible(value: boolean): void };
};

type GooglePickerApi = {
  picker: {
    DocsView: new (viewId: string) => {
      setIncludeFolders(value: boolean): unknown;
      setSelectFolderEnabled(value: boolean): unknown;
      setMimeTypes(value: string): unknown;
    };
    PickerBuilder: new () => PickerBuilderInstance;
    ViewId: { DOCS: string };
    Feature: {
      MULTISELECT_ENABLED: string;
      SUPPORT_DRIVES: string;
    };
    Action: { PICKED: string; CANCEL: string };
  };
};

declare global {
  interface Window {
    gapi?: {
      load(
        name: string,
        options: {
          callback(): void;
          onerror(): void;
          timeout: number;
          ontimeout(): void;
        }
      ): void;
    };
    google?: GooglePickerApi;
  }
}

const activeStatuses = new Set([
  "QUEUED",
  "VALIDATING",
  "TRANSFERRING",
  "COMPLETING"
]);
const statusLabels: Record<DriveImport["status"], string> = {
  QUEUED: "รอเริ่มงาน",
  VALIDATING: "กำลังตรวจสอบ",
  TRANSFERRING: "กำลังถ่ายโอน",
  COMPLETING: "กำลังยืนยันไฟล์",
  COMPLETED: "นำเข้าสำเร็จ",
  FAILED: "นำเข้าไม่สำเร็จ",
  CANCELLED: "ยกเลิกแล้ว"
};

function formatBytes(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

let pickerLoader: Promise<void> | null = null;
function loadGooglePicker() {
  if (window.google?.picker) return Promise.resolve();
  if (pickerLoader) return pickerLoader;
  pickerLoader = new Promise<void>((resolve, reject) => {
    const loadApi = () => {
      if (!window.gapi) {
        reject(new Error("โหลด Google API ไม่สำเร็จ"));
        return;
      }
      window.gapi.load("picker", {
        callback: resolve,
        onerror: () => reject(new Error("โหลด Google Picker ไม่สำเร็จ")),
        timeout: 15_000,
        ontimeout: () => reject(new Error("Google Picker ใช้เวลาตอบสนองนานเกินไป"))
      });
    };
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-picker="true"]'
    );
    if (existing) {
      if (window.gapi) loadApi();
      else existing.addEventListener("load", loadApi, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.googlePicker = "true";
    script.addEventListener("load", loadApi, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("โหลด Google API ไม่สำเร็จ")),
      { once: true }
    );
    document.head.appendChild(script);
  }).catch(error => {
    pickerLoader = null;
    throw error;
  });
  return pickerLoader;
}

export function GoogleDriveImporter({
  categories,
  categoryId,
  onCategoryChange
}: {
  categories: Category[];
  categoryId: string;
  onCategoryChange(categoryId: string): void;
}) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [imports, setImports] = useState<DriveImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [nextStatus, importResult] = await Promise.all([
        apiRequest<DriveStatus>("/google-drive/status"),
        apiRequest<{ imports: DriveImport[] }>("/google-drive/imports")
      ]);
      if (!mounted.current) return;
      setStatus(nextStatus);
      setImports(importResult.imports);
      if (!silent) setError("");
    } catch (loadError) {
      if (!mounted.current || silent) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "โหลดสถานะ Google Drive ไม่สำเร็จ"
      );
    } finally {
      if (mounted.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const query = new URLSearchParams(window.location.search);
    const driveResult = query.get("drive");
    if (driveResult === "connected") {
      setNotice("เชื่อมต่อ Google Drive สำเร็จแล้ว");
    } else if (driveResult === "denied") {
      setError("ยกเลิกการอนุญาต Google Drive");
    } else if (driveResult === "error") {
      setError("เชื่อมต่อ Google Drive ไม่สำเร็จ กรุณาลองใหม่");
    }
    if (driveResult) {
      query.delete("drive");
      const suffix = query.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${suffix ? `?${suffix}` : ""}`
      );
    }
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!imports.some(item => activeStatuses.has(item.status))) return;
    const timer = window.setInterval(() => void load(true), 3_000);
    return () => window.clearInterval(timer);
  }, [imports, load]);

  async function openPicker() {
    if (working) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const [token] = await Promise.all([
        apiRequest<PickerToken>("/google-drive/picker-token"),
        loadGooglePicker()
      ]);
      const pickerApi = window.google?.picker;
      if (!pickerApi) throw new Error("Google Picker ยังไม่พร้อมใช้งาน");
      const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS);
      view.setIncludeFolders(false);
      view.setSelectFolderEnabled(false);
      view.setMimeTypes(
        [
          "video/mp4",
          "video/quicktime",
          "video/webm",
          "video/x-matroska",
          "video/mp2t",
          "video/mpeg",
          "video/x-msvideo",
          "video/ogg"
        ].join(",")
      );
      const selectedFileIds = await new Promise<string[]>((resolve, reject) => {
        const picker = new pickerApi.PickerBuilder()
          .setOAuthToken(token.accessToken)
          .setDeveloperKey(token.apiKey)
          .setAppId(token.appId)
          .setOrigin(window.location.origin)
          .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
          .enableFeature(pickerApi.Feature.SUPPORT_DRIVES)
          .addView(view)
          .setCallback(data => {
            if (data.action === pickerApi.Action.PICKED) {
              resolve(
                (data.docs || [])
                  .map(document => document.id || "")
                  .filter(Boolean)
              );
            } else if (data.action === pickerApi.Action.CANCEL) {
              resolve([]);
            }
          })
          .build();
        try {
          picker.setVisible(true);
        } catch {
          reject(new Error("ไม่สามารถเปิด Google Picker ได้"));
        }
      });
      if (!selectedFileIds.length) return;
      const result = await apiRequest<{ imports: DriveImport[] }>(
        "/google-drive/imports",
        {
          method: "POST",
          body: JSON.stringify({
            fileIds: selectedFileIds,
            categoryId: categoryId || null
          })
        }
      );
      setNotice(
        `เพิ่มวิดีโอจาก Google Drive เข้าคิวแล้ว ${result.imports.length} รายการ`
      );
      await load(true);
    } catch (pickerError) {
      setError(
        pickerError instanceof Error
          ? pickerError.message
          : "เลือกไฟล์จาก Google Drive ไม่สำเร็จ"
      );
    } finally {
      setWorking(false);
    }
  }

  async function retry(item: DriveImport) {
    setWorking(true);
    setError("");
    try {
      await apiRequest(`/google-drive/imports/${item.id}/retry`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setNotice(`ส่ง ${item.filename} กลับเข้าคิวแล้ว`);
      await load(true);
    } catch (retryError) {
      setError(
        retryError instanceof Error ? retryError.message : "ลองนำเข้าใหม่ไม่สำเร็จ"
      );
    } finally {
      setWorking(false);
    }
  }

  async function cancel(item: DriveImport) {
    setWorking(true);
    setError("");
    try {
      await apiRequest(`/google-drive/imports/${item.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setNotice(`ยกเลิกการนำเข้า ${item.filename} แล้ว`);
      await load(true);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "ยกเลิกงานนำเข้าไม่สำเร็จ"
      );
    } finally {
      setWorking(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("ถอดการเชื่อมต่อ Google Drive จากบัญชีนี้หรือไม่?")) return;
    setWorking(true);
    setError("");
    try {
      await apiRequest("/google-drive/connection", { method: "DELETE" });
      setNotice("ถอดการเชื่อมต่อ Google Drive แล้ว");
      await load(true);
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "ถอดการเชื่อมต่อไม่สำเร็จ"
      );
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="drive-import-state">
        <i className="spinner" />กำลังตรวจสอบ Google Drive…
      </div>
    );
  }

  return (
    <section className="drive-importer">
      {notice && <div className="notice success-notice"><CheckCircle2 />{notice}</div>}
      {error && <div className="notice error-notice"><AlertTriangle />{error}</div>}

      {!status?.configured ? (
        <div className="drive-setup-required">
          <Cloud />
          <div>
            <strong>Google Drive ยังไม่ได้ตั้งค่า</strong>
            <p>เพิ่ม OAuth Client, Picker API key และ encryption key ใน Environment ก่อนใช้งาน</p>
            <small>ค่าที่ยังขาด: {status?.missingSettings.join(", ")}</small>
          </div>
        </div>
      ) : !status.connected ? (
        <div className="drive-connect-card">
          <span className="drive-logo"><Cloud /></span>
          <div>
            <strong>เชื่อมต่อ Google Drive</strong>
            <p>ระบบจะเข้าถึงเฉพาะไฟล์ที่คุณเลือกผ่าน Google Picker</p>
          </div>
          <button
            className="primary-button"
            disabled={working}
            onClick={() => window.location.assign("/backend/google-drive/connect")}
            type="button"
          >
            <Link2 />เชื่อมต่อบัญชี Google
          </button>
        </div>
      ) : (
        <>
          <div className="drive-connected-card">
            <div>
              <span className="drive-logo connected"><CheckCircle2 /></span>
              <span>
                <b>เชื่อมต่อแล้ว</b>
                <small>{status.connection?.email}</small>
              </span>
            </div>
            <button
              aria-label="ถอดการเชื่อมต่อ Google Drive"
              className="drive-disconnect"
              disabled={working}
              onClick={() => void disconnect()}
              type="button"
            >
              <Unlink />ถอดการเชื่อมต่อ
            </button>
          </div>

          <div className="drive-pick-panel">
            <div>
              <span className="section-number">GOOGLE DRIVE IMPORT</span>
              <h2>เลือกวิดีโอจาก Drive</h2>
              <p>เลือกได้สูงสุด 20 ไฟล์ต่อครั้ง ระบบจะถ่ายโอนเข้า storage ผ่านคิวเบื้องหลัง</p>
            </div>
            <label>
              หมวดหมู่สำหรับไฟล์ที่เลือก
              <select
                disabled={working}
                onChange={event => onCategoryChange(event.target.value)}
                value={categoryId}
              >
                <option value="">ไม่มีหมวดหมู่</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              disabled={working}
              onClick={() => void openPicker()}
              type="button"
            >
              {working ? <LoaderCircle className="spin-icon" /> : <Cloud />}
              {working ? "กำลังเปิด Google Drive…" : "เลือกวิดีโอจาก Google Drive"}
            </button>
          </div>
        </>
      )}

      {imports.length > 0 && (
        <div className="drive-import-list">
          <div className="drive-import-heading">
            <div>
              <span className="section-number">IMPORT HISTORY</span>
              <h3>งานนำเข้าล่าสุด</h3>
            </div>
            <button
              aria-label="รีเฟรชงานนำเข้า"
              disabled={working}
              onClick={() => void load()}
              type="button"
            >
              <RefreshCw />
            </button>
          </div>
          {imports.map(item => (
            <article className={`drive-import-item drive-${item.status.toLowerCase()}`} key={item.id}>
              <span className="drive-file-icon"><Cloud /></span>
              <div>
                <div className="drive-import-title">
                  <span>
                    <b>{item.title}</b>
                    <small>{item.filename} • {formatBytes(item.sizeBytes)}</small>
                  </span>
                  <em>{statusLabels[item.status]}</em>
                </div>
                <div className="progress-track">
                  <i style={{ width: `${item.progress}%` }} />
                </div>
                <div className="drive-import-meta">
                  <span>{item.progress}%</span>
                  <span>{formatBytes(item.transferredBytes)} / {formatBytes(item.sizeBytes)}</span>
                  {item.errorMessage && <strong>{item.errorMessage}</strong>}
                </div>
              </div>
              <div className="drive-import-actions">
                {activeStatuses.has(item.status) && (
                  <button
                    aria-label={`ยกเลิก ${item.filename}`}
                    disabled={working}
                    onClick={() => void cancel(item)}
                    type="button"
                  >
                    <X />
                  </button>
                )}
                {["FAILED", "CANCELLED"].includes(item.status) && (
                  <button
                    aria-label={`ลองนำเข้า ${item.filename} ใหม่`}
                    disabled={working || !status?.connected}
                    onClick={() => void retry(item)}
                    type="button"
                  >
                    <RotateCcw />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
