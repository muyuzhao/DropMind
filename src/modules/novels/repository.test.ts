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

  it("creates a novel and seeds all workflow and publishing templates", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    expect(repo.listNovels()[0].name).toBe("测试小说");
    expect(repo.getTemplates(novel.id)).toHaveLength(8);
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
    expect(workspace.templates).toHaveLength(8);
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

  it("stores automated continuity with the chapter transaction and invalidates it after an earlier edit", () => {
    const novel = repo.createNovel({ name: "连续性测试", referenceTitle: "", referenceSummary: "" });
    repo.importAutomatedChapters({
      novelId: novel.id,
      runId: "run-1",
      chapters: [
        { chapterNumber: 1, title: "起章", content: "第一章正文", expectedUpdatedAt: null, expectedDatabaseContent: "", continuitySummary: "第一章事件", continuityState: "# 正文连续性状态\n\n截至第1章：事实一" },
        { chapterNumber: 2, title: "续章", content: "第二章正文", expectedUpdatedAt: null, expectedDatabaseContent: "", continuitySummary: "第二章事件", continuityState: "# 正文连续性状态\n\n截至第2章：事实二" },
      ],
    });
    expect(repo.getNovelWorkspace(novel.id)!.continuityState).toMatchObject({ throughChapter: 2, revision: 1, sourceRunId: "run-1" });

    repo.saveChapter(novel.id, 2, "第二章人工修订", "saved", false, "续章");
    const workspace = repo.getNovelWorkspace(novel.id)!;
    expect(workspace.continuityState).toMatchObject({ throughChapter: 1, revision: 2 });
    expect(workspace.continuityEvents.find((row) => row.chapterNumber === 2)?.invalidatedAt).not.toBeNull();
  });

  it("round-trips continuity state and events through JSON backup", () => {
    const novel = repo.createNovel({ name: "连续性备份", referenceTitle: "", referenceSummary: "" });
    repo.importAutomatedChapters({
      novelId: novel.id,
      runId: "run-backup",
      chapters: [{ chapterNumber: 1, title: "起章", content: "正文", expectedUpdatedAt: null, expectedDatabaseContent: "", continuitySummary: "事件", continuityState: "# 正文连续性状态\n\n截至第1章：状态" }],
    });
    const parsed = parseNovelBackup(createNovelBackup(repo.getNovelWorkspace(novel.id))).workspace;
    const imported = repo.importNovelBackup(parsed);
    const restored = repo.getNovelWorkspace(imported.id)!;
    expect(restored.continuityState).toMatchObject({ throughChapter: 1, sourceRunId: "run-backup" });
    expect(restored.continuityEvents[0]).toMatchObject({ chapterNumber: 1, summary: "事件" });
  });

  it("stores chapter titles and preserves them when only the body changes", () => {
    const novel = repo.createNovel({ name: "测试小说", referenceTitle: "参考书", referenceSummary: "简介" });
    repo.saveChapter(novel.id, 1, "第一版正文", "saved", false, "第1章：夜闯王府");
    repo.saveChapter(novel.id, 1, "第二版正文", "saved", false);

    expect(repo.getNovelWorkspace(novel.id)!.chapters[0]).toMatchObject({ title: "夜闯王府", content: "第二版正文" });
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

    expect(() => repo.importCodexChapter(novel.id, 1, "Codex标题", "Codex正文", previewUpdatedAt, "", "预览时正文")).toThrow("其他窗口更新");
    expect(repo.getNovelWorkspace(novel.id)!.chapters[0].content).toBe("其他窗口修改");
  });

  it("rejects single and batch Codex overwrites of existing chapters", () => {
    const novel = repo.createNovel({ name: "追加保护", referenceTitle: "", referenceSummary: "" });
    repo.saveChapter(novel.id, 1, "已有正文", "saved", false, "已有标题");
    const existing = repo.getNovelWorkspace(novel.id)!.chapters[0];

    expect(() => repo.importCodexChapter(novel.id, 1, "新标题", "新正文", Number(existing.updatedAt), "已有标题", "已有正文"))
      .toThrow("不能覆盖");
    expect(() => repo.importAutomatedChapters({
      novelId: novel.id,
      chapters: [{ chapterNumber: 1, title: "新标题", content: "新正文", expectedUpdatedAt: Number(existing.updatedAt), expectedDatabaseTitle: "已有标题", expectedDatabaseContent: "已有正文" }],
    })).toThrow("不能覆盖已有章节");
    expect(repo.getNovelWorkspace(novel.id)!.chapters[0]).toMatchObject({ title: "已有标题", content: "已有正文" });
  });

  it("imports manual Codex chapter continuity in the same transaction", () => {
    const novel = repo.createNovel({ name: "单章连续性", referenceTitle: "", referenceSummary: "" });
    const state = "# 正文连续性状态\n<!-- DROPMIND_STATE_THROUGH: 1 -->\n\n截至第1章，主角已经入城。";

    repo.importCodexChapter(novel.id, 1, "入城", "第一章正文", null, "", "", {
      runId: "manual-1-test",
      summary: "- 主角抵达城门。",
      state,
    });

    const workspace = repo.getNovelWorkspace(novel.id)!;
    expect(workspace.chapters[0]).toMatchObject({ title: "入城", content: "第一章正文" });
    expect(workspace.continuityEvents[0]).toMatchObject({ chapterNumber: 1, runId: "manual-1-test", summary: "- 主角抵达城门。", invalidatedAt: null });
    expect(workspace.continuityState).toMatchObject({ throughChapter: 1, sourceRunId: "manual-1-test", content: state });
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
    expect(repo.getPromptScheme(scheme.id)!.templates).toHaveLength(8);
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

  it("repairs missing work tag templates and allows prompt management to edit them", () => {
    const novel = repo.createNovel({ name: "测试", referenceTitle: "参考", referenceSummary: "简介" });
    sqlite.prepare("delete from prompt_scheme_templates where scheme_id=? and key='tags'").run("system-default");
    expect(repo.getPromptScheme("system-default")!.templates.find((row) => row.key === "tags")?.template).toContain("作品标签生成指南");
    repo.updatePromptSchemeTemplate("system-default", "tags", "自定义标签提示词");
    expect(repo.getPromptScheme("system-default")!.templates.find((row) => row.key === "tags")?.template).toBe("自定义标签提示词");
    repo.updatePromptSchemeTemplate("system-default", "cover", "自定义封面提示词");
    expect(repo.getPromptScheme("system-default")!.templates.find((row) => row.key === "cover")?.template).toBe("自定义封面提示词");
    repo.detachNovelPromptScheme(novel.id);
    repo.updateTemplate(novel.id, "tags", "本书标签提示词");
    expect(repo.getNovelWorkspace(novel.id)!.templates.find((row) => row.key === "tags")?.template).toBe("本书标签提示词");
  });
});
