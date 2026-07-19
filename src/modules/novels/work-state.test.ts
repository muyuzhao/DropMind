import { describe, expect, it } from "vitest";
import { buildWorkflowOverview, buildWorkflowProgress, formatWorkPosition, nextWorkActionLabel, nextWorkPosition, normalizeWorkPosition } from "./work-state";

describe("novel work state", () => {
  it("moves between batches and chapters without crossing the last item", () => {
    expect(nextWorkPosition({ step: "units", rangeStart: 1, chapter: 1 })).toMatchObject({ rangeStart: 11 });
    expect(nextWorkPosition({ step: "topics", rangeStart: 1, chapter: 1 })).toMatchObject({ step: "volumes" });
    expect(nextWorkPosition({ step: "units", rangeStart: 51, chapter: 1 })).toMatchObject({ step: "outlines", rangeStart: 1 });
    expect(nextWorkPosition({ step: "outlines", rangeStart: 51, chapter: 1 })).toMatchObject({ step: "tags", chapter: 1 });
    expect(nextWorkPosition({ step: "tags", rangeStart: 1, chapter: 1 })).toMatchObject({ step: "drafts", chapter: 1 });
    expect(nextWorkPosition({ step: "drafts", rangeStart: 1, chapter: 18 })).toMatchObject({ chapter: 19 });
    expect(nextWorkPosition({ step: "drafts", rangeStart: 1, chapter: 60 })).toBeNull();
    expect(nextWorkActionLabel({ step: "outlines", rangeStart: 51, chapter: 1 })).toBe("保存并进入第6步");
    expect(nextWorkActionLabel({ step: "tags", rangeStart: 1, chapter: 1 })).toBe("保存并进入正文");
  });

  it("normalizes invalid saved positions and formats the continue label", () => {
    expect(normalizeWorkPosition({ step: "drafts", rangeStart: 12, chapter: 99 })).toEqual({ step: "drafts", rangeStart: 1, chapter: 1 });
    expect(formatWorkPosition({ step: "outlines", rangeStart: 21, chapter: 1 })).toBe("继续第5步 · 21-30章");
    expect(formatWorkPosition({ step: "drafts", rangeStart: 1, chapter: 18 })).toBe("继续第7步 · 第18章");
  });

  it("counts outline progress by ten-chapter batch instead of duplicated rows", () => {
    const outlines = Array.from({ length: 20 }, (_, index) => ({ chapterNumber: index + 1, content: "大纲", isDraft: 0 }));
    const progress = buildWorkflowProgress({
      novel: { selectedTopic: "选题", firstVolumeOutline: "本卷" },
      steps: [{ key: "topics", content: "候选选题", isDraft: 0 }, { key: "volumes", content: "分卷", isDraft: 0 }, { key: "settings", content: "设定", isDraft: 0 }],
      storyUnits: [{ startChapter: 1, content: "单元", isDraft: 0 }, { startChapter: 11, content: "", isDraft: 0 }],
      chapterOutlines: outlines,
      chapters: [{ chapterNumber: 1, content: "正文", isDraft: 0 }, { chapterNumber: 2, content: "草稿", isDraft: 1 }],
    });

    expect(progress.units).toEqual({ completed: 1, total: 6 });
    expect(progress.outlines).toEqual({ completed: 2, total: 6 });
    expect(progress.drafts).toEqual({ completed: 1, total: 60 });
    expect(progress.topics).toEqual({ completed: 2, total: 2 });
    expect(progress.volumes).toEqual({ completed: 2, total: 2 });
    expect(progress.tags).toEqual({ completed: 0, total: 1 });
  });

  it("reports why later steps are blocked", () => {
    const overview = buildWorkflowOverview({ novel: {}, steps: [], storyUnits: [], chapterOutlines: [], chapters: [] });
    expect(overview.topics.state).toBe("ready");
    expect(overview.volumes).toMatchObject({ state: "blocked", reason: "先确认最终选题" });
    expect(overview.drafts).toMatchObject({ state: "blocked", reason: "先保存核心设定" });
  });
});
