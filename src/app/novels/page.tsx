import Link from "next/link";
import type { StepKey } from "@/lib/novel-db/schema";
import { NovelCardActions } from "@/components/novels/novel-card-actions";
import { ImportNovelBackup } from "@/components/novels/import-novel-backup";
import { novelRepository } from "@/modules/novels/repository";
import { NOVEL_RANK_LINKS } from "@/modules/novels/rank-links";
import { formatWorkPosition, normalizeWorkPosition } from "@/modules/novels/work-state";

export const dynamic = "force-dynamic";

export default function NovelsPage() {
  const novels = novelRepository.listNovels();
  return <main className="novel-shell">
    <header className="novel-header"><div><p className="novel-kicker">本地创作工具</p><h1>小说工作台</h1><p>保存提示词，粘贴 Gemini 结果，一步一步写完第一卷。</p></div><div className="novel-header-actions"><ImportNovelBackup /><Link className="novel-primary" href="/novels/prompts">提示词管理</Link><Link className="novel-primary" href="/novels/new">新建小说</Link></div></header>
    <section className="novel-rank-links" aria-label="热门小说榜单">
      {NOVEL_RANK_LINKS.map((item) => <a className="novel-rank-card" href={item.href} target="_blank" rel="noreferrer" key={item.href}>
        <span className="novel-kicker">热门参考</span>
        <h2>{item.title}</h2>
        <p>{item.description}</p>
        <strong>{item.action} ↗</strong>
      </a>)}
    </section>
    {novels.length === 0 ? <section className="novel-empty"><h2>还没有小说</h2><p>从一本爆款小说的书名和简介开始。</p><Link href="/novels/new">创建第一本小说</Link></section> :
      <section className="novel-grid">{novels.map((item) => <article className="novel-card" key={String(item.id)}>
        <p className="novel-kicker">参考：{String(item.referenceTitle)}</p><h2>{String(item.name)}</h2>
        <div className="novel-stats"><span>正文 {Number(item.completedCount)} / 60</span><span>已发布 {Number(item.publishedCount)}</span></div>
        <div className="novel-card-footer"><Link className="novel-primary" href={`/novels/${item.id}`}>{formatWorkPosition(normalizeWorkPosition({ step: String(item.currentStep) as StepKey, rangeStart: Number(item.currentRangeStart), chapter: Number(item.currentChapter) }))}</Link><NovelCardActions novelId={String(item.id)} novelName={String(item.name)} /></div>
      </article>)}</section>}
  </main>;
}
