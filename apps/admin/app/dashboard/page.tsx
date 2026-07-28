import { Activity, ArrowUpRight, Bell, ChevronRight, CirclePlay, Cloud, Film, Gauge, HardDrive, LayoutDashboard, Search, Settings, ShieldCheck, Upload, Users, Video } from "lucide-react";

const videos = [
  { title: "ไฮไลต์การแข่งขัน • รอบชิงชนะเลิศ", category: "การแข่งขัน", size: "1.82 GB", views: "18,420", status: "พร้อมใช้งาน", color: "gold" },
  { title: "บทสัมภาษณ์หลังเกม • สัปดาห์ที่ 24", category: "สัมภาษณ์", size: "864 MB", views: "7,391", status: "พร้อมใช้งาน", color: "green" },
  { title: "เบื้องหลังการฝึกซ้อมทีมชุดใหญ่", category: "เอ็กซ์คลูซีฟ", size: "2.41 GB", views: "5,082", status: "กำลังประมวลผล", color: "blue" },
  { title: "วิเคราะห์แท็กติก • เกมรับสมัยใหม่", category: "วิเคราะห์", size: "1.18 GB", views: "3,677", status: "พร้อมใช้งาน", color: "red" }
];

export default function DashboardPage() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo"><b>SC</b><span>สนามคลาวด์<small>VIDEO COMMAND</small></span></div>
        <nav>
          <a className="active"><LayoutDashboard/>ภาพรวม</a>
          <a><Film/>คลังวิดีโอ <i>128</i></a>
          <a><Upload/>อัปโหลด</a>
          <a><HardDrive/>พื้นที่จัดเก็บ</a>
          <span>การจัดการ</span>
          <a><Users/>ผู้ใช้งาน</a>
          <a><ShieldCheck/>โดเมนที่อนุญาต</a>
          <a><Activity/>บันทึกกิจกรรม</a>
          <a><Settings/>ตั้งค่าระบบ</a>
        </nav>
        <div className="storage-meter">
          <div><Cloud/><span>พื้นที่จัดเก็บ<small>72.4 GB จาก 100 GB</small></span></div>
          <div className="meter"><i/></div>
          <b>72.4%</b>
        </div>
        <div className="profile"><div className="avatar">ก</div><span>กิตติพงศ์ พัฒนชัย<small>ผู้ดูแลระบบ</small></span><ChevronRight/></div>
      </aside>
      <main className="content">
        <header>
          <div><span className="eyebrow">ศูนย์บัญชาการวิดีโอ</span><h1>ภาพรวมระบบ</h1><p>ติดตามสถานะคลังวิดีโอและการส่งมอบคอนเทนต์ของคุณ</p></div>
          <div className="header-actions"><button className="icon"><Search/></button><button className="icon bell"><Bell/><i/></button><button className="primary"><Upload/>อัปโหลดวิดีโอ</button></div>
        </header>
        <section className="ticker"><span><i/> ระบบทำงานปกติ</span><b>LIVE STORAGE</b><p>การใช้งานแบนด์วิดท์วันนี้ <strong>18.6 GB</strong></p><p>คำขอทั้งหมด <strong>42,891</strong></p><p>ความพร้อมใช้งาน <strong>99.99%</strong></p></section>
        <section className="metrics">
          <article><div className="metric-top"><span>วิดีโอทั้งหมด</span><Film/></div><strong>128</strong><p><b>+12</b> จากเดือนที่แล้ว</p><em>01</em></article>
          <article><div className="metric-top"><span>พื้นที่ใช้งาน</span><HardDrive/></div><strong>72.4 <small>GB</small></strong><p>เหลือพื้นที่อีก 27.6 GB</p><em>02</em></article>
          <article><div className="metric-top"><span>ยอดรับชมเดือนนี้</span><CirclePlay/></div><strong>84.2K</strong><p><b>+18.4%</b> เทียบเดือนก่อน</p><em>03</em></article>
          <article><div className="metric-top"><span>แบนด์วิดท์</span><Gauge/></div><strong>246 <small>GB</small></strong><p>อัปเดตล่าสุด 2 นาทีที่แล้ว</p><em>04</em></article>
        </section>
        <section className="dashboard-grid">
          <article className="panel performance">
            <div className="panel-heading"><div><span className="section-number">02 / ประสิทธิภาพ</span><h2>การรับชมใน 7 วันที่ผ่านมา</h2></div><select><option>7 วันล่าสุด</option></select></div>
            <div className="chart">
              <div className="chart-labels"><span>20K</span><span>15K</span><span>10K</span><span>5K</span><span>0</span></div>
              <div className="bars">{[48,62,54,76,65,92,82].map((h,i)=><div key={i}><i style={{height:`${h}%`}}/><span>{["จ.","อ.","พ.","พฤ.","ศ.","ส.","อา."][i]}</span></div>)}</div>
            </div>
          </article>
          <article className="panel health">
            <span className="section-number">03 / สุขภาพระบบ</span><h2>สถานะบริการ</h2>
            {[["API หลัก","ทำงานปกติ"],["ฐานข้อมูล","ทำงานปกติ"],["คิวประมวลผล","2 งาน"],["Cloudflare R2","เชื่อมต่อแล้ว"]].map(([a,b])=><div className="health-row" key={a}><span><i/>{a}</span><b>{b}</b></div>)}
            <button>ดูสถานะโดยละเอียด <ArrowUpRight/></button>
          </article>
        </section>
        <section className="panel recent">
          <div className="panel-heading"><div><span className="section-number">04 / คลังล่าสุด</span><h2>วิดีโอที่เพิ่มล่าสุด</h2></div><a>ดูทั้งหมด <ChevronRight/></a></div>
          <div className="table">
            <div className="tr th"><span>ชื่อวิดีโอ</span><span>หมวดหมู่</span><span>ขนาด</span><span>ยอดรับชม</span><span>สถานะ</span><span/></div>
            {videos.map((v,i)=><div className="tr" key={v.title}><span className="video-title"><div className={`thumb ${v.color}`}><Video/><i>0{i+3}:2{i}</i></div><b>{v.title}<small>เพิ่มเมื่อ {i+1} ชั่วโมงที่แล้ว</small></b></span><span><mark>{v.category}</mark></span><span>{v.size}</span><span>{v.views}</span><span className={v.status.includes("พร้อม")?"ready":"processing"}><i/>{v.status}</span><span>•••</span></div>)}
          </div>
        </section>
      </main>
    </div>
  );
}
