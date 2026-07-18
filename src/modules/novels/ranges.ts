export const TEN_CHAPTER_RANGES = Array.from({ length: 6 }, (_, index) => ({
  start: index * 10 + 1,
  end: index * 10 + 10,
}));

export function rangeForChapter(chapter: number) {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 60) throw new Error("章节必须在1-60之间");
  return TEN_CHAPTER_RANGES[Math.floor((chapter - 1) / 10)];
}
