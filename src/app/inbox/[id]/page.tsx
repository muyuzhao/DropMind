import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemActions } from "@/components/inbox/item-actions";
import { getItem } from "@/modules/inbox/service";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const item = await getItem((await params).id);
  if (!item) notFound();

  return (
    <article className="page narrow detail">
      <Link className="back-link" href="/inbox">← 返回收件箱</Link>
      <div className="detail-meta">
        <span>{item.status === "archived" ? "已归档" : "原始内容"}</span>
        <time>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeStyle: "short" }).format(item.createdAt)}</time>
      </div>
      <div className="raw-content">{item.rawContent}</div>
      <ItemActions id={item.id} isFavorite={item.isFavorite} isArchived={item.status === "archived"} />
    </article>
  );
}
