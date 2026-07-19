import { describe, expect, it } from "vitest";
import { createNovelSchema, importCodexChapterSchema, saveChapterSchema, saveWorkPositionSchema } from "./schemas";

describe("novel input schemas", () => {
  it("trims new novel fields", () => {
    expect(createNovelSchema.parse({ name: "  新书  ", referenceTitle: "参考", referenceSummary: "简介" }).name).toBe("新书");
  });
  it("rejects chapters after 60", () => {
    expect(() => saveChapterSchema.parse({ novelId: "x", chapterNumber: 61, content: "正文", status: "saved", draft: false })).toThrow();
  });
  it("accepts valid saved work positions and rejects invalid ranges", () => {
    expect(saveWorkPositionSchema.parse({ novelId: "x", currentStep: "outlines", currentRangeStart: 21, currentChapter: 18 })).toMatchObject({ currentRangeStart: 21 });
    expect(() => saveWorkPositionSchema.parse({ novelId: "x", currentStep: "outlines", currentRangeStart: 12, currentChapter: 18 })).toThrow();
  });

  it("accepts only real ten-chapter batch starts", async () => {
    const { saveUnitSchema } = await import("./schemas");
    expect(saveUnitSchema.safeParse({ novelId: "n1", startChapter: 51, content: "内容", draft: false }).success).toBe(true);
    expect(saveUnitSchema.safeParse({ novelId: "n1", startChapter: 56, content: "内容", draft: false }).success).toBe(false);
  });

  it("returns a readable error when a chapter timestamp is invalid", () => {
    const result = importCodexChapterSchema.safeParse({
      novelId: "n1",
      chapterNumber: 1,
      expectedUpdatedAt: Number.NaN,
      expectedDatabaseTitle: "标题",
      expectedDatabaseContent: "正文",
      expectedFileTitle: "标题",
      expectedFileContent: "正文",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("章节更新时间无效，请重新读取正文");
  });
});
