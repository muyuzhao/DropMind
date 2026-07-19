import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  AUTOMATION_RUNNER_VERSION,
  automationRunnerDefinition,
  writeAutomationRunnerFiles,
  type AutomationControl,
  type AutomationNodeStatus,
  type AutomationOverallStatus,
} from "./automation";
import { getNovelCodexProjectInfo } from "./codex-project";
import { rangeForChapter } from "./ranges";
import type { ChapterStatus } from "../../lib/novel-db/schema";
import type { NovelWorkspaceData } from "./types";

type ChapterAutomationOptions = { rootDir?: string; now?: () => Date };

export type ChapterAutomationNode = {
  id: string;
  label: string;
  kind: "chapter";
  chapterNumber: number;
  status: AutomationNodeStatus;
  attempts: number;
  maxAttempts: number;
  inputPath: string;
  inputHash: string;
  outputPath: string;
  logPath: string;
  imported: boolean;
  importedHash: string | null;
  expectedDatabaseContent: string;
  expectedUpdatedAt: number | null;
  startedAt: string | null;
  completedAt: string | null;
  lastDurationSeconds: number | null;
  failureReason: string | null;
};

export type ChapterSourceSnapshot = {
  globalHash: string;
  previousChapterHash: string;
  unitHashes: Record<string, string>;
  outlineHashes: Record<string, string>;
};

export type ChapterAutomationManifest = {
  version: 1;
  kind: "chapters";
  runId: string;
  novelId: string;
  novelName: string;
  startChapter: number;
  endChapter: number;
  status: AutomationOverallStatus;
  currentNode: string | null;
  createdAt: string;
  updatedAt: string;
  source: ChapterSourceSnapshot;
  nodes: ChapterAutomationNode[];
  continuityPath: string;
  runner: ReturnType<typeof automationRunnerDefinition>;
  failureReason: string | null;
};

type ChapterAutomationImporter = {
  importAutomatedChapters(input: {
    novelId: string;
    chapters: Array<{ chapterNumber: number; content: string; expectedUpdatedAt: number | null; expectedDatabaseContent: string }>;
  }): number;
};

