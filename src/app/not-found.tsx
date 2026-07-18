import Link from "next/link";

export default function NotFound() {
  return <section className="page narrow empty-state"><span>这个页面不在这里。</span><Link href="/novels">返回小说列表</Link></section>;
}
