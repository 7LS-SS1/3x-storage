"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Eye,
  Film,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  ImageUp,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Role = "SYSTEM" | "ADMIN" | "STAFF";

type Category = {
  id: string;
  name: string;
  active: boolean;
};

type AllowedDomain = {
  id: string;
  hostname: string;
  includeSubdomains: boolean;
  active?: boolean;
};

type VideoItem = {
  id: string;
  publicId: string;
  title: string;
  category: { id: string; name: string } | null;
  allowedDomains: AllowedDomain[];
  status: string;
  durationSeconds: number | null;
  playCount: string;
  fileSizeBytes: string | null;
  mimeType: string | null;
  originalFilename: string | null;
  uploadedAt: string;
  uploadedBy: { id: string; name: string; email: string };
  processingError: string | null;
  previewAvailable: boolean;
  embedUrl: string | null;
  posterAvailable: boolean;
};

type VideoResponse = {
  data: VideoItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

const statusLabels: Record<string, string> = {
  UPLOADING: "กำลังอัปโหลด",
  UPLOADED: "อัปโหลดแล้ว",
  INSPECTING: "กำลังตรวจสอบ",
  PROCESSING: "กำลังประมวลผล",
  READY: "พร้อมใช้งาน",
  UNPLAYABLE: "ไม่รองรับการเล่น",
  FAILED: "ล้มเหลว",
  DELETING: "กำลังลบ"
};

const pageSizes = [10, 20, 30, 50, 100];

function formatBytes(value: string | null) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(value: number | null) {
  if (value === null) return "—";
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(new Date(value));
}

function paginationItems(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const candidates = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...candidates].filter(value => value >= 1 && value <= total).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];
    if (previous && value - previous > 1) result.push("ellipsis");
    result.push(value);
  });
  return result;
}

