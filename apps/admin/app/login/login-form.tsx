"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message || "ไม่สามารถเข้าสู่ระบบได้");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-mark"><span>SC</span></div>
        <div className="eyebrow">SECURE VIDEO OPERATIONS</div>
        <h1>ทุกเฟรม<br/><em>อยู่ในการควบคุม</em></h1>
        <p>ศูนย์จัดเก็บ เผยแพร่ และวิเคราะห์วิดีโอระดับองค์กร — ปลอดภัยตั้งแต่ต้นทางถึงหน้าจอ</p>
        <div className="trust-row"><ShieldCheck size={18}/> เข้ารหัส • จำกัดโดเมน • ตรวจสอบย้อนหลัง</div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-logo">สนามคลาวด์</div>
          <span className="section-number">01 / เข้าสู่ระบบ</span>
          <h2>ยินดีต้อนรับกลับ</h2>
          <p>กรอกข้อมูลบัญชีที่ได้รับจากผู้ดูแลระบบ</p>
          <label htmlFor="email">อีเมล</label>
          <input id="email" name="email" type="email" placeholder="name@company.com" autoComplete="email" maxLength={254} required />
          <label htmlFor="password">รหัสผ่าน</label>
          <div className="password-field"><input id="password" name="password" type="password" placeholder="••••••••••••" autoComplete="current-password" maxLength={1024} required/><LockKeyhole size={18}/></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" disabled={submitting}>{submitting ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"} <ArrowRight size={18}/></button>
          <small>ระบบภายในองค์กรเท่านั้น การใช้งานทั้งหมดจะถูกบันทึก</small>
        </form>
      </section>
    </main>
  );
}
