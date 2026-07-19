import { describe, expect, it } from "vitest";
import { automationTaskProgress, chapterBatchEnd, maxChapterBatchCount, nextChapterBatchStart } from "./automation-task";

describe("automation task summary", () => {
  it("keeps completion handoff locked until every generated node is imported", () => {
    const running = automationTaskProgress({
      status: "running",
      nodes: [
        { status: "completed", imported: true },
        { status: "running", imported: false },
      ],
    });
    expect(running).toEqual({ total: 2, completed: 1, imported: 1, handoffReady: false });

    const completed = automationTaskProgress({
      status: "completed",
      nodes: [
        { status: "completed", imported: true },
        { status: "completed", imported: true },
      ],
    });
    expect(completed.handoffReady).toBe(true);
  });

  it("offers another chapter batch only before the final chapter", () => {
    expect(nextChapterBatchStart(17)).toBe(18);
    expect(nextChapterBatchStart(60)).toBeNull();
  });

  it("limits the chapter count to the remaining chapters", () => {
    expect(maxChapterBatchCount(1)).toBe(10);
    expect(maxChapterBatchCount(55)).toBe(6);
    expect(maxChapterBatchCount(60)).toBe(1);
    expect(chapterBatchEnd(55, maxChapterBatchCount(55))).toBe(60);
  });
});