function nowIso(options: ChapterAutomationOptions = {}) {
  return (options.now?.() ?? new Date()).toISOString();
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function slash(value: string) {
  return value.replaceAll("\\", "/");
}

function atomicWrite(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  const backupPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.bak`);
  let previousMoved = false;
  try {
    fs.writeFileSync(temporaryPath, content, "utf8");
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, backupPath);
      previousMoved = true;
    }
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      if (previousMoved && !fs.existsSync(filePath) && fs.existsSync(backupPath)) fs.renameSync(backupPath, filePath);
      throw error;
    }
    if (previousMoved && fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true });
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    if (fs.existsSync(filePath) && fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true });
  }
}

function writeJson(filePath: string, value: unknown) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
}

function chapterLabel(chapter: number) {
  return String(chapter).padStart(3, "0");
}

function rangeLabel(start: number, end: number) {
  return `${chapterLabel(start)}-${chapterLabel(end)}`;
}

function stepContent(workspace: NovelWorkspaceData, key: string) {
  return String(workspace.steps.find((row) => row.key === key)?.content ?? "").trim();
}

function draftInstruction(workspace: NovelWorkspaceData) {
  return String(workspace.templates.find((row) => row.key === "drafts")?.template ?? "").trim();
}

function storyUnit(workspace: NovelWorkspaceData, chapter: number) {
  const range = rangeForChapter(chapter);
  return String(workspace.storyUnits.find((row) => Number(row.startChapter) === range.start)?.content ?? "").trim();
}

function chapterOutline(workspace: NovelWorkspaceData, chapter: number) {
  return String(workspace.chapterOutlines.find((row) => Number(row.chapterNumber) === chapter)?.content ?? "").trim();
}

function chapterRow(workspace: NovelWorkspaceData, chapter: number) {
  return workspace.chapters.find((row) => Number(row.chapterNumber) === chapter);
}

function sourceSnapshot(workspace: NovelWorkspaceData, startChapter: number, endChapter: number): ChapterSourceSnapshot {
  const global = [
    String(workspace.novel.selectedTopic ?? ""),
    String(workspace.novel.firstVolumeOutline ?? ""),
    stepContent(workspace, "volumes"),
    stepContent(workspace, "settings"),
    draftInstruction(workspace),
  ].join("\n\u0000\n");
  const unitHashes: Record<string, string> = {};
  const outlineHashes: Record<string, string> = {};
  for (let chapter = startChapter; chapter <= endChapter; chapter += 1) {
    const range = rangeForChapter(chapter);
    unitHashes[String(range.start)] = digest(storyUnit(workspace, chapter));
    outlineHashes[String(chapter)] = digest(chapterOutline(workspace, chapter));
  }
  const previousChapter = startChapter > 1 ? String(chapterRow(workspace, startChapter - 1)?.content ?? "") : "";
  return { globalHash: digest(global), previousChapterHash: digest(previousChapter), unitHashes, outlineHashes };
}

function validateRange(workspace: NovelWorkspaceData, startChapter: number, chapterCount: number) {
  if (!Number.isInteger(startChapter) || startChapter < 1 || startChapter > 60) throw new Error("起始章节必须在 1–60 章之间");
  if (!Number.isInteger(chapterCount) || chapterCount < 1 || chapterCount > 10) throw new Error("单次只能连续生成 1–10 章");
  const endChapter = startChapter + chapterCount - 1;
  if (endChapter > 60) throw new Error("生成范围不能超过第 60 章");
  const missing: string[] = [];
  if (!String(workspace.novel.selectedTopic ?? "").trim()) missing.push("最终选题");
  if (!String(workspace.novel.firstVolumeOutline ?? "").trim()) missing.push("本卷大纲");
  if (!stepContent(workspace, "settings")) missing.push("核心设定");
  if (!draftInstruction(workspace)) missing.push("正文创作要求");
  const checkedUnits = new Set<number>();
  for (let chapter = startChapter; chapter <= endChapter; chapter += 1) {
    const range = rangeForChapter(chapter);
    if (!checkedUnits.has(range.start) && !storyUnit(workspace, chapter)) missing.push(`第${range.start}-${range.end}章剧情单元`);
    checkedUnits.add(range.start);
    if (!chapterOutline(workspace, chapter)) missing.push(`第${chapter}章分章大纲`);
    const current = chapterRow(workspace, chapter);
    if (String(current?.status ?? "not_started") === "published") throw new Error(`第${chapter}章已经发布，不能自动覆盖`);
  }
  if (startChapter > 1 && !String(chapterRow(workspace, startChapter - 1)?.content ?? "").trim()) missing.push(`第${startChapter - 1}章正文`);
  if (missing.length) throw new Error(`自动生成正文前还缺少：${[...new Set(missing)].join("、")}`);
  return endChapter;
}

function chapterPrompt(chapter: number, startChapter: number) {
  const range = rangeForChapter(chapter);
  const previous = chapter === 1
    ? "- 本章是第1章，没有上一章正文。"
    : chapter === startChapter
      ? `- 上一章正文：../../正文/第${chapterLabel(chapter - 1)}章.md`
      : `- 上一章正文：outputs/第${chapterLabel(chapter - 1)}章.md`;
  return `# DropMind 自动正文节点：第${chapter}章\n\n你只创作第${chapter}章正文。小说资料已经保存在本地文件中，不要要求用户重复粘贴；记忆不确定、称谓不统一或发现冲突时，主动读取对应资料核对。\n\n## 本章必须读取\n\n- 正文创作要求：../../资料/正文创作要求.md\n- 本章剧情单元：../../资料/剧情单元/第${rangeLabel(range.start, range.end)}章.md\n- 本章分章大纲：../../资料/分章大纲/第${rangeLabel(range.start, range.end)}章.md\n${previous}\n- 本次任务连续性记录：outputs/continuity.md\n\n## 其他资料位置（按需读取）\n\n- 作品信息：../../资料/作品信息.md\n- 已选选题：../../资料/选题.md\n- 分卷大纲：../../资料/分卷大纲.md\n- 本卷大纲：../../资料/本卷大纲.md\n- 核心设定：../../资料/核心设定.md\n- 更早正文：../../正文/\n\n## 输出要求\n\n1. 从分章大纲中只定位并创作第${chapter}章，不提前写下一章。\n2. 衔接上一章，保持人物、时间、地点、信息差、伏笔和情绪变化连续。\n3. 最终回复先输出可直接入库的纯正文，不带章节标题、过程说明或总结。\n4. 正文结束后另起一行输出精确标记：<!-- DROPMIND_CONTINUITY -->\n5. 标记后用简短 Markdown 更新：人物位置与关系、目标与秘密、伏笔、时间线、冲突状态、下一章必须延续的事实。\n`;
}

function makeRunId(now: Date) {
  return `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomUUID().slice(0, 8)}`;
}

export function createChapterAutomationRun(workspace: NovelWorkspaceData, input: { startChapter: number; chapterCount: number }, options: ChapterAutomationOptions = {}) {
  const endChapter = validateRange(workspace, input.startChapter, input.chapterCount);
  const project = getNovelCodexProjectInfo(workspace, { rootDir: options.rootDir });
  if (!project.exists) throw new Error("本地写作目录尚未同步");
  if (input.startChapter > 1) {
    const previousPath = path.join(project.projectDir, "正文", `第${chapterLabel(input.startChapter - 1)}章.md`);
    const localPrevious = fs.existsSync(previousPath) ? fs.readFileSync(previousPath, "utf8").trim() : "";
    const databasePrevious = String(chapterRow(workspace, input.startChapter - 1)?.content ?? "").trim();
    if (localPrevious !== databasePrevious) throw new Error(`第${input.startChapter - 1}章本地正文与工作台不一致，请先预览并导入或重新同步`);
  }
  const created = options.now?.() ?? new Date();
  const id = makeRunId(created);
  const runDir = path.join(project.projectDir, "自动正文", id);
  const createdAt = created.toISOString();
  const nodes: ChapterAutomationNode[] = [];
  for (let chapter = input.startChapter; chapter <= endChapter; chapter += 1) {
    const prompt = chapterPrompt(chapter, input.startChapter);
    const current = chapterRow(workspace, chapter);
    nodes.push({
      id: `chapter-${chapter}`,
      label: `第${chapter}章正文`,
      kind: "chapter",
      chapterNumber: chapter,
      status: "pending",
      attempts: 0,
      maxAttempts: 2,
      inputPath: slash(`inputs/第${chapterLabel(chapter)}章.md`),
      inputHash: digest(prompt),
      outputPath: slash(`outputs/第${chapterLabel(chapter)}章.md`),
      logPath: slash(`logs/第${chapterLabel(chapter)}章.log`),
      imported: false,
      importedHash: null,
      expectedDatabaseContent: String(current?.content ?? ""),
      expectedUpdatedAt: current?.updatedAt ? Number(current.updatedAt) : null,
      startedAt: null,
      completedAt: null,
      lastDurationSeconds: null,
      failureReason: null,
    });
  }
  const manifest: ChapterAutomationManifest = {
    version: 1,
    kind: "chapters",
    runId: id,
    novelId: String(workspace.novel.id),
    novelName: String(workspace.novel.name),
    startChapter: input.startChapter,
    endChapter,
    status: "pending",
    currentNode: null,
    createdAt,
    updatedAt: createdAt,
    source: sourceSnapshot(workspace, input.startChapter, endChapter),
    nodes,
    continuityPath: "outputs/continuity.md",
    runner: automationRunnerDefinition(runDir),
    failureReason: null,
  };
  fs.mkdirSync(path.join(runDir, "inputs"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "outputs"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  for (const node of nodes) atomicWrite(path.join(runDir, node.inputPath), chapterPrompt(node.chapterNumber, input.startChapter));
  atomicWrite(path.join(runDir, manifest.continuityPath), "# 正文连续性记录\n");
  writeAutomationRunnerFiles(runDir);
  writeJson(path.join(runDir, "control.json"), { action: "run", mode: "all", targetNodeId: null, requestedAt: createdAt } satisfies AutomationControl);
  writeJson(path.join(runDir, "manifest.json"), manifest);
  return { runDir, manifest };
}

function saveManifest(runDir: string, manifest: ChapterAutomationManifest, options: ChapterAutomationOptions = {}) {
  manifest.updatedAt = nowIso(options);
  writeJson(path.join(runDir, "manifest.json"), manifest);
}

export function listChapterAutomationRuns(workspace: NovelWorkspaceData, options: ChapterAutomationOptions = {}) {
  const project = getNovelCodexProjectInfo(workspace, { rootDir: options.rootDir });
  const automationDir = path.join(project.projectDir, "自动正文");
  if (!fs.existsSync(automationDir)) return [];
  return fs.readdirSync(automationDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(automationDir, entry.name, "manifest.json")))
    .map((entry) => {
      const runDir = path.join(automationDir, entry.name);
      return { runDir, manifest: readJson<ChapterAutomationManifest>(path.join(runDir, "manifest.json")) };
    })
    .filter((item) => item.manifest.kind === "chapters" && item.manifest.novelId === String(workspace.novel.id))
    .sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt));
}

