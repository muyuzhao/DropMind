import { describe, expect, it } from "vitest";
import { createNovelBackup, exportVolumeText, parseNovelBackup } from "./backup";

describe("novel exports", () => {
  it("sorts saved chapters and excludes blank content", () => {
    const text = exportVolumeText([
      { chapterNumber: 10, title: "终局", content: "第十章内容" },
      { chapterNumber: 2, title: "入局", content: "第二章内容" },
      { chapterNumber: 3, content: "" },
    ]);
    expect(text.indexOf("第2章")).toBeLessThan(text.indexOf("第10章"));
    expect(text).toContain("第2章 入局");
    expect(text).not.toContain("第3章");
  });

  it("rejects malformed backup JSON", () => {
    expect(() => parseNovelBackup('{"format":"other"}')).toThrow("备份文件");
  });

  it("keeps old version-one backups compatible by defaulting history to empty", () => {
    const workspace = {
      novel: { name: "旧备份", referenceTitle: "参考", referenceSummary: "简介", selectedTopic: "", firstVolumeOutline: "", currentStep: "topics", currentRangeStart: 1, currentChapter: 1 },
      templates: ["topics", "volumes", "settings", "units", "outlines", "drafts"].map((key) => ({ key, template: key })),
      steps: [], storyUnits: [], chapterOutlines: [], chapters: [{ chapterNumber: 1, content: "旧正文", status: "saved", isDraft: false }],
    };
    const json = JSON.stringify({ format: "dropmind-novel", version: 1, exportedAt: new Date().toISOString(), workspace });
    const parsed = parseNovelBackup(json).workspace;
    expect(parsed.contentVersions).toEqual([]);
    expect(parsed.chapters[0].title).toBe("");
    expect(parsed.templates).toHaveLength(8);
    expect(parsed.templates.find((row) => row.key === "tags")?.template).toContain("作品标签生成指南");
    expect(parsed.templates.find((row) => row.key === "cover")?.template).toContain("比例：3：4");
  });

  it("exports content history in JSON backups", () => {
    const backup = JSON.parse(createNovelBackup({
      novel: { name: "新备份", referenceTitle: "参考", referenceSummary: "简介", selectedTopic: "", firstVolumeOutline: "", currentStep: "topics", currentRangeStart: 1, currentChapter: 1 },
      templates: ["topics", "volumes", "settings", "units", "outlines", "tags", "drafts"].map((key) => ({ key, template: key })),
      steps: [], storyUnits: [], chapterOutlines: [], chapters: [],
      contentVersions: [{ contentType: "chapter", contentKey: "1", content: "旧正文", createdAt: 1 }],
    }));
    expect(backup.workspace.contentVersions).toHaveLength(1);
    expect(backup.workspace.templates.find((row: { key: string }) => row.key === "tags").template).toBe("tags");
  });
});
