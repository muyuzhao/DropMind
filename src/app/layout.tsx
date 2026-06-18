import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "DropMind",
  description: "把稍纵即逝的想法放到一个可靠的地方。",
};

const navItems = [
  ["收件箱", "/inbox"],
  ["快速投递", "/capture"],
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/inbox" aria-label="DropMind 首页">
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
