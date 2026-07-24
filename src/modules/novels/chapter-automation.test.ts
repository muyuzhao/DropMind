import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeNovelDatabase } from "../../lib/novel-db/initialize";
import { syncNovelCodexProject } from "./codex-project";
import { createNovelRepository } from "./repository";
import {
  createChapterAutomationRun,
  importCompletedChapterAutomationRun,
  readChapterAutomationManifest,
  recoverInterruptedChapterAutomationRun,
  requestChapterAutomationControl,
} from "./chapter-automation";

describe("chapter automation", () => {
  let rootDir: string;
  let sqlite: Database.Database;
  let repo: ReturnType<typeof createNovelRepository>;
  let novelId: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dropmind-chapter-automation-"));
    sqlite = new Database(":memory:");
    initializeNovelDatabase(sqlite);
    repo = createNovelRepository(sqlite);
    const novel = repo.createNovel({ name: "正文自动化测试", referenceTitle: "", referenceSummary: "" });
    novelId = String(novel.id);
    repo.updateNovel(novelId, { selectedTopic: "测试选题", firstVolumeOutline: "第一卷大纲" });
    repo.saveStep(novelId, "volumes", "五卷大纲", false);
    repo.saveStep(novelId, "settings", "不可重复塞进节点的核心设定", false);
    repo.saveStoryUnit(novelId, 1, "第1-10章剧情单元", false);
    repo.saveChapterOutlineBatch(novelId, 1, "第1-10章完整分章大纲", false);
    syncNovelCodexProject(repo.getNovelWorkspace(novelId)!, { rootDir });
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function completeRun(runDir: string, content: Record<number, string>) {
    const manifest = readChapterAutomationManifest(runDir);
    manifest.status = "completed";
    for (const node of manifest.nodes) {
      node.status = "completed";
      node.attempts = 1;
      fs.writeFileSync(path.join(runDir, node.outputPath), `<!-- DROPMIND_TITLE: 自动标题${node.chapterNumber} -->\n${content[node.chapterNumber]}`, "utf8");
      if (manifest.version >= 3) {
        fs.writeFileSync(path.join(runDir, manifest.continuityEventsDir!, `第${String(node.chapterNumber).padStart(3, "0")}章.md`), `第${node.chapterNumber}章发生的连续性事件`, "utf8");
        fs.writeFileSync(path.join(runDir, manifest.continuityStatesDir!, `第${String(node.chapterNumber).padStart(3, "0")}章.md`), `# 正文连续性状态\n<!-- DROPMIND_STATE_THROUGH: ${node.chapterNumber} -->\n\n> 截至第${node.chapterNumber}章\n\n- 下一章延续事实${node.chapterNumber}`, "utf8");
      }
    }
    fs.writeFileSync(path.join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }

  it("creates 1-10 serial chapter nodes that point to local material instead of embedding it", () => {
    const workspace = repo.getNovelWorkspace(novelId)!;
    const result = createChapterAutomationRun(workspace, { startChapter: 1, chapterCount: 3 }, { rootDir, now: () => new Date("2026-07-19T05:00:00.000Z") });

    expect(result.manifest.nodes.map((node) => node.chapterNumber)).toEqual([1, 2, 3]);
    expect(fs.existsSync(path.join(result.runDir, "run-pipeline.ps1"))).toBe(true);
    const firstPrompt = fs.readFileSync(path.join(result.runDir, result.manifest.nodes[0].inputPath), "utf8");
    const secondPrompt = fs.readFileSync(path.join(result.runDir, result.manifest.nodes[1].inputPath), "utf8");
    expect(firstPrompt).toContain("../../资料/核心设定.md");
    expect(firstPrompt).toContain("../../资料/分章大纲/第001-010章.md");
    expect(firstPrompt).not.toContain("不可重复塞进节点的核心设定");
    expect(firstPrompt).toContain("inputs/continuity-base.md");
    expect(firstPrompt).toContain("DROPMIND_CHAPTER_EVENT");
    expect(secondPrompt).toContain("outputs/第001章.md");
    expect(fs.readFileSync(path.join(result.runDir, result.manifest.continuityBasePath!), "utf8")).toContain("截至第0章");
    expect(result.manifest.runner.command).toContain(result.runDir);
  });

  it("runs a chapter node through the shared PowerShell runner", () => {
    const result = createChapterAutomationRun(repo.getNovelWorkspace(novelId)!, { startChapter: 1, chapterCount: 1 }, { rootDir });
    requestChapterAutomationControl(result.runDir, "run", { mode: "retry-node", targetNodeId: "chapter-1" });
    const fakeCli = path.join(rootDir, "fake-chapter-codex.cmd");
    fs.writeFileSync(fakeCli, `@echo off\r\nchcp 65001 >nul\r\nset out=\r\n:args\r\nif "%~1"=="" goto ready\r\nif "%~1"=="--output-last-message" set out=%~2\r\nshift\r\ngoto args\r\n:ready\r\n>"%out%" echo ^<!-- DROPMIND_TITLE: 第一章标题 --^>\r\n>>"%out%" echo 这是自动生成的第一章正文。\r\n>>"%out%" echo ^<!-- DROPMIND_CHAPTER_EVENT --^>\r\n>>"%out%" echo event-one\r\n>>"%out%" echo ^<!-- DROPMIND_CONTINUITY --^>\r\n>>"%out%" echo # 正文连续性状态\r\n>>"%out%" echo ^<!-- DROPMIND_STATE_THROUGH: 1 --^>\r\n>>"%out%" echo fact-one\r\nexit /b 0\r\n`, "utf8");

    const executed = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(result.runDir, "run-pipeline.ps1")], {
      cwd: result.runDir,
      env: { ...process.env, CODEX_CLI_PATH: fakeCli },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(executed.status, executed.stderr || executed.stdout).toBe(0);
    const manifest = readChapterAutomationManifest(result.runDir);
    expect(manifest.status).toBe("paused");
    expect(manifest.nodes[0]).toMatchObject({ status: "completed", attempts: 1 });
    expect(fs.readFileSync(path.join(result.runDir, manifest.nodes[0].outputPath), "utf8")).toContain("第一章正文");
    expect(fs.readFileSync(path.join(result.runDir, manifest.continuityPath), "utf8")).toContain("fact-one");
    expect(fs.readFileSync(path.join(result.runDir, manifest.continuityEventsDir!, "第001章.md"), "utf8")).toContain("event-one");
  });

  it("enforces range, previous chapter, prerequisites, and published chapter protection", () => {
    const workspace = repo.getNovelWorkspace(novelId)!;
    expect(() => createChapterAutomationRun(workspace, { startChapter: 1, chapterCount: 11 }, { rootDir })).toThrow("1–10 章");
    expect(() => createChapterAutomationRun(workspace, { startChapter: 2, chapterCount: 1 }, { rootDir })).toThrow("第1章正文");
    repo.saveChapter(novelId, 1, "已发布正文", "published", false);
    expect(() => createChapterAutomationRun(repo.getNovelWorkspace(novelId)!, { startChapter: 1, chapterCount: 1 }, { rootDir })).toThrow("已经发布");
  });

  it("imports all completed chapters atomically, archives overwritten text, and is idempotent", () => {
    repo.saveChapter(novelId, 1, "旧第一章", "saved", false);
    const workspace = repo.getNovelWorkspace(novelId)!;
    const result = createChapterAutomationRun(workspace, { startChapter: 1, chapterCount: 2 }, { rootDir });
    const manifest = completeRun(result.runDir, { 1: "自动生成第一章", 2: "自动生成第二章" });

    const imported = importCompletedChapterAutomationRun(result.runDir, manifest, workspace, repo);
    expect(imported.importedCount).toBe(2);
    const refreshed = repo.getNovelWorkspace(novelId)!;
    expect(refreshed.chapters.find((row) => Number(row.chapterNumber) === 1)?.content).toBe("自动生成第一章");
    expect(refreshed.chapters.find((row) => Number(row.chapterNumber) === 2)?.content).toBe("自动生成第二章");
    expect(refreshed.chapters.find((row) => Number(row.chapterNumber) === 1)?.title).toBe("自动标题1");
    expect(refreshed.continuityState).toMatchObject({ throughChapter: 2, revision: 1, sourceRunId: manifest.runId });
    expect(refreshed.continuityEvents.map((row) => row.chapterNumber)).toEqual([1, 2]);
    expect(refreshed.contentVersions.some((row) => row.contentType === "chapter" && row.contentKey === "1" && row.content === "旧第一章")).toBe(true);
    expect(importCompletedChapterAutomationRun(result.runDir, readChapterAutomationManifest(result.runDir), refreshed, repo).importedCount).toBe(0);
  });

  it("seeds the next task from the last confirmed novel continuity state", () => {
    const first = createChapterAutomationRun(repo.getNovelWorkspace(novelId)!, { startChapter: 1, chapterCount: 1 }, { rootDir });
    const firstManifest = completeRun(first.runDir, { 1: "第一章正文" });
    importCompletedChapterAutomationRun(first.runDir, firstManifest, repo.getNovelWorkspace(novelId)!, repo);
    syncNovelCodexProject(repo.getNovelWorkspace(novelId)!, { rootDir });

    const second = createChapterAutomationRun(repo.getNovelWorkspace(novelId)!, { startChapter: 2, chapterCount: 1 }, { rootDir });
    const base = fs.readFileSync(path.join(second.runDir, second.manifest.continuityBasePath!), "utf8");
    expect(second.manifest.source.continuity).toMatchObject({ throughChapter: 1, source: "current", sourceId: firstManifest.runId });
    expect(base).toContain("下一章延续事实1");
  });

  it("uses imported legacy task records as a one-time migration baseline", () => {
    const legacy = createChapterAutomationRun(repo.getNovelWorkspace(novelId)!, { startChapter: 1, chapterCount: 1 }, { rootDir });
    legacy.manifest.version = 2;
    legacy.manifest.status = "completed";
    legacy.manifest.nodes[0].status = "completed";
    legacy.manifest.nodes[0].imported = true;
    fs.writeFileSync(path.join(legacy.runDir, "manifest.json"), `${JSON.stringify(legacy.manifest, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(legacy.runDir, legacy.manifest.continuityPath), "# 正文连续性记录\n\n- 旧版未解决伏笔", "utf8");
    repo.saveChapter(novelId, 1, "旧版已确认第一章", "saved", false, "旧版标题");
    syncNovelCodexProject(repo.getNovelWorkspace(novelId)!, { rootDir });

    const next = createChapterAutomationRun(repo.getNovelWorkspace(novelId)!, { startChapter: 2, chapterCount: 1 }, { rootDir });
    const base = fs.readFileSync(path.join(next.runDir, next.manifest.continuityBasePath!), "utf8");
    expect(next.manifest.source.continuity).toMatchObject({ throughChapter: 1, source: "legacy-run", sourceId: legacy.manifest.runId });
    expect(base).toContain("旧版未解决伏笔");
    expect(base).toContain("必须结合 ../../正文/");
  });

  it("imports none of the batch when one target chapter changed after task creation", () => {
    const workspace = repo.getNovelWorkspace(novelId)!;
    const result = createChapterAutomationRun(workspace, { startChapter: 1, chapterCount: 2 }, { rootDir });
    const manifest = completeRun(result.runDir, { 1: "第一章批量结果", 2: "第二章批量结果" });
    repo.saveChapter(novelId, 2, "用户刚刚修改的第二章", "saved", false);

    expect(() => importCompletedChapterAutomationRun(result.runDir, manifest, repo.getNovelWorkspace(novelId)!, repo)).toThrow("第2章已在任务创建后被修改");
    const refreshed = repo.getNovelWorkspace(novelId)!;
    expect(refreshed.chapters.some((row) => Number(row.chapterNumber) === 1)).toBe(false);
    expect(refreshed.chapters.find((row) => Number(row.chapterNumber) === 2)?.content).toBe("用户刚刚修改的第二章");
  });

  it("marks results stale and refuses import when source material changes", () => {
    const workspace = repo.getNovelWorkspace(novelId)!;
    const result = createChapterAutomationRun(workspace, { startChapter: 1, chapterCount: 1 }, { rootDir });
    const manifest = completeRun(result.runDir, { 1: "不应导入的正文" });
    repo.saveStep(novelId, "settings", "任务创建后修改的核心设定", false);

    expect(importCompletedChapterAutomationRun(result.runDir, manifest, repo.getNovelWorkspace(novelId)!, repo).importedCount).toBe(0);
    expect(readChapterAutomationManifest(result.runDir).status).toBe("stale");
    expect(repo.getNovelWorkspace(novelId)!.chapters).toHaveLength(0);
  });

  it("writes pause control without overwriting a live manifest and recovers a stopped process", () => {
    const result = createChapterAutomationRun(repo.getNovelWorkspace(novelId)!, { startChapter: 1, chapterCount: 1 }, { rootDir });
    result.manifest.status = "running";
    result.manifest.currentNode = "chapter-1";
    result.manifest.nodes[0].status = "running";
    fs.writeFileSync(path.join(result.runDir, "manifest.json"), `${JSON.stringify(result.manifest, null, 2)}\n`, "utf8");

    requestChapterAutomationControl(result.runDir, "pause");
    expect(readChapterAutomationManifest(result.runDir).status).toBe("running");
    expect(JSON.parse(fs.readFileSync(path.join(result.runDir, "control.json"), "utf8")).action).toBe("pause");
    expect(recoverInterruptedChapterAutomationRun(result.runDir).status).toBe("failed");
  });
});
