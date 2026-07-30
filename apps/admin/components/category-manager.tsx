"use client";

import {
  FolderPlus,
  Pencil,
  Power,
  RefreshCw,
  Tag,
  Trash2,
  X
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
  videoCount: number;
};

type CategoryForm = {
  name: string;
  slug: string;
  description: string;
  active: boolean;
};

const emptyForm: CategoryForm = {
  name: "",
  slug: "",
  description: "",
  active: true
};

export function CategoryManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CategoryForm>(emptyForm);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ categories: Category[] }>("/categories");
      setCategories(result.categories);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดหมวดหมู่ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(category: Category) {
    setEditing(category);
    setForm({
      name: category.name,
      slug: category.slug,
      description: category.description || "",
      active: category.active
    });
    setShowForm(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      await apiRequest(editing ? `/categories/${editing.id}` : "/categories", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
          description: form.description.trim() || null,
          ...(editing ? { active: form.active } : {})
        })
      });
      setNotice(editing ? "แก้ไขหมวดหมู่แล้ว" : "เพิ่มหมวดหมู่แล้ว");
      setShowForm(false);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "บันทึกหมวดหมู่ไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  async function toggle(category: Category) {
    setWorking(true);
    setError("");
    try {
      await apiRequest(`/categories/${category.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !category.active })
      });
      setNotice(category.active ? "ปิดใช้งานหมวดหมู่แล้ว" : "เปิดใช้งานหมวดหมู่แล้ว");
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "เปลี่ยนสถานะไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  async function remove(category: Category) {
    if (!window.confirm(`ลบหมวดหมู่ “${category.name}” หรือไม่?`)) return;
    setWorking(true);
    setError("");
    try {
      await apiRequest(`/categories/${category.id}`, { method: "DELETE" });
      setNotice("ลบหมวดหมู่แล้ว");
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "ลบหมวดหมู่ไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">CONTENT TAXONOMY</span>
          <h1>จัดการหมวดหมู่</h1>
          <p>สร้างและควบคุมหมวดหมู่ที่ใช้กับคลังวิดีโอและหน้าอัปโหลด</p>
        </div>
        <div className="header-actions">
          <button className="icon" onClick={() => void load()} type="button">
            <RefreshCw />
          </button>
          <button className="primary" onClick={openCreate} type="button">
            <FolderPlus />เพิ่มหมวดหมู่
          </button>
        </div>
      </header>

      {notice && <div className="notice success-notice"><Tag />{notice}</div>}
      {error && <div className="notice error-notice"><X />{error}</div>}

      <section className="panel management-panel">
        {loading ? (
          <div className="loading-state"><i className="spinner" />กำลังโหลดหมวดหมู่…</div>
        ) : categories.length ? (
          <div className="management-table-wrap">
            <table className="management-table">
              <thead>
                <tr>
                  <th>หมวดหมู่</th>
                  <th>Slug</th>
                  <th>วิดีโอ</th>
                  <th>สถานะ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(category => (
                  <tr key={category.id}>
                    <td>
                      <strong>{category.name}</strong>
                      <small>{category.description || "ไม่มีคำอธิบาย"}</small>
                    </td>
                    <td><code>{category.slug}</code></td>
                    <td>{category.videoCount.toLocaleString("th-TH")}</td>
                    <td>
                      <span className={`status-pill ${category.active ? "status-ready" : ""}`}>
                        <i />{category.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button aria-label="แก้ไขหมวดหมู่" onClick={() => openEdit(category)} type="button"><Pencil /></button>
                        <button aria-label="เปลี่ยนสถานะหมวดหมู่" disabled={working} onClick={() => void toggle(category)} type="button"><Power /></button>
                        <button aria-label="ลบหมวดหมู่" className="danger-action" disabled={working || category.videoCount > 0} onClick={() => void remove(category)} type="button"><Trash2 /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Tag />
            <strong>ยังไม่มีหมวดหมู่</strong>
            <p>สร้างหมวดหมู่แรกเพื่อใช้จัดระเบียบคลังวิดีโอ</p>
            <button className="primary-button" onClick={openCreate} type="button"><FolderPlus />เพิ่มหมวดหมู่</button>
          </div>
        )}
      </section>

      {showForm && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card" onSubmit={submit}>
            <div className="modal-heading">
              <div>
                <span className="section-number">{editing ? "EDIT CATEGORY" : "NEW CATEGORY"}</span>
                <h2>{editing ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่"}</h2>
              </div>
              <button onClick={() => setShowForm(false)} type="button"><X /></button>
            </div>
            <label>ชื่อหมวดหมู่
              <input maxLength={100} onChange={event => setForm({ ...form, name: event.target.value })} required value={form.name} />
            </label>
            <label>Slug
              <input maxLength={120} onChange={event => setForm({ ...form, slug: event.target.value })} placeholder="เว้นว่างเพื่อสร้างอัตโนมัติ" value={form.slug} />
            </label>
            <label>คำอธิบาย
              <textarea maxLength={500} onChange={event => setForm({ ...form, description: event.target.value })} rows={4} value={form.description} />
            </label>
            {editing && (
              <label className="check-field">
                <input checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} type="checkbox" />
                เปิดใช้งานหมวดหมู่นี้
              </label>
            )}
            <div className="modal-actions">
              <button onClick={() => setShowForm(false)} type="button">ยกเลิก</button>
              <button className="primary-button" disabled={working} type="submit">{working ? "กำลังบันทึก…" : "บันทึกหมวดหมู่"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
