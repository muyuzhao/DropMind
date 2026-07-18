import { describe, expect, it } from "vitest";
import { TEN_CHAPTER_RANGES, rangeForChapter } from "./ranges";

describe("chapter ranges", () => {
  it("creates six ten-chapter ranges", () => expect(TEN_CHAPTER_RANGES).toHaveLength(6));
  it.each([
    [1, 1, 10], [10, 1, 10], [11, 11, 20], [30, 21, 30], [51, 51, 60], [60, 51, 60],
  ])("maps chapter %i to %i-%i", (chapter, start, end) => {
    expect(rangeForChapter(chapter)).toEqual({ start, end });
  });
  it("rejects an out-of-range chapter", () => expect(() => rangeForChapter(61)).toThrow("1-60"));
});
