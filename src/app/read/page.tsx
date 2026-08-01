import Link from "next/link";
import { novelRepository } from "@/modules/novels/repository";

export const dynamic = "force-dynamic";

export default function ReaderLibraryPage() {
  const novels = novelRepository.listReadableNovels();

  return <main className="reader-shell reader-library">
    <header className="reader-app-header">
      <Link className="reader-brand" href="/read"><span className="brand-mark">D</span><span>DropMind 阅读</span></Link>
      <span>仅供局域网阅读</span>
    </header>
    <section className="reader-library-content">
      <p className="novel-kicker">我的书架</p>
      <h1>选择一本小说</h1>
      <p className="reader-intro">这里仅显示已有正文的小说，不提供编辑、生成或投递功能。</p>
      {novels.length === 0
        ? <div className="reader-empty"><strong>还没有可阅读的正文</strong><p>请先在电脑工作台中保存章节正文。</p></div>
        : <div className="reader-book-grid">{novels.map((novel) =>
          <Link className="reader-book-card" href={`/read/${novel.id}?chapter=${novel.firstChapter}`} key={novel.id}>
            <span>{novel.chapterCount} 章</span>
            <h2>{novel.name}</h2>
            <p>第 {novel.firstChapter} 章至第 {novel.latestChapter} 章</p>
            <strong>开始阅读 →</strong>
          </Link>)}</div>}
    </section>
  </main>;
}
