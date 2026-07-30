"use client";

import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  X
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadataJson: unknown;
  ipHash: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
};
type AuditResponse = {
  data: AuditLog[];
  filters: { actions: string[]; entityTypes: string[] };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const actionLabels: Record<string, string> = {
  LOGIN_SUCCESS: "เข้าสู่ระบบสำเร็จ",
  LOGIN_FAILURE: "เข้าสู่ระบบไม่สำเร็จ",
  USER_CREATED: "สร้างผู้ใช้งาน",
  USER_UPDATED: "แก้ไขผู้ใช้งาน",
  USER_SESSIONS_REVOKED: "ยกเลิก Session",
  CATEGORY_CREATED: "สร้างหมวดหมู่",
  CATEGORY_UPDATED: "แก้ไขหมวดหมู่",
  CATEGORY_DELETED: "ลบหมวดหมู่",
  DOMAIN_CREATED: "เพิ่มโดเมน",
  DOMAIN_UPDATED: "แก้ไขโดเมน",
  DOMAIN_DELETED: "ลบโดเมน",
  VIDEO_UPLOAD_STARTED: "เริ่มอัปโหลดวิดีโอ",
  VIDEO_UPLOAD_COMPLETED: "อัปโหลดวิดีโอสำเร็จ",
  VIDEO_UPDATED: "แก้ไขวิดีโอ",
  VIDEO_DELETED: "ลบวิดีโอ",
  SYSTEM_SETTINGS_UPDATED: "แก้การตั้งค่าระบบ"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Bangkok"
  }).format(new Date(value));
}

export function AuditViewer() {
  const [response, setResponse] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  async function load(targetPage = page) {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(targetPage), pageSize: "50" });
    if (search.trim()) params.set("search", search.trim());
    if (action !== "all") params.set("action", action);
    if (entityType !== "all") params.set("entityType", entityType);
    try {
      const result = await apiRequest<AuditResponse>(`/audit?${params.toString()}`);
      setResponse(result);
      setPage(targetPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดบันทึกกิจกรรมไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1);
  }, []);

  function filter(event: FormEvent) {
    event.preventDefault();
    void load(1);
  }

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">SECURITY AUDIT TRAIL</span>
          <h1>บันทึกกิจกรรม</h1>
          <p>ตรวจสอบเหตุการณ์สำคัญ ผู้ดำเนินการ และข้อมูลประกอบย้อนหลัง</p>
        </div>
        <div className="header-actions">
          <button className="icon" onClick={() => void load()} type="button"><RefreshCw /></button>
        </div>
      </header>
      {error && <div className="notice error-notice"><ShieldAlert />{error}</div>}
      <section className="panel management-panel">
        <form className="management-toolbar" onSubmit={filter}>
          <div className="search-box">
            <Search />
            <input onChange={event => setSearch(event.target.value)} placeholder="ค้นหา action, entity หรือ ID" value={search} />
            <button type="submit">ค้นหา</button>
          </div>
          <select onChange={event => setAction(event.target.value)} value={action}>
            <option value="all">ทุกกิจกรรม</option>
            {response?.filters.actions.map(item => <option key={item} value={item}>{actionLabels[item] || item}</option>)}
          </select>
          <select onChange={event => setEntityType(event.target.value)} value={entityType}>
            <option value="all">ทุกประเภทข้อมูล</option>
            {response?.filters.entityTypes.map(item => <option key={item}>{item}</option>)}
          </select>
          <button className="secondary-button" type="submit"><Filter />กรอง</button>
        </form>
        {loading ? (
          <div className="loading-state"><i className="spinner" />กำลังโหลด Audit log…</div>
        ) : response?.data.length ? (
          <>
            <div className="management-table-wrap">
              <table className="management-table audit-table">
                <thead><tr><th>เวลา</th><th>กิจกรรม</th><th>ผู้ดำเนินการ</th><th>ข้อมูลเป้าหมาย</th><th>รายละเอียด</th></tr></thead>
                <tbody>
                  {response.data.map(log => (
                    <tr key={log.id}>
                      <td><span className="cell-subtitle">{formatDate(log.createdAt)}</span></td>
                      <td><strong>{actionLabels[log.action] || log.action}</strong><small>{log.action}</small></td>
                      <td><span>{log.actor?.name || "ระบบ/บัญชีถูกลบ"}</span><small>{log.actor?.email || "—"}</small></td>
                      <td><code>{log.entityType}</code><small>{log.entityId || "—"}</small></td>
                      <td><button className="detail-button" onClick={() => setSelected(log)} type="button"><Activity />เปิดรายละเอียด</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="simple-pagination">
              <span>ทั้งหมด {response.pagination.total.toLocaleString("th-TH")} เหตุการณ์</span>
              <div>
                <button disabled={page <= 1} onClick={() => void load(page - 1)} type="button"><ChevronLeft />ก่อนหน้า</button>
                <b>{page} / {response.pagination.totalPages}</b>
                <button disabled={page >= response.pagination.totalPages} onClick={() => void load(page + 1)} type="button">ถัดไป<ChevronRight /></button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state"><Activity /><strong>ไม่พบบันทึกกิจกรรม</strong><p>ลองเปลี่ยนตัวกรองหรือคำค้นหา</p></div>
        )}
      </section>
      {selected && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card audit-detail-card">
            <div className="modal-heading">
              <div><span className="section-number">AUDIT EVENT</span><h2>{actionLabels[selected.action] || selected.action}</h2></div>
              <button onClick={() => setSelected(null)} type="button"><X /></button>
            </div>
            <dl className="audit-details">
              <div><dt>เวลา</dt><dd>{formatDate(selected.createdAt)}</dd></div>
              <div><dt>ผู้ดำเนินการ</dt><dd>{selected.actor ? `${selected.actor.name} (${selected.actor.email})` : "ระบบ/บัญชีถูกลบ"}</dd></div>
              <div><dt>เป้าหมาย</dt><dd>{selected.entityType} / {selected.entityId || "—"}</dd></div>
              {selected.ipHash && <div><dt>IP hash</dt><dd><code>{selected.ipHash}</code></dd></div>}
              {selected.userAgent && <div><dt>User agent</dt><dd>{selected.userAgent}</dd></div>}
            </dl>
            <span className="section-number">METADATA</span>
            <pre>{JSON.stringify(selected.metadataJson, null, 2)}</pre>
          </div>
        </div>
      )}
    </>
  );
}