export function getLatestChapterAutomationRun(workspace: NovelWorkspaceData, options: ChapterAutomationOptions = {}) {
  return listChapterAutomationRuns(workspace, options)[0] ?? null;
}

export function refreshChapterAutomationRunnerFiles(runDir: string, manifest: ChapterAutomationManifest, options: ChapterAutomationOptions = {}) {
  if (manifest.status === "running") return false;
  let changed = false;
  const runner = automationRunnerDefinition(runDir);
  if (manifest.runner.command !== runner.command) { manifest.runner.command = runner.command; changed = true; }
  if (manifest.runner.scriptVersion !== AUTOMATION_RUNNER_VERSION) {
    writeAutomationRunnerFiles(runDir);
    manifest.runner = runner;
    changed = true;
  }
  const interrupted = manifest.nodes.find((node) => node.status === "running");
  if (interrupted) {
    interrupted.status = "failed";
    interrupted.failureReason ||= "上次运行异常中断，请单独重试。";
    manifest.status = "failed";
    manifest.currentNode = interrupted.id;
    manifest.failureReason = `${interrupted.label}上次运行异常中断，请单独重试。`;
    changed = true;
  }
  if (manifest.status === "paused" && manifest.nodes.every((node) => node.status === "completed")) {
    manifest.status = "completed";
    manifest.currentNode = null;
    manifest.failureReason = null;
    changed = true;
  }
  if (changed) saveManifest(runDir, manifest, options);
  return changed;
}

