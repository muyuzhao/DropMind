import { describe, expect, it } from "vitest";
import { buildWorkflowProgress, formatWorkPosition, nextWorkPosition, normalizeWorkPosition } from "./work-state";

describe("novel work state", () => {
  it("moves between batches and chapters without crossing the last item", () => {
    expect(nextWorkPosition({ step: "units", rangeStart: 1, chapter: 1 })).toMatchObject({ rangeStart: 11 });
    expect(nextWorkPosition({ step: "outlines", rangeStart: 51, chapter: 1 })).toBeNull();
    expect(nextWorkPosition({ step: "drafts", rangeStart: 1, chapter: 18 })).toMatchObject({ chapter: 19 });
    expect(nextWorkPosition({ step: "drafts", rangeStart: 1, chapter: 60 })).toBeNull();
  });

  it("normalizes invalid saved positions and formats the continue label", () => {
    expect(normalizeWorkPosition({ step: "drafts", rangeStart: 12, chapter: 99 })).toEqual({ step: "drafts", rangeStart: 1, chapter: 1 });
    expect(formatWorkPosition({ step: "outlines", rangeStart: 21, chapter: 1 })).toBe("继续第5步 · 21-30章");
    expect(formatWorkPosition({ step: "drafts", rangeStart: 1, chapter: 18 })).toBe("继续第6步 · 第18章");
  });

  it("counts outline progress by ten-chapter batch instead of duplicated rows", () => {
    const outlines = Array.from({ length: 20 }, (_, index) => ({ chapterNumber: index + 1, content: "大纲", isDraft: 0 }));
    const progress = buildWorkflowProgress({
      novel: { selectedTopic: "选题" },
      steps: [{ key: "volumes", content: "分卷", isDraft: 0 }, { key: "settings", content: "设定", isDraft: 0 }],
      storyUnits: [{ startChapter: 1, content: "单元", isDraft: 0 }, { startChapter: 11, content: "", isDraft: 0 }],
      chapterOutlines: outlines,
      chapters: [{ chapterNumber: 1, content: "正文", isDraft: 0 }, { chapterNumber: 2, content: "草稿", isDraft: 1 }],
    });

    expect(progress.units).toEqual({ completed: 1, total: 6 });
    expect(progress.outlines).toEqual({ completed: 2, total: 6 });
    expect(progress.drafts).toEqual({ completed: 1, total: 60 });
  });
});
