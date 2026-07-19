import { describe, expect, it } from "vitest";
import { chapterFileName, normalizeChapterTitle, parseChapterFileName, parseGeneratedChapter } from "./chapter-title";

describe("chapter title and filename", () => {
  it("puts the sortable chapter number before a sanitized title", () => {
    expect(chapterFileName(2, "第2章 夜闯王府：谁在门外？"))
      .toBe("第002章__夜闯王府：谁在门外？.md");
    expect(chapterFileName(3, "名单/真相*揭晓"))
      .toBe("第003章__名单／真相＊揭晓.md");
  });

  it("parses titled and legacy chapter filenames", () => {
    expect(parseChapterFileName("第012章__替嫁名单上的死人.md"))
      .toEqual({ chapterNumber: 12, title: "替嫁名单上的死人" });
    expect(parseChapterFileName("第012章.md"))
      .toEqual({ chapterNumber: 12, title: "" });
    expect(parseChapterFileName("随笔.md")).toBeNull();
  });

  it("separates generated title metadata from the pure body", () => {
    expect(parseGeneratedChapter("<!-- DROPMIND_TITLE: 疯王夜闯灵堂 -->\n正文第一段", { requireTitle: true }))
      .toEqual({ title: "疯王夜闯灵堂", content: "正文第一段" });
    expect(() => parseGeneratedChapter("只有正文", { requireTitle: true })).toThrow("缺少章节标题标记");
  });

  it("normalizes chapter prefixes and multiline titles", () => {
    expect(normalizeChapterTitle("第 10 章：\n风雨欲来")).toBe("风雨欲来");
  });
});
