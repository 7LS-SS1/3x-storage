"use client";

import {
  CheckCircle2,
  Database,
  HardDrive,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  ToggleLeft,
  X
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Category = { id: string; name: string; active: boolean };
type Config = {
  id: number;
  siteName: string;
  uploadsEnabled: boolean;
  defaultCategoryId: string | null;
  defaultCategory: Category | null;
  supportEmail: string | null;
  storageWarningPercent: number;
  updatedAt: string;
  updatedBy: { id: string; name: string; email: string } | null;
};
type Runtime = {
  environment: string;
  storageDriver: "r2" | "s3";
  storageBucket: string | null;
  adminOrigin: string | null;
  playerOrigin: string | null;
  mediaOrigin: string | null;
  trustProxy: boolean;
  apiDocsEnabled: boolean;
  analyticsConfigured: boolean;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  secretsConfigured: {
    session: boolean;
    csrf: boolean;
    mediaSigning: boolean;
    storage: boolean;
    googleDrive: boolean;
  };
};

export function SystemSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [siteName, setSiteName] = useState("");
  const [uploadsEnabled, setUploadsEnabled] = useState(true);
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [storageWarningPercent, setStorageWarningPercent] = useState(85);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [settingsResult, categoryResult] = await Promise.all([
        apiRequest<{ config: Config; runtime: Runtime | null }>("/settings"),
        apiRequest<{ categories: Category[] }>("/categories")
      ]);
      const next = settingsResult.config;
      setConfig(next);
      setRuntime(settingsResult.runtime);
      setCategories(categoryResult.categories.filter(category => category.active));
      setSiteName(next.siteName);
      setUploadsEnabled(next.uploadsEnabled);
      setDefaultCategoryId(next.defaultCategoryId || "");
      setSupportEmail(next.supportEmail || "");
      setStorageWarningPercent(next.storageWarningPercent);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดการตั้งค่าระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const result = await apiRequest<{ config: Config }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          siteName: siteName.trim(),
          uploadsEnabled,
          defaultCategoryId: defaultCategoryId || null,
          supportEmail: supportEmail.trim() || null,
          storageWarningPercent
        })
      });
      setConfig(result.config);
      setNotice("บันทึกการตั้งค่าระบบแล้ว");
      window.setTimeout(() => setNotice(""), 3500);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึกการตั้งค่าระบบไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <div className="loading-state"><i className="spinner" />กำลังโหลดการตั้งค่าระบบ…</div>;
  }

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">SYSTEM CONTROL PLANE</span>
          <h1>ตั้งค่าระบบ</h1>
          <p>ควบคุมพฤติกรรมของ Admin และตรวจสถานะ Runtime โดยไม่เปิดเผยค่าลับ</p>
        </div>
        <div className="header-actions">
          <button className="icon" onClick={() => void load()} type="button"><RefreshCw /></button>
        </div>
      </header>
      {notice && <div className="notice success-notice"><CheckCircle2 />{notice}</div>}
      {error && <div className="notice error-notice"><X />{error}</div>}

      <div className="settings-layout">
        <form className="panel settings-form" onSubmit={save}>
          <span className="section-number">01 / APPLICATION</span>
          <h2>การตั้งค่าหลัก</h2>
          <label>ชื่อระบบ
            <input maxLength={80} onChange={event => setSiteName(event.target.value)} required value={siteName} />
          </label>
          <label>อีเมลติดต่อผู้ดูแล
            <input maxLength={254} onChange={event => setSupportEmail(event.target.value)} placeholder="support@example.com" type="email" value={supportEmail} />
          </label>
          <label>หมวดหมู่เริ่มต้นสำหรับการอัปโหลด
            <select onChange={event => setDefaultCategoryId(event.target.value)} value={defaultCategoryId}>
              <option value="">ไม่มีหมวดหมู่เริ่มต้น</option>
              {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label>แจ้งเตือนพื้นที่จัดเก็บเมื่อถึง
            <div className="range-field">
              <input max={99} min={50} onChange={event => setStorageWarningPercent(Number(event.target.value))} type="range" value={storageWarningPercent} />
              <strong>{storageWarningPercent}%</strong>
            </div>
          </label>
          <label className="switch-field">
            <input checked={uploadsEnabled} onChange={event => setUploadsEnabled(event.target.checked)} type="checkbox" />
            <span><ToggleLeft /><b>เปิดรับการอัปโหลดวิดีโอ</b><small>เมื่อปิด ระบบจะปฏิเสธการเริ่ม multipart upload ใหม่ทั้งหมด</small></span>
          </label>
          <button className="primary-button settings-save" disabled={working} type="submit"><Save />{working ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}</button>
          {config?.updatedBy && <p className="form-help">แก้ไขล่าสุดโดย {config.updatedBy.name}</p>}
        </form>

        {runtime && (
          <div className="settings-runtime">
            <section className="panel">
              <span className="section-number">02 / RUNTIME</span>
              <h2>สภาพแวดล้อม</h2>
              <div className="runtime-list">
                <div><span><Database />Environment</span><b>{runtime.environment}</b></div>
                <div><span><HardDrive />Storage</span><b>{runtime.storageDriver.toUpperCase()} / {runtime.storageBucket || "ไม่ได้ตั้งค่า"}</b></div>
                <div><span><Settings />Session</span><b>{runtime.sessionIdleMinutes} นาที / สูงสุด {runtime.sessionAbsoluteHours} ชม.</b></div>
                <div><span><ShieldCheck />Trust proxy</span><b>{runtime.trustProxy ? "เปิด" : "ปิด"}</b></div>
                <div><span><ShieldCheck />Analytics Engine</span><b>{runtime.analyticsConfigured ? "พร้อมใช้งาน" : "ยังไม่ตั้งค่า"}</b></div>
              </div>
            </section>
            <section className="panel">
              <span className="section-number">03 / SECURITY</span>
              <h2>สถานะค่าลับ</h2>
              <div className="secret-status-grid">
                {Object.entries(runtime.secretsConfigured).map(([key, ready]) => (
                  <div className={ready ? "ready" : "missing"} key={key}>
                    <i />
                    <span>{key}</span>
                    <b>{ready ? "พร้อม" : "ขาดค่า"}</b>
                  </div>
                ))}
              </div>
              <p className="security-note">หน้านี้แสดงเฉพาะสถานะ ไม่ส่งค่าลับจากเซิร์ฟเวอร์กลับมายังเบราว์เซอร์</p>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
