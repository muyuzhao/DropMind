import Link from "next/link";

export default function NotFound() {
  return <section className="page narrow empty-state"><span>这条内容不在这里。</span><Link href="/inbox">返回收件箱</Link></section>;
}
