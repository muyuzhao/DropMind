import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { initializeNovelDatabase } from "../../lib/novel-db/initialize";
import { createNovelRepository } from "./repository";
import { createNovelBackup, parseNovelBackup } from "./backup";

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

  it("imports a complete JSON backup as a separate custom novel", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.updateNovel(novel.id, { selectedTopic: "最终选题", firstVolumeOutline: "本卷大纲" });
    repo.saveStep(novel.id, "settings", "核心设定", false);
    repo.saveStoryUnit(novel.id, 1, "剧情单元", false);
    repo.saveChapterOutlineBatch(novel.id, 1, "分章大纲", false);
    repo.saveChapter(novel.id, 1, "第一章", "saved", false);
    repo.saveChapter(novel.id, 1, "第一章修订", "saved", false);
    const backup = parseNovelBackup(createNovelBackup(repo.getNovelWorkspace(novel.id)));

    const imported = repo.importNovelBackup(backup.workspace);
    const workspace = repo.getNovelWorkspace(imported.id)!;

    expect(imported.id).not.toBe(novel.id);
    expect(imported.name).toBe("测试小说（导入）");
    expect(workspace.promptSource).toMatchObject({ mode: "custom" });
    expect(workspace.templates).toHaveLength(6);
    expect(workspace.steps[0].content).toBe("核心设定");
    expect(workspace.storyUnits[0].content).toBe("剧情单元");
    expect(workspace.chapterOutlines).toHaveLength(10);
    expect(workspace.chapters[0].content).toBe("第一章修订");
    expect(workspace.contentVersions).toHaveLength(1);
    expect(workspace.contentVersions[0].content).toBe("第一章");
  });

  it("rolls back the whole backup import when any restored row fails", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.saveChapter(novel.id, 1, "第一章", "saved", false);
    const backup = parseNovelBackup(createNovelBackup(repo.getNovelWorkspace(novel.id)));
    sqlite.exec(`create trigger reject_imported_chapter before insert on chapters
      when NEW.novel_id <> '${novel.id}' begin select raise(abort, 'reject imported chapter'); end`);

    expect(() => repo.importNovelBackup(backup.workspace)).toThrow("reject imported chapter");
    expect(repo.listNovels()).toHaveLength(1);
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

  it("restores versioned content and keeps the replaced content as an undo version", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.saveStoryUnit(novel.id, 1, "剧情单元一", false);
    repo.saveStoryUnit(novel.id, 1, "剧情单元二", false);
    const oldVersion = repo.getNovelWorkspace(novel.id)!.contentVersions.find((row) => row.contentType === "story_unit")!;

    repo.restoreContentVersion(novel.id, oldVersion.id);

    const workspace = repo.getNovelWorkspace(novel.id)!;
    expect(workspace.storyUnits[0].content).toBe("剧情单元一");
    expect(workspace.contentVersions.some((row) => row.content === "剧情单元二")).toBe(true);
  });

  it("versions confirmed fields, outline batches, chapters, steps and custom templates", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.updateNovel(novel.id, { selectedTopic: "选题一" });
    repo.updateNovel(novel.id, { selectedTopic: "选题二" });
    repo.saveStep(novel.id, "settings", "设定一", false);
    repo.saveStep(novel.id, "settings", "设定二", false);
    repo.saveChapterOutlineBatch(novel.id, 1, "大纲一", false);
    repo.saveChapterOutlineBatch(novel.id, 1, "大纲二", false);
    repo.saveChapter(novel.id, 1, "正文一", "saved", false);
    repo.saveChapter(novel.id, 1, "正文二", "saved", false);
    repo.detachNovelPromptScheme(novel.id);
    const template = repo.getNovelWorkspace(novel.id)!.templates.find((row) => row.key === "topics")!.template;
    repo.updateTemplate(novel.id, "topics", `${template}\n定制一`);
    repo.updateTemplate(novel.id, "topics", `${template}\n定制二`);

    expect(new Set(repo.getNovelWorkspace(novel.id)!.contentVersions.map((row) => row.contentType)))
      .toEqual(new Set(["novel_field", "step", "outline_batch", "chapter", "template"]));
  });

  it("changes publication status without creating a duplicate content version", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.saveChapter(novel.id, 1, "第一章", "saved", false);
    repo.updateChapterStatus(novel.id, 1, "published");
    expect(repo.getNovelWorkspace(novel.id)!.chapters[0].status).toBe("published");
    expect(sqlite.prepare("select count(*) count from content_versions").get()).toMatchObject({ count: 0 });
  });

  it("rejects a Codex import when the database changed after preview", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.saveChapter(novel.id, 1, "预览时正文", "saved", false);
    const previewUpdatedAt = Number(repo.getNovelWorkspace(novel.id)!.chapters[0].updatedAt);
    repo.saveChapter(novel.id, 1, "其他窗口修改", "saved", false);

    expect(() => repo.importCodexChapter(novel.id, 1, "Codex正文", previewUpdatedAt, "预览时正文")).toThrow("其他窗口更新");
    expect(repo.getNovelWorkspace(novel.id)!.chapters[0].content).toBe("其他窗口修改");
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

  it("saves a ten-chapter outline batch in one transaction", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.saveChapterOutlineBatch(novel.id, 21, "21-30章分章大纲", false);
    const outlines = repo.getNovelWorkspace(novel.id)!.chapterOutlines;
    expect(outlines).toHaveLength(10);
    expect(outlines.map((row) => row.chapterNumber)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  });

  it("rolls back the complete outline batch when one row fails", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    sqlite.exec(`create trigger reject_chapter_25 before insert on chapter_outlines
      when NEW.chapter_number = 25 begin select raise(abort, 'reject test row'); end`);
    expect(() => repo.saveChapterOutlineBatch(novel.id, 21, "21-30章分章大纲", false)).toThrow("reject test row");
    expect(repo.getNovelWorkspace(novel.id)!.chapterOutlines).toEqual([]);
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
