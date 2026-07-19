import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeNovelDatabase } from "../../lib/novel-db/initialize";
import { createNovelRepository } from "./repository";
import {
  AUTOMATION_NODE_DEFINITIONS,
  AUTOMATION_RUNNER_VERSION,
  createAutomationRun,
  importCompletedAutomationNodes,
  getLatestAutomationRun,
    readAutomationManifest,
    reconcileAutomationStaleness,
    recoverInterruptedAutomationRun,
    refreshAutomationRunnerFiles,
    seedAutomationRunFromWorkspace,
  requestAutomationControl,
  restartAutomationFromNode,
  validateAutomationOutput,
  type AutomationManifest,
} from "./automation";

function volumeOutput(suffix = "") {
  return [1, 2, 3, 4, 5].map((number) => `## 第${number}卷：卷名${suffix}\n\n- 本卷核心目标：目标${number}\n- 剧情走向：完整内容`).join("\n\n");
}

function outlineOutput(start: number) {
  return Array.from({ length: 10 }, (_, index) => `## 第${start + index}章\n\n【本章核心】事件\n【场景】地点\n【剧情详解】过程\n结尾钩子：悬念`).join("\n\n");
}

describe("Codex automated workflow", () => {
  let sqlite: Database.Database;
  let repo: ReturnType<typeof createNovelRepository>;
  let rootDir: string;
  let novelId: string;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    initializeNovelDatabase(sqlite);
    repo = createNovelRepository(sqlite);
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dropmind-automation-"));
    const novel = repo.createNovel({ name: "自动测试小说", referenceTitle: "参考书", referenceSummary: "参考简介" });
    novelId = String(novel.id);
    repo.updateNovel(novelId, { selectedTopic: "已确认的最终选题" });
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function createRun() {
    return createAutomationRun(repo.getNovelWorkspace(novelId)!, { rootDir, now: () => new Date("2026-07-19T01:02:03.000Z") });
  }

  function saveManifest(runDir: string, manifest: AutomationManifest) {
    fs.writeFileSync(path.join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  function saveManualPlanningPrefix(outlineBatchCount = 2) {
    repo.saveStep(novelId, "volumes", "手工确认的分卷大纲", false);
    repo.saveStep(novelId, "settings", "手工确认的核心设定", false);
    for (const start of [1, 11, 21, 31, 41, 51]) repo.saveStoryUnit(novelId, start, `手工剧情单元 ${start}-${start + 9}`, false);
    for (const start of [1, 11].slice(0, outlineBatchCount)) repo.saveChapterOutlineBatch(novelId, start, `手工分章大纲 ${start}-${start + 9}`, false);
  }

  it("creates an isolated task directory with the exact 14-node order", () => {
    const result = createRun();

    expect(result.manifest.nodes.map((node) => node.id)).toEqual(AUTOMATION_NODE_DEFINITIONS.map((node) => node.id));
    expect(result.manifest.nodes).toHaveLength(14);
    expect(fs.existsSync(path.join(result.runDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, "control.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, "run-pipeline.ps1"))).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, "run-pipeline.cmd"))).toBe(true);
    expect(fs.readFileSync(path.join(result.runDir, "run-pipeline.ps1"), "utf8")).toContain('$NpmNativeCodex.FullName');
    expect(fs.readFileSync(path.join(result.runDir, "run-pipeline.ps1"), "utf8")).toContain('[Console]::InputEncoding = $Utf8NoBom');
    expect(fs.readFileSync(path.join(result.runDir, "run-pipeline.ps1"), "utf8")).toContain('$OutputEncoding = $Utf8NoBom');
    expect(fs.readFileSync(path.join(result.runDir, "run-pipeline.ps1"), "utf8")).toContain("[Codex stderr]");
    expect(fs.readFileSync(path.join(result.runDir, "run-pipeline.ps1"), "utf8")).toContain("仍在生成 [");
    expect(fs.readFileSync(path.join(result.runDir, "run-pipeline.ps1"), "utf8")).toContain("Assert-GeneratedOutput $Node $Primary");
    expect(fs.readFileSync(path.join(result.runDir, "inputs", "context.json"), "utf8")).toContain("已确认的最终选题");
    const volumePrompt = fs.readFileSync(path.join(result.runDir, "inputs", "01-volumes.md"), "utf8");
    expect(volumePrompt).toContain("## 已确认选题");
    expect(volumePrompt).not.toContain("inputs/context.json");
    expect(volumePrompt).not.toContain("世界观与等级体系");
    expect(volumePrompt).not.toContain("创作极度详细的分章大纲");
    expect(volumePrompt).toContain("不读取、不考虑后续步骤的模板");
    expect(volumePrompt).toContain("不得停止生成");
    const settingsPrompt = fs.readFileSync(path.join(result.runDir, "inputs", "02-settings.md"), "utf8");
    expect(settingsPrompt).toContain("世界观与等级体系");
    expect(settingsPrompt).toContain("outputs/01-volumes.md");
    expect(settingsPrompt).not.toContain("创作极度详细的分章大纲");
    expect(result.manifest.runner.cliInvocation).toContain("--output-last-message");
    expect(result.manifest.runner.cliInvocation).toContain("--json");
    expect(result.manifest.runner.cliInvocation).toContain("model_reasoning_effort=medium");
    expect(getLatestAutomationRun(repo.getNovelWorkspace(novelId)!, { rootDir })?.manifest.runId).toBe(result.manifest.runId);
  });

  it("continues from a contiguous prefix of manually confirmed planning content", () => {
    saveManualPlanningPrefix(2);
    const result = createRun();

    expect(result.seededCount).toBe(10);
    expect(result.manifest.nodes.slice(0, 10).every((node) => node.status === "completed" && node.imported && node.attempts === 0)).toBe(true);
    expect(result.manifest.nodes.slice(10).every((node) => node.status === "pending" && !node.imported)).toBe(true);
    expect(fs.readFileSync(path.join(result.runDir, result.manifest.nodes[8].outputPath), "utf8")).toContain("手工分章大纲 1-10");
    expect(fs.readFileSync(path.join(result.runDir, "outputs", "continuity.md"), "utf8")).toContain("分章大纲 11–20");
  });

  it("stops seeding at the first planning gap even when later formal content exists", () => {
    repo.saveStep(novelId, "volumes", "手工分卷", false);
    repo.saveStep(novelId, "settings", "手工设定", false);
    repo.saveStoryUnit(novelId, 1, "手工剧情 1-10", false);
    repo.saveStoryUnit(novelId, 21, "手工剧情 21-30", false);
    const result = createRun();

    expect(result.seededCount).toBe(3);
    expect(result.manifest.nodes[2]).toMatchObject({ id: "units-1", status: "completed", imported: true });
    expect(result.manifest.nodes[3]).toMatchObject({ id: "units-11", status: "pending", imported: false });
    expect(result.manifest.nodes[4]).toMatchObject({ id: "units-21", status: "pending", imported: false });
  });

  it("upgrades an already-created but unstarted task to the current manual progress", () => {
    const result = createRun();
    repo.saveStep(novelId, "volumes", "任务创建后确认的分卷", false);
    repo.saveStep(novelId, "settings", "任务创建后确认的设定", false);
    repo.saveStoryUnit(novelId, 1, "任务创建后确认的剧情单元", false);

    expect(seedAutomationRunFromWorkspace(result.runDir, result.manifest, repo.getNovelWorkspace(novelId)!)).toBe(3);
    const upgraded = readAutomationManifest(result.runDir);
    expect(upgraded.nodes.slice(0, 3).every((node) => node.status === "completed" && node.imported)).toBe(true);
    expect(upgraded.snapshot.stepContent.settings).toBe("任务创建后确认的设定");
    expect(fs.readFileSync(path.join(result.runDir, upgraded.nodes[2].outputPath), "utf8")).toContain("任务创建后确认的剧情单元");
  });

  it("runs one node through a fake CLI, retries once after failure, and pauses", () => {
    const result = createRun();
    requestAutomationControl(result.runDir, "run", { mode: "retry-node", targetNodeId: "volumes" });
    const fakeCli = path.join(rootDir, "fake-codex.cmd");
    const fakeOutput = volumeOutput();
    fs.writeFileSync(fakeCli, `@echo off\r\nchcp 65001 >nul\r\nset out=\r\n:args\r\nif "%~1"=="" goto ready\r\nif "%~1"=="--output-last-message" set out=%~2\r\nshift\r\ngoto args\r\n:ready\r\necho {"type":"turn.started"}\r\necho OpenAI Codex v0.144.6 1>&2\r\nif not exist "%~dp0failed.once" (echo failed>"%~dp0failed.once" & exit /b 7)\r\n>"%out%" echo ${fakeOutput.replaceAll("\n", "\r\n>>\"%out%\" echo ")}\r\n>>"%out%" echo ^<!-- DROPMIND_CONTINUITY --^>\r\n>>"%out%" echo 人物当前位置和关系：测试\r\nexit /b 0\r\n`, "utf8");

    const executed = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(result.runDir, "run-pipeline.ps1")], {
      cwd: result.runDir,
      env: { ...process.env, CODEX_CLI_PATH: fakeCli },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(executed.status, executed.stderr || executed.stdout).toBe(0);
    expect(executed.stdout).toContain("开始调用 Codex：分卷大纲");
    expect(executed.stdout).toContain('[Codex] {"type":"turn.started"}');
    expect(executed.stdout).toContain("已完成：分卷大纲");
    const manifest = readAutomationManifest(result.runDir);
    expect([...fs.readFileSync(path.join(result.runDir, "manifest.json")).subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(manifest.status).toBe("paused");
    expect(manifest.nodes[0]).toMatchObject({ status: "completed", attempts: 2, imported: false });
    expect(typeof manifest.nodes[0].lastDurationSeconds).toBe("number");
    expect(fs.readFileSync(path.join(result.runDir, manifest.nodes[0].outputPath), "utf8")).toContain("第5卷");
    expect(fs.readFileSync(path.join(result.runDir, "outputs", "continuity.md"), "utf8")).toContain("人物当前位置和关系");
    const log = fs.readFileSync(path.join(result.runDir, manifest.nodes[0].logPath), "utf8");
    expect(log).toContain("OpenAI Codex v0.144.6");
    expect(log).toContain("退出状态：0");
  });

  it("persists a failed node and its stderr log after retries are exhausted", () => {
    const result = createRun();
    requestAutomationControl(result.runDir, "run", { mode: "retry-node", targetNodeId: "volumes" });
    const fakeCli = path.join(rootDir, "always-failing-codex.cmd");
    fs.writeFileSync(fakeCli, "@echo off\r\necho simulated Codex failure 1>&2\r\nexit /b 9\r\n", "utf8");

    const executed = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(result.runDir, "run-pipeline.ps1")], {
      cwd: result.runDir,
      env: { ...process.env, CODEX_CLI_PATH: fakeCli },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(executed.status).toBe(1);
    expect(executed.stdout).toContain("生成失败：分卷大纲");
    const manifest = readAutomationManifest(result.runDir);
    expect(manifest).toMatchObject({ status: "failed", currentNode: "volumes", failureReason: "Codex CLI 退出状态为 9" });
    expect(manifest.nodes[0]).toMatchObject({ status: "failed", attempts: 2, failureReason: "Codex CLI 退出状态为 9" });
    expect(typeof manifest.nodes[0].lastDurationSeconds).toBe("number");
    const log = fs.readFileSync(path.join(result.runDir, manifest.nodes[0].logPath), "utf8");
    expect(log).toContain("simulated Codex failure");
    expect(log).toContain("Codex CLI 退出状态为 9");
  });

  it("stops before downstream nodes when a middle batch fails output validation", () => {
    const result = createRun();
    result.manifest.nodes.slice(0, 3).forEach((node) => { node.status = "completed"; });
    saveManifest(result.runDir, result.manifest);
    const fakeCli = path.join(rootDir, "conflict-codex.cmd");
    fs.writeFileSync(fakeCli, `@echo off\r\nchcp 65001 >nul\r\nset out=\r\n:args\r\nif "%~1"=="" goto ready\r\nif "%~1"=="--output-last-message" set out=%~2\r\nshift\r\ngoto args\r\n:ready\r\n>"%out%" echo 第1-10章\r\n>>"%out%" echo 错误的章节批次\r\n>>"%out%" echo ^<!-- DROPMIND_CONTINUITY --^>\r\n>>"%out%" echo 未更新\r\nexit /b 0\r\n`, "utf8");

    const executed = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(result.runDir, "run-pipeline.ps1")], {
      cwd: result.runDir,
      env: { ...process.env, CODEX_CLI_PATH: fakeCli },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(executed.status).toBe(1);
    const manifest = readAutomationManifest(result.runDir);
    expect(manifest).toMatchObject({ status: "failed", currentNode: "units-11" });
    expect(manifest.nodes[3]).toMatchObject({ status: "failed", attempts: 2, failureReason: "剧情单元 11–20未标明正确章节范围" });
    expect(manifest.nodes.slice(4).every((node) => node.status === "pending" && node.attempts === 0)).toBe(true);
    expect(fs.existsSync(path.join(result.runDir, manifest.nodes[3].outputPath))).toBe(false);
  });

  it("upgrades an existing stopped run and compacts pending prompts without touching its snapshot", () => {
    const result = createRun();
    const inputPath = path.join(result.runDir, "inputs", "context.json");
    const inputBefore = fs.readFileSync(inputPath, "utf8");
    const promptPath = path.join(result.runDir, result.manifest.nodes[0].inputPath);
    fs.writeFileSync(promptPath, "old prompt that reads inputs/context.json", "utf8");
    result.manifest.status = "failed";
    result.manifest.runner.scriptVersion = 1;
    saveManifest(result.runDir, result.manifest);
    fs.writeFileSync(path.join(result.runDir, "run-pipeline.ps1"), "old runner", "utf8");

    expect(refreshAutomationRunnerFiles(result.runDir, result.manifest)).toBe(true);
    expect(result.manifest.runner.scriptVersion).toBe(AUTOMATION_RUNNER_VERSION);
    expect(fs.readFileSync(path.join(result.runDir, "run-pipeline.ps1"), "utf8")).toContain("terminating NativeCommandError");
    expect(fs.readFileSync(inputPath, "utf8")).toBe(inputBefore);
    expect(fs.readFileSync(promptPath, "utf8")).toContain("## 已确认选题");
    expect(fs.readFileSync(promptPath, "utf8")).not.toContain("inputs/context.json");
    expect(refreshAutomationRunnerFiles(result.runDir, result.manifest)).toBe(false);
  });

  it("recovers an orphaned running node after the pipeline has stopped", () => {
    const result = createRun();
    result.manifest.status = "failed";
    result.manifest.currentNode = "volumes";
    result.manifest.nodes[0].status = "running";
    result.manifest.nodes[0].attempts = result.manifest.nodes[0].maxAttempts;
    saveManifest(result.runDir, result.manifest);

    expect(refreshAutomationRunnerFiles(result.runDir, result.manifest)).toBe(true);
    expect(result.manifest.status).toBe("failed");
    expect(result.manifest.nodes[0]).toMatchObject({ status: "failed", failureReason: "上次运行异常中断，请单独重试。" });
    expect(result.manifest.failureReason).toContain("请单独重试");
    expect(refreshAutomationRunnerFiles(result.runDir, result.manifest)).toBe(false);
  });

  it("recovers a manually interrupted active run and upgrades its runner", () => {
    const result = createRun();
    result.manifest.status = "running";
    result.manifest.currentNode = "volumes";
    result.manifest.nodes[0].status = "running";
    result.manifest.nodes[0].attempts = 1;
    result.manifest.nodes[0].startedAt = "2026-07-19T01:02:10.000Z";
    result.manifest.runner.scriptVersion = 1;
    saveManifest(result.runDir, result.manifest);

    const manifest = recoverInterruptedAutomationRun(result.runDir, { now: () => new Date("2026-07-19T01:02:55.000Z") });

    expect(manifest).toMatchObject({ status: "failed", currentNode: "volumes" });
    expect(manifest.nodes[0]).toMatchObject({ status: "failed", attempts: 1, lastDurationSeconds: 45, failureReason: "本地 Codex 进程已被手动中断，请单独重试。" });
    expect(manifest.runner.scriptVersion).toBe(AUTOMATION_RUNNER_VERSION);
    expect(JSON.parse(fs.readFileSync(path.join(result.runDir, "control.json"), "utf8"))).toMatchObject({ action: "pause", mode: "all" });
  });

  it("marks downstream completed nodes stale after upstream content changes and can restart from a node", () => {
    const result = createRun();
    result.manifest.status = "completed";
    result.manifest.nodes.forEach((node) => { node.status = "completed"; node.imported = true; });
    saveManifest(result.runDir, result.manifest);
    repo.updateNovel(novelId, { selectedTopic: "用户修改后的选题" });

    const changedIndex = reconcileAutomationStaleness(result.runDir, result.manifest, repo.getNovelWorkspace(novelId)!);

    expect(changedIndex).toBe(0);
    expect(result.manifest.status).toBe("stale");
    expect(result.manifest.nodes.every((node) => node.status === "stale")).toBe(true);

    const restarted = restartAutomationFromNode(result.runDir, "units-11", repo.getNovelWorkspace(novelId)!);
    const index = restarted.manifest.nodes.findIndex((node) => node.id === "units-11");
    expect(restarted.manifest.nodes[index].status).toBe("pending");
    expect(restarted.manifest.nodes.slice(index + 1).every((node) => node.status === "stale" && !node.imported)).toBe(true);
    expect(restarted.manifest.snapshot.selectedTopic).toBe("用户修改后的选题");
    expect(fs.readFileSync(path.join(result.runDir, restarted.manifest.nodes[index].inputPath), "utf8")).toContain("用户修改后的选题");
    expect(JSON.parse(fs.readFileSync(path.join(result.runDir, "inputs", "context.json"), "utf8")).selectedTopic).toBe("用户修改后的选题");
  });

  it("rewrites task inputs from the current prompt templates before regeneration", () => {
    const result = createRun();
    result.manifest.status = "completed";
    result.manifest.nodes.forEach((node) => { node.status = "completed"; node.imported = true; });
    saveManifest(result.runDir, result.manifest);
    repo.updatePromptSchemeTemplate("system-default", "volumes", "新版分卷提示词：强调每卷主要矛盾");
    const workspace = repo.getNovelWorkspace(novelId)!;

    expect(reconcileAutomationStaleness(result.runDir, result.manifest, workspace)).toBe(0);
    const oldInputPath = result.manifest.nodes[0].inputPath;
    const oldInput = fs.readFileSync(path.join(result.runDir, oldInputPath), "utf8");
    expect(oldInput).not.toContain("新版分卷提示词");

    const restarted = restartAutomationFromNode(result.runDir, "volumes", workspace);
    expect(restarted.manifest.nodes[0].inputPath).not.toBe(oldInputPath);
    const newInput = fs.readFileSync(path.join(result.runDir, restarted.manifest.nodes[0].inputPath), "utf8");
    expect(newInput).toContain("新版分卷提示词：强调每卷主要矛盾");
    expect(fs.readFileSync(path.join(result.runDir, oldInputPath), "utf8")).toBe(oldInput);
    expect(restarted.manifest.snapshot.templates.volumes).toBe("新版分卷提示词：强调每卷主要矛盾");
    expect(restarted.manifest.nodes[0].inputHash).not.toBe(result.manifest.nodes[0].inputHash);
  });

  it("drops stale downstream continuity when regenerating from an upstream node", () => {
    const result = createRun();
    result.manifest.status = "paused";
    result.manifest.nodes.slice(0, 3).forEach((node) => { node.status = "completed"; });
    saveManifest(result.runDir, result.manifest);
    fs.writeFileSync(path.join(result.runDir, "outputs", "continuity.md"), "# 连续性记录\n\n## 分卷大纲\n\n保留的分卷事实\n\n## 核心设定\n\n旧设定\n\n## 剧情单元 1–10\n\n旧剧情\n", "utf8");

    restartAutomationFromNode(result.runDir, "settings", repo.getNovelWorkspace(novelId)!);

    const continuity = fs.readFileSync(path.join(result.runDir, "outputs", "continuity.md"), "utf8");
    expect(continuity).toContain("保留的分卷事实");
    expect(continuity).not.toContain("旧设定");
    expect(continuity).not.toContain("旧剧情");
  });

  it("records pause without overwriting an active runner manifest and resumes a paused task", () => {
    const result = createRun();
    result.manifest.status = "running";
    result.manifest.currentNode = "volumes";
    result.manifest.nodes[0].status = "running";
    result.manifest.nodes[0].attempts = 1;
    saveManifest(result.runDir, result.manifest);

    requestAutomationControl(result.runDir, "pause");
    expect(readAutomationManifest(result.runDir)).toMatchObject({ status: "running", currentNode: "volumes" });

    result.manifest.status = "paused";
    result.manifest.currentNode = null;
    result.manifest.nodes[0].status = "paused";
    saveManifest(result.runDir, result.manifest);
    requestAutomationControl(result.runDir, "run");
    expect(readAutomationManifest(result.runDir).status).toBe("pending");
  });

  it("validates ranges and all ten chapter headings", () => {
    const unitNode = createRun().manifest.nodes.find((node) => node.id === "units-21")!;
    const outlineNode = createRun().manifest.nodes.find((node) => node.id === "outlines-21")!;

    expect(validateAutomationOutput(unitNode, "第21-30章\n两个剧情单元")).toContain("第21-30章");
    expect(() => validateAutomationOutput(unitNode, "第11-20章\n错误批次")).toThrow("正确章节范围");
    expect(validateAutomationOutput(outlineNode, outlineOutput(21))).toContain("## 第30章");
    expect(() => validateAutomationOutput(outlineNode, outlineOutput(21).replace("## 第25章", "第25章"))).toThrow("第25章");
    expect(() => validateAutomationOutput(unitNode, "无法继续生成：上游资料存在冲突。请先明确人物身份。\n第21-30章")).toThrow("冲突诊断");
  });

  it("imports completed output transactionally, keeps history, and is idempotent after a manifest-write crash", () => {
    repo.saveStep(novelId, "volumes", "旧分卷大纲", false);
    repo.updateNovel(novelId, { firstVolumeOutline: "旧第一卷大纲" });
    const result = createAutomationRun(repo.getNovelWorkspace(novelId)!, { rootDir });
    const node = result.manifest.nodes[0];
    node.status = "completed";
    node.imported = false;
    node.importedHash = null;
    fs.writeFileSync(path.join(result.runDir, node.outputPath), volumeOutput("新版"), "utf8");
    saveManifest(result.runDir, result.manifest);

    expect(importCompletedAutomationNodes(result.runDir, result.manifest, repo.getNovelWorkspace(novelId)!, repo)).toBe(1);
    const firstWorkspace = repo.getNovelWorkspace(novelId)!;
    expect(firstWorkspace.steps.find((row) => row.key === "volumes")?.content).toContain("第5卷");
    expect(firstWorkspace.novel.firstVolumeOutline).toContain("第1卷");
    expect(new Set(firstWorkspace.contentVersions.map((row) => row.content))).toEqual(new Set(["旧分卷大纲", "旧第一卷大纲"]));

    const afterFirstImport = readAutomationManifest(result.runDir);
    afterFirstImport.nodes[0].imported = false;
    afterFirstImport.nodes[0].importedHash = null;
    saveManifest(result.runDir, afterFirstImport);
    expect(importCompletedAutomationNodes(result.runDir, afterFirstImport, repo.getNovelWorkspace(novelId)!, repo)).toBe(1);
    expect(repo.getNovelWorkspace(novelId)!.contentVersions).toHaveLength(2);
  });

  it("rolls back a complete automated outline import when one chapter insert fails", () => {
    const content = outlineOutput(21);
    sqlite.exec(`create trigger reject_automated_outline before insert on chapter_outlines
      when NEW.chapter_number = 25 begin select raise(abort, 'reject automated row'); end`);

    expect(() => repo.importAutomationNode({ novelId, kind: "outlines", startChapter: 21, content })).toThrow("reject automated row");
    expect(repo.getNovelWorkspace(novelId)!.chapterOutlines).toEqual([]);
  });
});
