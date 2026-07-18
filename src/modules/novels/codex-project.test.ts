import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeNovelDatabase } from "../../lib/novel-db/initialize";
import { createNovelRepository } from "./repository";
import { inspectCodexChapterState, prepareCodexChapterTask, readCodexChapter, syncNovelCodexProject, writeCodexChapter } from "./codex-project";

describe("Codex novel project files", () => {
  let rootDir: string;
  let sqlite: Database.Database;
  let repo: ReturnType<typeof createNovelRepository>;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dropmind-codex-project-"));
    sqlite = new Database(":memory:");
    initializeNovelDatabase(sqlite);
    repo = createNovelRepository(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function completeWorkspace() {
    const novel = repo.createNovel({ name: "古言：测试/项目", referenceTitle: "参考书", referenceSummary: "参考简介" });
    repo.updateNovel(novel.id, { selectedTopic: "已选选题", firstVolumeOutline: "第一卷完整大纲" });
    repo.saveStep(novel.id, "volumes", "五卷分卷大纲", false);
    repo.saveStep(novel.id, "settings", "核心世界观与人物设定", false);
    repo.saveStoryUnit(novel.id, 1, "第1-10章剧情单元", false);
    repo.saveChapterOutline(novel.id, 2, "第1-10章详细分章大纲，包含第2章", false);
    repo.saveChapter(novel.id, 1, "第一章正文", "saved", false);
    return repo.getNovelWorkspace(novel.id)!;
  }

  it("exports workbench material and prepares a short Codex task", () => {
    const workspace = completeWorkspace();
    const result = prepareCodexChapterTask(workspace, 2, { rootDir });

    expect(result.folderName).toMatch(/^古言：测试-项目-/);
    expect(result.folderName).not.toContain("/");
    const bookInfo = fs.readFileSync(path.join(result.projectDir, "资料", "作品信息.md"), "utf8");
    expect(bookInfo).toContain("小说名称：古言：测试/项目");
    expect(bookInfo).not.toContain("参考书名");
    expect(bookInfo).not.toContain("参考简介");
    expect(fs.readFileSync(path.join(result.projectDir, "资料", "核心设定.md"), "utf8")).toContain("核心世界观与人物设定");
    expect(fs.readFileSync(path.join(result.projectDir, "资料", "剧情单元", "第001-010章.md"), "utf8")).toContain("第1-10章剧情单元");
    expect(fs.readFileSync(result.taskPath, "utf8")).toContain("正文/第001章.md");
    expect(fs.readFileSync(result.taskPath, "utf8")).toContain("正文/第002章.md");
    expect(result.command).toBe("执行当前任务");
    expect(inspectCodexChapterState(workspace, 2, { rootDir })).toMatchObject({ phase: "task_ready", taskChapter: 2, fileExists: false });
  });

  it("preserves a Codex-written body during material sync and supports explicit import/export", () => {
    const workspace = completeWorkspace();
    const info = syncNovelCodexProject(workspace, { rootDir });
    const bodyPath = path.join(info.projectDir, "正文", "第001章.md");
    fs.writeFileSync(bodyPath, "Codex新正文", "utf8");

    syncNovelCodexProject(workspace, { rootDir });
    expect(inspectCodexChapterState(workspace, 1, { rootDir }).phase).toBe("file_ready");
    expect(readCodexChapter(workspace, 1, { rootDir }).content).toBe("Codex新正文");

    repo.saveChapter(String(workspace.novel.id), 1, "工作台保存正文", "saved", false);
    const refreshed = repo.getNovelWorkspace(String(workspace.novel.id))!;
    writeCodexChapter(refreshed, 1, "工作台保存正文", { rootDir });
    expect(fs.readFileSync(bodyPath, "utf8")).toBe("工作台保存正文");
    expect(inspectCodexChapterState(refreshed, 1, { rootDir }).phase).toBe("imported");
  });
});
