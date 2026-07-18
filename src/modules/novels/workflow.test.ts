import { describe, expect, it } from "vitest";
import { buildPromptContext } from "./prompts";

const workspace = {
  novel: { referenceTitle: "参考书", referenceSummary: "参考简介", selectedTopic: "已选选题", firstVolumeOutline: "第一卷大纲" },
  templates: [
    { key: "topics", template: "创作三个选题" },
    { key: "volumes", template: "创作分卷大纲" },
    { key: "units", template: "细化当前十章" },
    { key: "outlines", template: "创作十章分章大纲" },
    { key: "drafts", template: "创作当前章正文" },
  ],
  steps: [{ key: "settings", content: "核心设定" }],
  storyUnits: [{ startChapter: 1, content: "1-10单元" }, { startChapter: 21, content: "21-30单元" }, { startChapter: 51, content: "51-60单元" }],
  chapterOutlines: [{ chapterNumber: 1, content: "第一章大纲" }, { chapterNumber: 2, content: "第二章大纲" }, { chapterNumber: 60, content: "第六十章大纲" }],
  chapters: [{ chapterNumber: 1, content: "上一章内容" }, { chapterNumber: 59, content: "第五十九章" }],
};

describe("buildPromptContext", () => {
  it("builds topics from automatic context and creative instructions", () => expect(buildPromptContext(workspace, { step: "topics" }).prompt).toContain("【参考书名】\n参考书"));
  it("marks a missing selected topic", () => expect(buildPromptContext({ ...workspace, novel: { ...workspace.novel, selectedTopic: "" } }, { step: "volumes" }).missing).toContain("已选选题"));
  it("uses no previous body for chapter one", () => expect(buildPromptContext(workspace, { step: "drafts", chapter: 1 }).prompt).not.toContain("上一章内容"));
  it("uses chapter one for chapter two", () => expect(buildPromptContext(workspace, { step: "drafts", chapter: 2 }).prompt).toContain("上一章内容"));
  it("uses the 51-60 unit for chapter 60", () => expect(buildPromptContext(workspace, { step: "drafts", chapter: 60 }).prompt).toContain("51-60单元"));
  it("renders the saved volume outline and selected 21-30 batch", () => {
    expect(buildPromptContext(workspace, { step: "units", rangeStart: 21 }).prompt).toContain("【本卷大纲】\n第一卷大纲");
  });
  it("renders the selected 51-60 batch", () => {
    expect(buildPromptContext(workspace, { step: "units", rangeStart: 51 }).prompt).toContain("51-60");
  });
  it("prefers the selected ten-chapter batch over the draft chapter state", () => {
    const result = buildPromptContext(workspace, { step: "units", rangeStart: 11, chapter: 1 });
    expect(result.prompt).toContain("【当前十章范围】\n第11-20章");
    expect(result.prompt).not.toContain("【当前十章范围】\n第1-10章");
  });
  it("uses the current ten-chapter story unit for outlines", () => {
    expect(buildPromptContext(workspace, { step: "outlines", rangeStart: 21 }).prompt).toContain("【当前十章剧情单元】\n21-30单元");
  });
});
