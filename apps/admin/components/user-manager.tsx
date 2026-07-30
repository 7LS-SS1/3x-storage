"use client";

import {
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCog,
  Users,
  X
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Role = "SYSTEM" | "ADMIN" | "STAFF";
type UserItem = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  videoCount: number;
  activeSessionCount: number;
};
type UserResponse = {
  data: UserItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
type UserForm = {
  email: string;
  name: string;
  password: string;
  role: Role;
  active: boolean;
};

const roleLabels: Record<Role, string> = {
  SYSTEM: "ผู้ดูแลระบบสูงสุด",
  ADMIN: "ผู้ดูแลระบบ",
  STAFF: "เจ้าหน้าที่"
};

function formatDate(value: string | null) {
  if (!value) return "ยังไม่เคยเข้าสู่ระบบ";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(new Date(value));
}

export function UserManager({
  currentUserId,
  currentRole
}: {
  currentUserId: string;
  currentRole: Role;
}) {
  const [response, setResponse] = useState<UserResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<UserForm>({
    email: "",
    name: "",
    password: "",
    role: "STAFF",
    active: true
  });

  async function load(targetPage = page) {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(targetPage), pageSize: "20" });
    if (search.trim()) params.set("search", search.trim());
    if (roleFilter !== "all") params.set("role", roleFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    try {
      const result = await apiRequest<UserResponse>(`/users?${params.toString()}`);
      setResponse(result);
      setPage(targetPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดผู้ใช้งานไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1);
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ email: "", name: "", password: "", role: "STAFF", active: true });
    setShowForm(true);
  }

  function openEdit(user: UserItem) {
    setEditing(user);
    setForm({
      email: user.email,
      name: user.name,
      password: "",
      role: user.role,
      active: user.active
    });
    setShowForm(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      await apiRequest(editing ? `/users/${editing.id}` : "/users", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          email: form.email.trim(),
          name: form.name.trim(),
          role: form.role,
          active: form.active,
          ...(!editing || form.password ? { password: form.password } : {})
        })
      });
      setNotice(editing ? "แก้ไขบัญชีผู้ใช้แล้ว" : "สร้างบัญชีผู้ใช้แล้ว");
      setShowForm(false);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "บันทึกผู้ใช้งานไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  async function revoke(user: UserItem) {
    if (!window.confirm(`ยกเลิก Session ทั้งหมดของ “${user.name}” หรือไม่?`)) return;
    setWorking(true);
    setError("");
    try {
      const result = await apiRequest<{ revokedCount: number }>(
        `/users/${user.id}/revoke-sessions`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setNotice(`ยกเลิก Session แล้ว ${result.revokedCount} รายการ`);
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "ยกเลิก Session ไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">IDENTITY & ACCESS</span>
          <h1>จัดการผู้ใช้งาน</h1>
          <p>ควบคุมบทบาท สถานะบัญชี รหัสผ่าน และ Session ของเจ้าหน้าที่</p>
        </div>
        <div className="header-actions">
          <button className="icon" onClick={() => void load()} type="button"><RefreshCw /></button>
          <button className="primary" onClick={openCreate} type="button"><Plus />เพิ่มผู้ใช้งาน</button>
        </div>
      </header>
      {notice && <div className="notice success-notice"><UserCog />{notice}</div>}
      {error && <div className="notice error-notice"><ShieldAlert />{error}</div>}

      <section className="panel management-panel">
        <form className="management-toolbar" onSubmit={event => { event.preventDefault(); void load(1); }}>
          <div className="search-box">
            <Search />
            <input onChange={event => setSearch(event.target.value)} placeholder="ค้นหาชื่อหรืออีเมล" value={search} />
            <button type="submit">ค้นหา</button>
          </div>
          {currentRole === "SYSTEM" && (
            <select onChange={event => setRoleFilter(event.target.value)} value={roleFilter}>
              <option value="all">ทุกบทบาท</option>
              <option value="SYSTEM">SYSTEM</option>
              <option value="ADMIN">ADMIN</option>
              <option value="STAFF">STAFF</option>
            </select>
          )}
          <select onChange={event => setStatusFilter(event.target.value)} value={statusFilter}>
            <option value="all">ทุกสถานะ</option>
            <option value="active">เปิดใช้งาน</option>
            <option value="inactive">ปิดใช้งาน</option>
          </select>
        </form>

        {loading ? (
          <div className="loading-state"><i className="spinner" />กำลังโหลดผู้ใช้งาน…</div>
        ) : response?.data.length ? (
          <>
            <div className="management-table-wrap">
              <table className="management-table">
                <thead>
                  <tr><th>ผู้ใช้งาน</th><th>บทบาท</th><th>วิดีโอ</th><th>Session</th><th>เข้าสู่ระบบล่าสุด</th><th>สถานะ</th><th>จัดการ</th></tr>
                </thead>
                <tbody>
                  {response.data.map(user => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.name}{user.id === currentUserId ? " (คุณ)" : ""}</strong>
                        <small>{user.email}</small>
                      </td>
                      <td><span className="role-badge">{roleLabels[user.role]}</span></td>
                      <td>{user.videoCount.toLocaleString("th-TH")}</td>
                      <td>{user.activeSessionCount.toLocaleString("th-TH")}</td>
                      <td><span className="cell-subtitle">{formatDate(user.lastLoginAt)}</span></td>
                      <td>
                        <span className={`status-pill ${user.active ? "status-ready" : ""}`}>
                          <i />{user.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                        </span>
                        {user.lockedUntil && new Date(user.lockedUntil) > new Date() && <small className="row-error">บัญชีถูกล็อก</small>}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button aria-label="แก้ไขผู้ใช้งาน" onClick={() => openEdit(user)} type="button"><Pencil /></button>
                          <button aria-label="ยกเลิกเซสชัน" disabled={working} onClick={() => void revoke(user)} type="button"><KeyRound /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="simple-pagination">
              <span>ทั้งหมด {response.pagination.total.toLocaleString("th-TH")} บัญชี</span>
              <div>
                <button disabled={page <= 1} onClick={() => void load(page - 1)} type="button">ก่อนหน้า</button>
                <b>{page} / {response.pagination.totalPages}</b>
                <button disabled={page >= response.pagination.totalPages} onClick={() => void load(page + 1)} type="button">ถัดไป</button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state"><Users /><strong>ไม่พบผู้ใช้งาน</strong><p>ลองเปลี่ยนตัวกรองหรือสร้างบัญชีใหม่</p></div>
        )}
      </section>

      {showForm && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card" onSubmit={submit}>
            <div className="modal-heading">
              <div><span className="section-number">{editing ? "EDIT USER" : "NEW USER"}</span><h2>{editing ? "แก้ไขผู้ใช้งาน" : "เพิ่มผู้ใช้งาน"}</h2></div>
              <button onClick={() => setShowForm(false)} type="button"><X /></button>
            </div>
            <label>ชื่อแสดงผล<input maxLength={120} onChange={event => setForm({ ...form, name: event.target.value })} required value={form.name} /></label>
            <label>อีเมล<input maxLength={254} onChange={event => setForm({ ...form, email: event.target.value })} required type="email" value={form.email} /></label>
            <label>{editing ? "รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)" : "รหัสผ่าน"}
              <input minLength={8} onChange={event => setForm({ ...form, password: event.target.value })} required={!editing} type="password" value={form.password} />
            </label>
            <label>บทบาท
              <select
                disabled={editing?.id === currentUserId || currentRole === "ADMIN"}
                onChange={event => setForm({ ...form, role: event.target.value as Role })}
                value={form.role}
              >
                {currentRole === "SYSTEM" && <option value="SYSTEM">SYSTEM</option>}
                {currentRole === "SYSTEM" && <option value="ADMIN">ADMIN</option>}
                <option value="STAFF">STAFF</option>
              </select>
            </label>
            <label className="check-field">
              <input
                checked={form.active}
                disabled={editing?.id === currentUserId}
                onChange={event => setForm({ ...form, active: event.target.checked })}
                type="checkbox"
              />
              เปิดใช้งานบัญชี
            </label>
            <div className="modal-actions">
              <button onClick={() => setShowForm(false)} type="button">ยกเลิก</button>
              <button className="primary-button" disabled={working} type="submit">{working ? "กำลังบันทึก…" : "บันทึกผู้ใช้งาน"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
