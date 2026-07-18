import { describe, expect, it } from "vitest";
import { createNovelBackup, exportVolumeText, parseNovelBackup } from "./backup";

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

  it("keeps old version-one backups compatible by defaulting history to empty", () => {
    const workspace = {
      novel: { name: "旧备份", referenceTitle: "参考", referenceSummary: "简介", selectedTopic: "", firstVolumeOutline: "", currentStep: "topics", currentRangeStart: 1, currentChapter: 1 },
      templates: ["topics", "volumes", "settings", "units", "outlines", "drafts"].map((key) => ({ key, template: key })),
      steps: [], storyUnits: [], chapterOutlines: [], chapters: [],
    };
    const json = JSON.stringify({ format: "dropmind-novel", version: 1, exportedAt: new Date().toISOString(), workspace });
    expect(parseNovelBackup(json).workspace.contentVersions).toEqual([]);
  });

  it("exports content history in JSON backups", () => {
    const backup = JSON.parse(createNovelBackup({
      novel: { name: "新备份", referenceTitle: "参考", referenceSummary: "简介", selectedTopic: "", firstVolumeOutline: "", currentStep: "topics", currentRangeStart: 1, currentChapter: 1 },
      templates: ["topics", "volumes", "settings", "units", "outlines", "drafts"].map((key) => ({ key, template: key })),
      steps: [], storyUnits: [], chapterOutlines: [], chapters: [],
      contentVersions: [{ contentType: "chapter", contentKey: "1", content: "旧正文", createdAt: 1 }],
    }));
    expect(backup.workspace.contentVersions).toHaveLength(1);
  });
});
