import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "DropMind",
  description: "本地小说创作工作台。",
};

const navItems = [
  ["小说", "/novels"],
  ["新建小说", "/novels/new"],
  ["提示词方案", "/novels/prompts"],
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/novels" aria-label="DropMind 小说工作台">
              <span className="brand-mark">D</span>
              <span>DropMind</span>
            </Link>
            <nav aria-label="主导航">
              {navItems.map(([label, href]) => (
                <Link href={href} key={href}>{label}</Link>
              ))}
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
