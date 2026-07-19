export const CHAPTER_TITLE_MAX_LENGTH = 60;
export const CHAPTER_TITLE_MARKER_PREFIX = "<!-- DROPMIND_TITLE:";

function chapterLabel(chapterNumber: number) {
  return String(chapterNumber).padStart(3, "0");
}

export function normalizeChapterTitle(value: string) {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^第\s*[零〇一二三四五六七八九十百千万两\d]+\s*章[\s：:、._-]*/u, "")
    .trim()
    .slice(0, CHAPTER_TITLE_MAX_LENGTH);
}

export function chapterTitleForFile(value: string) {
  const replacements: Record<string, string> = {
    "<": "＜", ">": "＞", ":": "：", '"': "＂", "/": "／",
    "\\": "＼", "|": "｜", "?": "？", "*": "＊",
  };
  return normalizeChapterTitle(value)
    .replace(/[<>:"/\\|?*]/g, (character) => replacements[character])
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[.\s]+$/g, "")
    .trim()
    .slice(0, CHAPTER_TITLE_MAX_LENGTH);
}

export function chapterFileName(chapterNumber: number, title: string) {
  const safeTitle = chapterTitleForFile(title);
  return safeTitle
    ? `第${chapterLabel(chapterNumber)}章__${safeTitle}.md`
    : `第${chapterLabel(chapterNumber)}章.md`;
}

export function parseChapterFileName(fileName: string) {
  const match = fileName.match(/^第(\d{3})章(?:__(.+))?\.md$/u);
  if (!match) return null;
  return { chapterNumber: Number(match[1]), title: normalizeChapterTitle(match[2] ?? "") };
}

export function chapterTitleMarker(title: string) {
  return `${CHAPTER_TITLE_MARKER_PREFIX} ${normalizeChapterTitle(title)} -->`;
}

export function parseGeneratedChapter(value: string, options: { requireTitle?: boolean } = {}) {
  const trimmed = value.trim();
  const match = trimmed.match(/^<!-- DROPMIND_TITLE:\s*(.*?)\s*-->\s*(?:\r?\n)+([\s\S]*)$/u);
  if (!match) {
    if (options.requireTitle) throw new Error("正文输出缺少章节标题标记");
    return { title: "", content: trimmed };
  }
  const title = normalizeChapterTitle(match[1]);
  if (!title) throw new Error("正文输出的章节标题为空");
  return { title, content: match[2].trim() };
}
