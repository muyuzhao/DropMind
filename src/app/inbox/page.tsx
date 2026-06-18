import Link from "next/link";
import { listItems } from "@/modules/inbox/service";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const [items, query] = await Promise.all([listItems(), searchParams]);
  const visibleItems = items.filter((item) => item.status !== "archived");

  return (
    <section className="page">
      {query.saved === "1" && <div className="notice">已稳稳放进收件箱。</div>}
      <div className="page-heading">
        <div>
          <div className="eyebrow">INBOX · {visibleItems.length}</div>
          <h1>待整理的思绪</h1>
          <p className="lede">先捕捉，再慢慢理解。</p>
        </div>
        <Link className="primary-link" href="/capture">＋ 新投递</Link>
      </div>

      {visibleItems.length === 0 ? (
        <div className="empty-state">
          <span>空空如也，挺清爽。</span>
          <p>下一次念头经过时，DropMind 会替你接住它。</p>
          <Link href="/capture">投递第一条内容</Link>
        </div>
      ) : (
        <div className="item-list">
          {visibleItems.map((item) => (
            <Link className="item-card" href={`/inbox/${item.id}`} key={item.id}>
              <div className="item-meta">
                <span>{item.isFavorite ? "★ 收藏" : "未整理"}</span>
                <time>{formatDate(item.createdAt)}</time>
              </div>
              <p>{item.rawContent}</p>
              <span className="open-arrow">↗</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
