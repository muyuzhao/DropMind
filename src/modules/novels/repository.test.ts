import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { initializeNovelDatabase } from "../../lib/novel-db";
import { createNovelRepository } from "./repository";

describe("novel repository", () => {
  let sqlite: Database.Database;
  let repo: ReturnType<typeof createNovelRepository>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    initializeNovelDatabase(sqlite);
    repo = createNovelRepository(sqlite);
  });

  it("creates a novel and seeds six templates", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    expect(repo.listNovels()[0].name).toBe("测试小说");
    expect(repo.getTemplates(novel.id)).toHaveLength(6);
  });

  it("saves independent chapters and versions formal saves", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.saveChapter(novel.id, 1, "第一章", "saved", false);
    repo.saveChapter(novel.id, 2, "第二章", "saved", false);
    repo.saveChapter(novel.id, 1, "第一章修订", "saved", false);
    const workspace = repo.getNovelWorkspace(novel.id)!;
    expect(workspace.chapters.map((chapter) => chapter.content)).toEqual(["第一章修订", "第二章"]);
    expect(sqlite.prepare("select count(*) count from content_versions").get()).toMatchObject({ count: 1 });
  });

  it("deletes all child records", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.saveChapter(novel.id, 1, "第一章", "saved", false);
    repo.deleteNovel(novel.id);
    expect(repo.listNovels()).toEqual([]);
    expect(sqlite.prepare("select count(*) count from chapters").get()).toMatchObject({ count: 0 });
  });

  it("saves story units as ten-chapter batches", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.saveStoryUnit(novel.id, 21, "21-30章剧情单元", false);
    expect(repo.getNovelWorkspace(novel.id)!.storyUnits[0]).toMatchObject({ startChapter: 21, endChapter: 30 });
  });

  it("remembers the last work position", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.updateNovel(novel.id, { currentStep: "drafts", currentRangeStart: 21, currentChapter: 18 });
    expect(repo.getNovel(novel.id)).toMatchObject({ currentStep: "drafts", currentRangeStart: 21, currentChapter: 18 });
  });

  it("keeps novels live-linked to their selected scheme", () => {
    const scheme = repo.createPromptScheme({ name: "古言版", description: "古言测试" });
    expect(repo.getPromptScheme(scheme.id)!.templates).toHaveLength(6);
    const novel = repo.createNovel({ name: "测试", referenceTitle: "参考", referenceSummary: "简介" }, scheme.id);
    repo.updatePromptSchemeTemplate(scheme.id, "topics", "修改后的模板");
    expect(repo.getNovelWorkspace(novel.id)!.templates.find((row) => row.key === "topics")!.template).toBe("修改后的模板");
    expect(repo.getNovelWorkspace(novel.id)!.promptSource).toMatchObject({ mode: "scheme", schemeId: scheme.id });
  });

  it("can detach to a stable book-specific copy and follow a scheme again", () => {
    const scheme = repo.createPromptScheme({ name: "古言版", description: "" });
    repo.updatePromptSchemeTemplate(scheme.id, "topics", "方案版本一");
    const novel = repo.createNovel({ name: "小说A", referenceTitle: "参考", referenceSummary: "简介" }, scheme.id);
    repo.detachNovelPromptScheme(novel.id);
    repo.updatePromptSchemeTemplate(scheme.id, "topics", "方案版本二");
    expect(repo.getNovelWorkspace(novel.id)!.templates.find((row) => row.key === "topics")!.template).toBe("方案版本一");
    expect(repo.getNovelWorkspace(novel.id)!.promptSource).toMatchObject({ mode: "custom" });
    repo.setNovelPromptScheme(novel.id, scheme.id);
    expect(repo.getNovelWorkspace(novel.id)!.templates.find((row) => row.key === "topics")!.template).toBe("方案版本二");
  });
});
