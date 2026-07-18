import { describe, expect, it } from "vitest";
import { exportVolumeText, parseNovelBackup } from "./backup";

describe("novel exports", () => {
  it("sorts saved chapters and excludes blank content", () => {
    const text = exportVolumeText([
      { chapterNumber: 10, content: "第十章内容" },
      { chapterNumber: 2, content: "第二章内容" },
      { chapterNumber: 3, content: "" },
    ]);
    expect(text.indexOf("第2章")).toBeLessThan(text.indexOf("第10章"));
    expect(text).not.toContain("第3章");
  });

  it("rejects malformed backup JSON", () => {
    expect(() => parseNovelBackup('{"format":"other"}')).toThrow("备份文件");
  });
});
