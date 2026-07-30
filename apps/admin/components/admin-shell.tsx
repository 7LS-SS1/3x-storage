"use client";

import {
  Activity,
  Cloud,
  Film,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  Tags,
  Upload,
  Users
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest, csrfToken } from "@/lib/api-client";

type User = {
  id: string;
  email: string;
  name: string;
  role: "SYSTEM" | "ADMIN" | "STAFF";
};

type StorageUsage = {
  usage: {
    usedBytes: string;
    capacityBytes: string | null;
    percent: number | null;
  };
};

const roleLabels = {
  SYSTEM: "ผู้ดูแลระบบสูงสุด",
  ADMIN: "ผู้ดูแลระบบ",
  STAFF: "เจ้าหน้าที่"
};

function formatBytes(value: string | number | bigint) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export function AdminShell({
  user,
  children
}: Readonly<{ user: User; children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [siteName, setSiteName] = useState("สนามคลาวด์");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<StorageUsage>("/storage/summary")
      .then(value => {
        if (active) setStorage(value);
      })
      .catch(() => undefined);
    apiRequest<{ config: { siteName: string } }>("/settings")
      .then(value => {
        if (active) setSiteName(value.config.siteName);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const nav = [
    { href: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard },
    { href: "/videos", label: "คลังวิดีโอ", icon: Film },
    { href: "/upload", label: "อัปโหลด", icon: Upload },
    { href: "/storage", label: "พื้นที่จัดเก็บ", icon: HardDrive }
  ];
  const managementNav = [
    { href: "/categories", label: "หมวดหมู่วิดีโอ", icon: Tags },
    { href: "/users", label: "ผู้ใช้งาน", icon: Users },
    { href: "/domains", label: "โดเมนที่อนุญาต", icon: ShieldCheck },
    { href: "/audit", label: "บันทึกกิจกรรม", icon: Activity },
    ...(user.role === "SYSTEM"
      ? [{ href: "/settings", label: "ตั้งค่าระบบ", icon: Settings }]
      : [])
  ];

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrfToken() || "" }
      });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="logo" href="/dashboard">
          <b>3X</b>
          <span>{siteName}<small>VIDEO COMMAND</small></span>
        </Link>
        <nav aria-label="เมนูหลัก">
          {nav.map(item => {
            const Icon = item.icon;
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
            return (
              <Link className={active ? "active" : ""} href={item.href} key={item.href}>
                <Icon />{item.label}
              </Link>
            );
          })}
          {user.role !== "STAFF" && (
            <>
              <span>การจัดการ</span>
              {managementNav.map(item => {
                const Icon = item.icon;
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    className={active ? "active" : ""}
                    href={item.href}
                    key={item.href}
                  >
                    <Icon />{item.label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>
        <div className="storage-meter">
          <div>
            <Cloud />
            <span>
              พื้นที่จัดเก็บ
              <small>
                {storage
                  ? `${formatBytes(storage.usage.usedBytes)}${
                      storage.usage.capacityBytes
                        ? ` จาก ${formatBytes(storage.usage.capacityBytes)}`
                        : ""
                    }`
                  : "กำลังตรวจสอบ…"}
              </small>
            </span>
          </div>
          <div className="meter">
            <i style={{ width: `${storage?.usage.percent || 0}%` }} />
          </div>
          <b>
            {storage?.usage.percent === null || storage?.usage.percent === undefined
              ? "ไม่ได้กำหนดโควตา"
              : `${storage.usage.percent.toFixed(1)}%`}
          </b>
        </div>
        <div className="profile">
          <div className="avatar">{user.name.trim().slice(0, 1) || "ผ"}</div>
          <span>{user.name}<small>{roleLabels[user.role]}</small></span>
          <button
            aria-label="ออกจากระบบ"
            className="profile-logout"
            disabled={loggingOut}
            onClick={logout}
            type="button"
          >
            <LogOut />
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