export function VideoLibraryClient({ role }: { role: Role }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [response, setResponse] = useState<VideoResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allowedDomains, setAllowedDomains] = useState<AllowedDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState<VideoItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editDomains, setEditDomains] = useState<Set<string>>(new Set());
  const [editPoster, setEditPoster] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    url: string;
    mimeType: string;
    posterUrl: string | null;
  } | null>(null);

  const queryString = searchParams.toString();
  const page = Number(searchParams.get("page") || 1);
  const pageSize = Number(searchParams.get("pageSize") || 20);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [videos, categoryResult, domainResult] = await Promise.all([
        apiRequest<VideoResponse>(`/videos?${queryString}`),
        apiRequest<{ categories: Category[] }>("/categories"),
        role === "STAFF"
          ? Promise.resolve({ domains: [] as AllowedDomain[] })
          : apiRequest<{ domains: AllowedDomain[] }>("/domains?active=true")
      ]);
      setResponse(videos);
      setCategories(categoryResult.categories.filter(category => category.active));
      setAllowedDomains(domainResult.domains.filter(domain => domain.active !== false));
      setSelected(new Set());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "ไม่สามารถโหลดคลังวิดีโอได้");
    } finally {
      setLoading(false);
    }
  }, [queryString, role]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateQuery(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === "all") params.delete(key);
      else params.set(key, value);
    }
    if (!("page" in changes)) params.set("page", "1");
    router.replace(`/videos?${params.toString()}`);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateQuery({ search: search.trim() || null });
  }

  function toggleAll() {
    const currentIds = response?.data.map(video => video.id) || [];
    setSelected(current =>
      currentIds.every(id => current.has(id)) ? new Set() : new Set(currentIds)
    );
  }

  function toggleOne(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyEmbed(video: VideoItem) {
    if (!video.embedUrl) {
      setError("ยังไม่ได้ตั้งค่า PLAYER_URL");
      return;
    }
    const snippet = `<iframe src="${video.embedUrl}" width="100%" height="100%" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
    try {
      await navigator.clipboard.writeText(snippet);
      setNotice(`คัดลอก iframe ของ “${video.title}” แล้ว`);
      window.setTimeout(() => setNotice(""), 3000);
    } catch {
      setError("เบราว์เซอร์ไม่อนุญาตให้คัดลอก กรุณาตรวจสิทธิ์ Clipboard");
    }
  }

  async function showPreview(video: VideoItem) {
    setWorking(true);
    setError("");
    try {
      const result = await apiRequest<{
        preview: { title: string; url: string; mimeType: string; posterUrl: string | null };
      }>(`/videos/${video.id}/admin-preview-token`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setPreview(result.preview);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "เปิดตัวอย่างไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  function openEdit(video: VideoItem) {
    setEditing(video);
    setEditTitle(video.title);
    setEditCategory(video.category?.id || "");
    setEditDomains(new Set(video.allowedDomains.map(domain => domain.id)));
    setEditPoster(null);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setWorking(true);
    setError("");
    try {
      await apiRequest(`/videos/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editTitle.trim(),
          categoryId: editCategory || null,
          ...(role !== "STAFF" ? { allowedDomainIds: [...editDomains] } : {})
        })
      });
      if (editPoster) {
        const form = new FormData();
        form.set("poster", editPoster);
        await apiRequest(`/videos/${editing.id}/poster`, { method: "POST", body: form });
      }
      setEditing(null);
      setNotice("บันทึกข้อมูลวิดีโอแล้ว");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึกไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  async function deleteVideo(video: VideoItem) {
    if (!window.confirm(`ลบ “${video.title}” และไฟล์ที่เกี่ยวข้องจากพื้นที่จัดเก็บหรือไม่?`)) return;
    setWorking(true);
    setError("");
    try {
      await apiRequest(`/videos/${video.id}`, { method: "DELETE" });
      setNotice("ลบวิดีโอแล้ว");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "ลบวิดีโอไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  async function applyBulkCategory() {
    if (!selected.size) return;
    setWorking(true);
    setError("");
    try {
      const result = await apiRequest<{ successCount: number; failureCount: number }>(
        "/videos/bulk/category",
        {
          method: "POST",
          body: JSON.stringify({
            videoIds: [...selected],
            categoryId: bulkCategory || null
          })
        }
      );
      setNotice(`เปลี่ยนหมวดหมู่สำเร็จ ${result.successCount} รายการ`);
      await load();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "แก้ไขหลายรายการไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  async function bulkDelete() {
    if (!selected.size || !window.confirm(`ลบวิดีโอ ${selected.size} รายการและไฟล์ทั้งหมดหรือไม่?`)) return;
    setWorking(true);
    setError("");
    try {
      const result = await apiRequest<{
        successCount: number;
        failureCount: number;
      }>("/videos/bulk/delete", {
        method: "POST",
        body: JSON.stringify({ videoIds: [...selected] })
      });
      setNotice(
        `ลบสำเร็จ ${result.successCount} รายการ${
          result.failureCount ? ` • ไม่สำเร็จ ${result.failureCount} รายการ` : ""
        }`
      );
      await load();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "ลบหลายรายการไม่สำเร็จ");
    } finally {
      setWorking(false);
    }
  }

  const allSelected = useMemo(
    () =>
      Boolean(response?.data.length) &&
      response!.data.every(video => selected.has(video.id)),
    [response, selected]
  );

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">VIDEO LIBRARY / คลังส่วนกลาง</span>
          <h1>คลังวิดีโอ</h1>
          <p>ค้นหา จัดหมวดหมู่ แสดงตัวอย่าง และควบคุมไฟล์วิดีโอทั้งหมด</p>
        </div>
        <div className="header-actions">
          <button className="icon" onClick={() => void load()} title="โหลดใหม่" type="button">
            <RefreshCw />
          </button>
          <Link className="primary action-link" href="/upload"><Upload />อัปโหลดวิดีโอ</Link>
        </div>
      </header>

      {notice && <div className="notice success-notice"><Check />{notice}</div>}
      {error && <div className="notice error-notice"><X />{error}</div>}

      <section className="panel library-panel">
        <div className="library-toolbar">
          <form className="search-box" onSubmit={submitSearch}>
            <Search />
            <input
              aria-label="ค้นหาชื่อวิดีโอ"
              onChange={event => setSearch(event.target.value)}
              placeholder="ค้นหาชื่อวิดีโอ…"
              value={search}
            />
            <button type="submit">ค้นหา</button>
          </form>
          <select
            aria-label="กรองตามหมวดหมู่"
            onChange={event => updateQuery({ categoryId: event.target.value })}
            value={searchParams.get("categoryId") || "all"}
          >
            <option value="all">ทุกหมวดหมู่</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          <select
            aria-label="กรองตามสถานะ"
            onChange={event => updateQuery({ status: event.target.value })}
            value={searchParams.get("status") || "all"}
          >
            <option value="all">ทุกสถานะ</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="เรียงลำดับ"
            onChange={event => updateQuery({ sort: event.target.value })}
            value={searchParams.get("sort") || "newest"}
          >
            <option value="newest">อัปโหลดล่าสุด</option>
            <option value="oldest">อัปโหลดเก่าสุด</option>
            <option value="title_asc">ชื่อ ก–ฮ</option>
            <option value="title_desc">ชื่อ ฮ–ก</option>
            <option value="duration_desc">ระยะเวลามากสุด</option>
            <option value="plays_desc">เล่นมากสุด</option>
          </select>
        </div>

        {selected.size > 0 && (
          <div className="bulk-bar">
            <strong>เลือกแล้ว {selected.size} รายการ</strong>
            <select
              aria-label="หมวดหมู่ใหม่"
              onChange={event => setBulkCategory(event.target.value)}
              value={bulkCategory}
            >
              <option value="">ไม่มีหมวดหมู่</option>
              {categories.map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            <button disabled={working} onClick={applyBulkCategory} type="button">
              เปลี่ยนหมวดหมู่
            </button>
            <button className="danger-button" disabled={working} onClick={bulkDelete} type="button">
              <Trash2 />ลบที่เลือก
            </button>
            <button className="icon-button" onClick={() => setSelected(new Set())} type="button">
              <X />
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading-state"><span className="spinner" />กำลังโหลดคลังวิดีโอ…</div>
        ) : response?.data.length ? (
          <>
            <div className="library-table-wrap">
              <table className="library-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        aria-label="เลือกวิดีโอทั้งหมดในหน้านี้"
                        checked={allSelected}
                        onChange={toggleAll}
                        type="checkbox"
                      />
                    </th>
                    <th>ชื่อวิดีโอ</th>
                    <th>หมวดหมู่</th>
                    <th>ระยะเวลา</th>
                    <th>จำนวนการเล่น</th>
                    <th>สถานะ</th>
                    <th>วันที่อัปโหลด</th>
                    <th>ผู้อัปโหลด</th>
                    <th>การจัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {response.data.map(video => (
                    <tr key={video.id}>
                      <td>
                        <input
                          aria-label={`เลือก ${video.title}`}
                          checked={selected.has(video.id)}
                          onChange={() => toggleOne(video.id)}
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <div className="library-title">
                          <span className="mini-thumb"><Film /></span>
                          <span>
                            <strong>{video.title}</strong>
                            <small>{video.originalFilename || "ไม่มีชื่อไฟล์"} • {formatBytes(video.fileSizeBytes)}</small>
                          </span>
                        </div>
                      </td>
                      <td>{video.category?.name || "—"}</td>
                      <td>{formatDuration(video.durationSeconds)}</td>
                      <td>{new Intl.NumberFormat("th-TH").format(BigInt(video.playCount))}</td>
                      <td>
                        <span className={`status-pill status-${video.status.toLowerCase()}`}>
                          <i />{statusLabels[video.status] || video.status}
                        </span>
                        {video.processingError && (
                          <small className="row-error" title={video.processingError}>
                            {video.processingError}
                          </small>
                        )}
                      </td>
                      <td>{formatDate(video.uploadedAt)}</td>
                      <td>
                        {video.uploadedBy.name}
                        <small className="cell-subtitle">{video.uploadedBy.email}</small>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button onClick={() => void copyEmbed(video)} title="คัดลอก iframe" type="button">
                            <Clipboard /><span>คัดลอก</span>
                          </button>
                          <button
                            disabled={!video.previewAvailable || working}
                            onClick={() => void showPreview(video)}
                            title="แสดงตัวอย่าง"
                            type="button"
                          >
                            <Eye /><span>แสดง</span>
                          </button>
                          <button onClick={() => openEdit(video)} title="แก้ไข" type="button">
                            <Pencil /><span>แก้ไข</span>
                          </button>
                          <button
                            className="danger-action"
                            disabled={working}
                            onClick={() => void deleteVideo(video)}
                            title="ลบ"
                            type="button"
                          >
                            <Trash2 /><span>ลบ</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-bar">
              <span>
                แสดง {(response.pagination.page - 1) * response.pagination.pageSize + 1}–
                {Math.min(
                  response.pagination.page * response.pagination.pageSize,
                  response.pagination.total
                )} จาก {response.pagination.total} รายการ
              </span>
              <div className="pagination-controls">
                <button
                  disabled={page <= 1}
                  onClick={() => updateQuery({ page: String(page - 1) })}
                  type="button"
                >
                  <ChevronLeft />
                </button>
                {paginationItems(response.pagination.page, response.pagination.totalPages).map(
                  (item, index) =>
                    item === "ellipsis" ? (
                      <span key={`ellipsis-${index}`}>…</span>
                    ) : (
                      <button
                        className={item === response.pagination.page ? "current" : ""}
                        key={item}
                        onClick={() => updateQuery({ page: String(item) })}
                        type="button"
                      >
                        {item}
                      </button>
                    )
                )}
                <button
                  disabled={page >= response.pagination.totalPages}
                  onClick={() => updateQuery({ page: String(page + 1) })}
                  type="button"
                >
                  <ChevronRight />
                </button>
              </div>
              <label>
                ต่อหน้า
                <select
                  onChange={event =>
                    updateQuery({ pageSize: event.target.value, page: "1" })
                  }
                  value={pageSize}
                >
                  {pageSizes.map(size => <option key={size}>{size}</option>)}
                </select>
              </label>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Film />
            <strong>ไม่พบวิดีโอ</strong>
            <p>ปรับตัวกรองหรืออัปโหลดวิดีโอไฟล์แรกเข้าสู่ระบบ</p>
            <Link className="primary action-link" href="/upload"><Upload />อัปโหลดวิดีโอ</Link>
          </div>
        )}
      </section>

      {editing && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card" onSubmit={saveEdit}>
            <div className="modal-heading">
              <div><span className="section-number">แก้ไขข้อมูล</span><h2>รายละเอียดวิดีโอ</h2></div>
              <button onClick={() => setEditing(null)} type="button"><X /></button>
            </div>
            <label>ชื่อวิดีโอ
              <input
                maxLength={200}
                onChange={event => setEditTitle(event.target.value)}
                required
                value={editTitle}
              />
            </label>
            <label>หมวดหมู่
              <select onChange={event => setEditCategory(event.target.value)} value={editCategory}>
                <option value="">ไม่มีหมวดหมู่</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>รูปหน้าปก
              <span className="poster-upload-field">
                <ImageUp />
                <input
                  accept="image/jpeg,image/png,image/webp"
                  onChange={event => setEditPoster(event.target.files?.[0] || null)}
                  type="file"
                />
                <small>{editPoster ? editPoster.name : editing.posterAvailable ? "มีรูปหน้าปกแล้ว — เลือกไฟล์เพื่อเปลี่ยน" : "JPG, PNG หรือ WebP (สูงสุด 8 MB)"}</small>
              </span>
            </label>
            {role !== "STAFF" && (
              <fieldset className="domain-check-list">
                <legend>โดเมนที่อนุญาตให้เล่นวิดีโอ</legend>
                {allowedDomains.length ? allowedDomains.map(domain => (
                  <label key={domain.id}>
                    <input
                      checked={editDomains.has(domain.id)}
                      onChange={() =>
                        setEditDomains(current => {
                          const next = new Set(current);
                          if (next.has(domain.id)) next.delete(domain.id);
                          else next.add(domain.id);
                          return next;
                        })
                      }
                      type="checkbox"
                    />
                    <span>{domain.hostname}</span>
                    {domain.includeSubdomains && <small>รวม subdomain</small>}
                  </label>
                )) : (
                  <p>ยังไม่มีโดเมนที่เปิดใช้งาน</p>
                )}
              </fieldset>
            )}
            <div className="modal-actions">
              <button onClick={() => setEditing(null)} type="button">ยกเลิก</button>
              <button className="primary-button" disabled={working} type="submit">
                {working ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </form>
        </div>
      )}

      {preview && (
        <div className="modal-backdrop preview-backdrop" role="presentation">
          <div className="modal-card preview-card">
            <div className="modal-heading">
              <div><span className="section-number">ADMIN PREVIEW</span><h2>{preview.title}</h2></div>
              <button onClick={() => setPreview(null)} type="button"><X /></button>
            </div>
            <video controls playsInline poster={preview.posterUrl || undefined} src={preview.url}>
              <source src={preview.url} type={preview.mimeType} />
            </video>
            <p>การแสดงตัวอย่างสำหรับผู้ดูแลระบบจะไม่เพิ่มจำนวนการเล่น</p>
          </div>
        </div>
      )}
    </>
  );
}
