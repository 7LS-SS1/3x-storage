import type { Metadata } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import "./security.css";

const thai = Noto_Sans_Thai({ subsets: ["thai"], variable: "--font-thai" });

export const metadata: Metadata = {
  title: "สนามคลาวด์ | ศูนย์จัดการวิดีโอ",
  description: "แพลตฟอร์มจัดเก็บและส่งมอบวิดีโอภายในองค์กรอย่างปลอดภัย"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body className={thai.variable} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