export function reconcileChapterAutomationStaleness(runDir: string, manifest: ChapterAutomationManifest, workspace: NovelWorkspaceData, options: ChapterAutomationOptions = {}) {
  if (manifest.nodes.every((node) => node.imported)) return false;
  const current = sourceSnapshot(workspace, manifest.startChapter, manifest.endChapter);
  if (JSON.stringify(current) === JSON.stringify(manifest.source)) return false;
  for (const node of manifest.nodes) if (!node.imported) node.status = "stale";
  manifest.status = "stale";
  manifest.currentNode = null;
  manifest.failureReason = "小说资料或上一章正文已变化，请新建正文生成任务";
  saveManifest(runDir, manifest, options);
  return true;
}

export function validateChapterAutomationOutput(node: ChapterAutomationNode, content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error(`${node.label}输出为空`);
  const opening = trimmed.slice(0, 1200);
  if (/(?:无法|不能)(?:继续)?生成|请先(?:明确|确认|统一)|缺少(?:必要|上游)?资料/.test(opening)) throw new Error(`${node.label}返回了诊断信息而不是正文`);
  return trimmed;
}

export function importCompletedChapterAutomationRun(runDir: string, manifest: ChapterAutomationManifest, workspace: NovelWorkspaceData, importer: ChapterAutomationImporter, options: ChapterAutomationOptions = {}) {
  if (manifest.nodes.every((node) => node.imported)) return { importedCount: 0, chapters: [] as Array<{ chapterNumber: number; content: string }> };
  if (manifest.status !== "completed" || manifest.nodes.some((node) => node.status !== "completed")) return { importedCount: 0, chapters: [] as Array<{ chapterNumber: number; content: string }> };
  if (reconcileChapterAutomationStaleness(runDir, manifest, workspace, options)) return { importedCount: 0, chapters: [] as Array<{ chapterNumber: number; content: string }> };
  const chapters = manifest.nodes.map((node) => {
    const outputPath = path.join(runDir, node.outputPath);
    if (!fs.existsSync(outputPath)) throw new Error(`${node.label}输出文件不存在`);
    return { chapterNumber: node.chapterNumber, content: validateChapterAutomationOutput(node, fs.readFileSync(outputPath, "utf8")), expectedUpdatedAt: node.expectedUpdatedAt, expectedDatabaseContent: node.expectedDatabaseContent };
  });
  importer.importAutomatedChapters({ novelId: manifest.novelId, chapters });
  for (const node of manifest.nodes) {
    const chapter = chapters.find((item) => item.chapterNumber === node.chapterNumber)!;
    node.imported = true;
    node.importedHash = digest(chapter.content);
  }
  saveManifest(runDir, manifest, options);
  return { importedCount: chapters.length, chapters: chapters.map(({ chapterNumber, content }) => ({ chapterNumber, content })) };
}

