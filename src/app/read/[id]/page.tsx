import Link from "next/link";
import { notFound } from "next/navigation";
import { novelRepository } from "@/modules/novels/repository";

export const dynamic = "force-dynamic";

type ReaderPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chapter?: string | string[] }>;
};

export default async function ReaderPage({ params, searchParams }: ReaderPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const novel = novelRepository.getReadableNovel(id);
  if (!novel || novel.chapters.length === 0) notFound();

  const requested = Array.isArray(query.chapter) ? query.chapter[0] : query.chapter;
  const requestedNumber = Number(requested);
  const chapterIndex = novel.chapters.findIndex((chapter) => chapter.chapterNumber === requestedNumber);
  const currentIndex = chapterIndex >= 0 ? chapterIndex : 0;
  const chapter = novel.chapters[currentIndex];
  const previous = novel.chapters[currentIndex - 1];
  const next = novel.chapters[currentIndex + 1];
  const paragraphs = chapter.content.trim().split(/\n{2,}/).filter(Boolean);

  return <main className="reader-shell reader-book">
    <header className="reader-app-header">
      <Link className="reader-brand" href="/read"><span className="brand-mark">D</span><span>书架</span></Link>
      <span>{novel.name}</span>
    </header>
    <nav className="reader-chapter-nav" aria-label="章节导航">
      {previous ? <Link href={`/read/${id}?chapter=${previous.chapterNumber}`}>← 上一章</Link> : <span>已是第一章</span>}
      <strong>{currentIndex + 1} / {novel.chapters.length}</strong>
      {next ? <Link href={`/read/${id}?chapter=${next.chapterNumber}`}>下一章 →</Link> : <span>已是最后一章</span>}
    </nav>
    <article className="reader-article">
      <header>
        <p>{novel.name} · 第 {chapter.chapterNumber} 章</p>
        <h1>{chapter.title || `第${chapter.chapterNumber}章`}</h1>
      </header>
      <div>{paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
    </article>
    <nav className="reader-chapter-nav reader-bottom-nav" aria-label="底部章节导航">
      {previous ? <Link href={`/read/${id}?chapter=${previous.chapterNumber}`}>← 上一章</Link> : <span />}
      <Link href="/read">返回书架</Link>
      {next ? <Link href={`/read/${id}?chapter=${next.chapterNumber}`}>下一章 →</Link> : <span />}
    </nav>
    <details className="reader-directory">
      <summary>章节目录</summary>
      <div>{novel.chapters.map((item) =>
        <Link className={item.chapterNumber === chapter.chapterNumber ? "active" : ""} href={`/read/${id}?chapter=${item.chapterNumber}`} key={item.chapterNumber}>
          第 {item.chapterNumber} 章　{item.title || "未命名"}
        </Link>)}</div>
    </details>
  </main>;
}
