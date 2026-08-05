"use client";

import {
  Globe2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Domain = {
  id: string;
  hostname: string;
  includeSubdomains: boolean;
  active: boolean;
  videoCount: number;
  playbackSessionCount: number;
  createdAt: string;
  updatedAt: string;
};

export function DomainManager() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [editing, setEditing] = useState<Domain | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [hostname, setHostname] = useState("");
  const [includeSubdomains, setIncludeSubdomains] = useState(false);
  const [active, setActive] = useState(true);
  const [allowAllDomains, setAllowAllDomains] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (activeFilter !== "all") params.set("active", activeFilter);
    try {
      const result = await apiRequest<{
        domains: Domain[];
        accessPolicy: { allowAllDomains: boolean };
      }>(
        `/domains${params.size ? `?${params.toString()}` : ""}`
      );
      setDomains(result.domains);
      setAllowAllDomains(result.accessPolicy.allowAllDomains);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดโดเมนไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditing(null);
    setHostname("");
    setIncludeSubdomains(false);
    setActive(true);
    setShowForm(true);
  }

  function openEdit(domain: Domain) {
    setEditing(domain);
    setHostname(domain.hostname);
    setIncludeSubdomains(domain.includeSubdomains);
    setActive(domain.active);
    setShowForm(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      await apiRequest(editing ? `/domains/${editing.id}` : "/domains", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          hostname: hostname.trim(),
          includeSubdomains,
          active
        })
      });
      setNotice(editing ? "แก้ไขโดเมนแล้ว" : "เพิ่มโดเมนแล้ว");
      setShowForm(false);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "บันทึกโดเมนไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  async function toggle(domain: Domain) {
    setWorking(true);
    setError("");
    try {
      await apiRequest(`/domains/${domain.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !domain.active })
      });
      setNotice(domain.active ? "ปิดโดเมนแล้ว" : "เปิดโดเมนแล้ว");
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "เปลี่ยนสถานะโดเมนไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  async function toggleAllowAllDomains() {
    const next = !allowAllDomains;
    if (
      next &&
      !window.confirm(
        "เปิดให้ทุกโดเมนเล่นวิดีโอได้ชั่วคราวหรือไม่? การตั้งค่านี้จะเปิดค้างจนกว่าคุณจะปิดเอง"
      )
    ) return;
    setWorking(true);
    setError("");
    try {
      const result = await apiRequest<{
        accessPolicy: { allowAllDomains: boolean };
      }>("/domains/access-policy", {
        method: "PATCH",
        body: JSON.stringify({ allowAllDomains: next })
      });
      setAllowAllDomains(result.accessPolicy.allowAllDomains);
      setNotice(next
        ? "เปิดอนุญาตทุกโดเมนแล้ว — ระบบจะเปิดค้างจนกว่าจะปิดเอง"
        : "ปิดอนุญาตทุกโดเมนแล้ว — กลับมาใช้รายการโดเมนที่กำหนด");
      window.setTimeout(() => setNotice(""), 4500);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "เปลี่ยนนโยบายโดเมนไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  async function remove(domain: Domain) {
    if (!window.confirm(`ลบโดเมน “${domain.hostname}” หรือไม่?`)) return;
    setWorking(true);
    setError("");
    try {
      await apiRequest(`/domains/${domain.id}`, { method: "DELETE" });
      setNotice("ลบโดเมนแล้ว");
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "ลบโดเมนไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">PLAYBACK ACCESS CONTROL</span>
          <h1>โดเมนที่อนุญาต</h1>
          <p>กำหนดเว็บไซต์ที่สามารถฝังและเล่นวิดีโอจากระบบได้</p>
        </div>
        <div className="header-actions">
          <button className="icon" onClick={() => void load()} type="button"><RefreshCw /></button>
          <button className="primary" onClick={openCreate} type="button"><Plus />เพิ่มโดเมน</button>
        </div>
      </header>
      {notice && <div className="notice success-notice"><ShieldCheck />{notice}</div>}
      {error && <div className="notice error-notice"><X />{error}</div>}

      <section className={`domain-global-access ${allowAllDomains ? "is-open" : "is-restricted"}`}>
        <div className="domain-global-icon">
          {allowAllDomains ? <ShieldAlert /> : <ShieldCheck />}
        </div>
        <div>
          <span className="section-number">GLOBAL ACCESS OVERRIDE</span>
          <strong>{allowAllDomains ? "กำลังอนุญาตทุกโดเมน" : "ใช้รายการโดเมนที่อนุญาต"}</strong>
          <p>
            {allowAllDomains
              ? "เว็บไซต์ภายนอกทุกโดเมนสามารถฝังและเล่นวิดีโอได้จนกว่าคุณจะปิดการตั้งค่านี้"
              : "อนุญาตเฉพาะโดเมนที่เปิดใช้งานและผูกกับวิดีโอแต่ละรายการเท่านั้น"}
          </p>
        </div>
        <button
          aria-checked={allowAllDomains}
          aria-label="อนุญาตทุกโดเมน"
          className="domain-access-toggle"
          disabled={working || loading}
          onClick={() => void toggleAllowAllDomains()}
          role="switch"
          type="button"
        >
          <span><i /></span>
          <b>{allowAllDomains ? "เปิดอยู่" : "ปิดอยู่"}</b>
        </button>
      </section>

      <section className="panel management-panel">
        <form className="management-toolbar" onSubmit={event => { event.preventDefault(); void load(); }}>
          <div className="search-box">
            <Search />
            <input onChange={event => setSearch(event.target.value)} placeholder="ค้นหา hostname" value={search} />
            <button type="submit">ค้นหา</button>
          </div>
          <select onChange={event => setActiveFilter(event.target.value)} value={activeFilter}>
            <option value="all">ทุกสถานะ</option>
            <option value="true">เปิดใช้งาน</option>
            <option value="false">ปิดใช้งาน</option>
          </select>
        </form>
        {loading ? (
          <div className="loading-state"><i className="spinner" />กำลังโหลดโดเมน…</div>
        ) : domains.length ? (
          <div className="management-table-wrap">
            <table className="management-table">
              <thead><tr><th>Hostname</th><th>ขอบเขต</th><th>วิดีโอ</th><th>Playback Session</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
              <tbody>
                {domains.map(domain => (
                  <tr key={domain.id}>
                    <td><strong className="hostname-cell"><Globe2 />{domain.hostname}</strong></td>
                    <td>{domain.includeSubdomains ? "รวม subdomain" : "เฉพาะ hostname"}</td>
                    <td>{domain.videoCount.toLocaleString("th-TH")}</td>
                    <td>{domain.playbackSessionCount.toLocaleString("th-TH")}</td>
                    <td><span className={`status-pill ${domain.active ? "status-ready" : ""}`}><i />{domain.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span></td>
                    <td>
                      <div className="row-actions">
                        <button aria-label="แก้ไขโดเมน" onClick={() => openEdit(domain)} type="button"><Pencil /></button>
                        <button aria-label="เปลี่ยนสถานะโดเมน" disabled={working} onClick={() => void toggle(domain)} type="button"><Power /></button>
                        <button
                          aria-label="ลบโดเมน"
                          className="danger-action"
                          disabled={working || domain.videoCount > 0 || domain.playbackSessionCount > 0}
                          onClick={() => void remove(domain)}
                          type="button"
                        ><Trash2 /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state"><Globe2 /><strong>ยังไม่มีโดเมนที่อนุญาต</strong><p>เพิ่ม hostname ก่อนนำวิดีโอไปฝังบนเว็บไซต์</p><button className="primary-button" onClick={openCreate} type="button"><Plus />เพิ่มโดเมน</button></div>
        )}
      </section>

      {showForm && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card" onSubmit={submit}>
            <div className="modal-heading">
              <div><span className="section-number">{editing ? "EDIT DOMAIN" : "NEW DOMAIN"}</span><h2>{editing ? "แก้ไขโดเมน" : "เพิ่มโดเมน"}</h2></div>
              <button onClick={() => setShowForm(false)} type="button"><X /></button>
            </div>
            <label>Hostname
              <input maxLength={253} onChange={event => setHostname(event.target.value)} placeholder="example.com" required value={hostname} />
            </label>
            <p className="form-help">กรอกเฉพาะ hostname โดยไม่ใส่ path หรือ port ระบบจะตัด protocol ให้อัตโนมัติ</p>
            <label className="check-field">
              <input checked={includeSubdomains} onChange={event => setIncludeSubdomains(event.target.checked)} type="checkbox" />
              อนุญาต subdomain ทั้งหมด
            </label>
            <label className="check-field">
              <input checked={active} onChange={event => setActive(event.target.checked)} type="checkbox" />
              เปิดใช้งานโดเมนนี้
            </label>
            <div className="modal-actions">
              <button onClick={() => setShowForm(false)} type="button">ยกเลิก</button>
              <button className="primary-button" disabled={working} type="submit">{working ? "กำลังบันทึก…" : "บันทึกโดเมน"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