export function requestChapterAutomationControl(runDir: string, action: AutomationControl["action"], options: ChapterAutomationOptions & { mode?: AutomationControl["mode"]; targetNodeId?: string | null } = {}) {
  const manifest = readChapterAutomationManifest(runDir);
  const control: AutomationControl = { action, mode: options.mode ?? "all", targetNodeId: options.targetNodeId ?? null, requestedAt: nowIso(options) };
  let manifestChanged = false;
  if (action === "run" && control.mode === "retry-node") {
    const node = manifest.nodes.find((item) => item.id === control.targetNodeId);
    if (!node) throw new Error("重试章节不存在");
    node.status = "pending";
    node.maxAttempts = Math.max(node.maxAttempts, node.attempts + 1);
    node.failureReason = null;
    manifest.status = "pending";
    manifest.failureReason = null;
    manifestChanged = true;
  } else if (action === "run" && manifest.status !== "running") {
    manifest.status = "pending";
    manifest.failureReason = null;
    manifestChanged = true;
  }
  writeJson(path.join(runDir, "control.json"), control);
  if (manifestChanged) saveManifest(runDir, manifest, options);
  return manifest;
}

export function recoverInterruptedChapterAutomationRun(runDir: string, options: ChapterAutomationOptions = {}) {
  const manifest = readChapterAutomationManifest(runDir);
  if (manifest.status !== "running") throw new Error("任务当前不处于生成中，无需恢复中断状态");
  const node = manifest.nodes.find((item) => item.status === "running");
  if (!node) throw new Error("没有找到被中断的正文节点");
  node.status = "failed";
  node.failureReason = "本地 Codex 进程已被手动中断，请单独重试。";
  manifest.status = "failed";
  manifest.currentNode = node.id;
  manifest.failureReason = `${node.label}已被手动中断，请单独重试。`;
  writeJson(path.join(runDir, "control.json"), { action: "pause", mode: "all", targetNodeId: null, requestedAt: nowIso(options) } satisfies AutomationControl);
  saveManifest(runDir, manifest, options);
  return manifest;
}

export function readChapterAutomationArtifact(runDir: string, nodeId: string, artifact: "output" | "log") {
  const manifest = readChapterAutomationManifest(runDir);
  const node = manifest.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("正文节点不存在");
  const filePath = path.resolve(runDir, artifact === "output" ? node.outputPath : node.logPath);
  if (!filePath.startsWith(`${path.resolve(runDir)}${path.sep}`)) throw new Error("任务文件路径无效");
  if (!fs.existsSync(filePath)) throw new Error(artifact === "output" ? "正文尚未生成" : "日志尚未生成");
  return { filePath, content: fs.readFileSync(filePath, "utf8") };
}

export function readChapterAutomationManifest(runDir: string) {
  return readJson<ChapterAutomationManifest>(path.join(runDir, "manifest.json"));
}

export function chapterAutomationRangeSummary(workspace: NovelWorkspaceData) {
  return workspace.chapters.map((row) => ({ chapterNumber: Number(row.chapterNumber), status: String(row.status) as ChapterStatus, hasContent: Boolean(String(row.content ?? "").trim()) }));
}
