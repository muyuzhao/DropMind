import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { rangeForChapter } from "./ranges";
import { buildCoverPrompt } from "./prompts";
import type { NovelWorkspaceData } from "./types";
import { parseSelectedTopic } from "./selected-topic";
import { chapterFileName, normalizeChapterTitle, parseChapterFileName } from "./chapter-title";
import { assertChapterGenerationAllowed, chapterGenerationGuard } from "./chapter-progress";

type ProjectOptions = { rootDir?: string };
export type CodexChapterPhase = "not_initialized" | "synced" | "task_ready" | "file_ready" | "imported";
export type CodexChapterState = {
  phase: CodexChapterPhase;
  projectExists: boolean;
  taskChapter: number | null;
  fileExists: boolean;
  fileModifiedAt: number | null;
  missing: string[];
  generationAllowed: boolean;
  generationBlockedReason: string | null;
  nextWritableChapter: number | null;
};

function mainWorkspaceRoot(cwd = process.cwd()) {
  const marker = `${path.sep}.worktrees${path.sep}`;
  const markerIndex = cwd.indexOf(marker);
  return markerIndex === -1 ? cwd : cwd.slice(0, markerIndex);
}

export function getNovelProjectsRoot(options: ProjectOptions = {}) {
  const configured = process.env.NOVEL_PROJECTS_DIR?.trim();
  return path.resolve(options.rootDir ?? configured ?? path.join(mainWorkspaceRoot(), "data", "novel-projects"));
}

function safeFolderName(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[.\s]+$/g, "")
    .trim()
    .slice(0, 60) || "未命名小说";
}

function chapterLabel(chapter: number) {
  return String(chapter).padStart(3, "0");
}

function chapterDirectory(projectDir: string) {
  return path.join(projectDir, "正文");
}

function pendingChapterPath(projectDir: string, chapterNumber: number) {
  return path.join(projectDir, "待导入", `第${chapterLabel(chapterNumber)}章.md`);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseStructuredChapter(value: string, chapterNumber: number) {
  const trimmed = value.replace(/^\uFEFF/, "").trim();
  const titleMatch = trimmed.match(/^<!-- DROPMIND_TITLE:\s*(.*?)\s*-->\s*(?:\r?\n)+/u);
  if (!titleMatch) throw new Error("单章输出缺少章节标题标记");
  const title = normalizeChapterTitle(titleMatch[1]);
  if (!title) throw new Error("单章输出的章节标题为空");
  const remaining = trimmed.slice(titleMatch[0].length);
  const eventMarker = "<!-- DROPMIND_CHAPTER_EVENT -->";
  const continuityMarker = "<!-- DROPMIND_CONTINUITY -->";
  const eventIndex = remaining.indexOf(eventMarker);
  if (eventIndex < 0) throw new Error("单章输出缺少连续性事件标记");
  const continuityIndex = remaining.indexOf(continuityMarker, eventIndex + eventMarker.length);
  if (continuityIndex < 0) throw new Error("单章输出缺少连续性状态标记");
  const content = remaining.slice(0, eventIndex).trim();
  const continuitySummary = remaining.slice(eventIndex + eventMarker.length, continuityIndex).trim();
  const continuityState = remaining.slice(continuityIndex + continuityMarker.length).trim();
  if (!content) throw new Error("单章输出的正文为空");
  if (!continuitySummary) throw new Error("单章输出的连续性事件为空");
  const stateLines = continuityState.replace(/\r\n/g, "\n").split("\n");
  if (stateLines[0] !== "# 正文连续性状态") throw new Error("单章输出的连续性状态标题无效");
  if (stateLines[1] !== `<!-- DROPMIND_STATE_THROUGH: ${chapterNumber} -->`) throw new Error("单章输出的连续性状态未在第二行标明正确章节");
  if (!continuityState.includes(`截至第${chapterNumber}章`)) throw new Error(`单章输出的连续性状态未明确写出“截至第${chapterNumber}章”`);
  if (continuityState.length > 20_000) throw new Error("单章输出的连续性状态超过20000字符");
  return {
    title,
    content,
    continuitySummary,
    continuityState,
    continuityRunId: `manual-${chapterNumber}-${digest(trimmed).slice(0, 16)}`,
  };
}

function chapterFileCandidates(projectDir: string, chapterNumber: number) {
  const directory = chapterDirectory(projectDir);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ entry, parsed: parseChapterFileName(entry.name) }))
    .filter((item): item is { entry: fs.Dirent; parsed: NonNullable<ReturnType<typeof parseChapterFileName>> } => item.parsed?.chapterNumber === chapterNumber)
    .map((item) => ({ filePath: path.join(directory, item.entry.name), title: item.parsed.title }))
    .sort((left, right) => fs.statSync(right.filePath).mtimeMs - fs.statSync(left.filePath).mtimeMs);
}

function findChapterFile(projectDir: string, chapterNumber: number, expectedTitle = "") {
  const normalizedTitle = normalizeChapterTitle(expectedTitle);
  const desiredPath = path.join(chapterDirectory(projectDir), chapterFileName(chapterNumber, normalizedTitle));
  if (fs.existsSync(desiredPath)) return { filePath: desiredPath, title: normalizedTitle };
  const candidates = chapterFileCandidates(projectDir, chapterNumber);
  if (!candidates.length) return null;
  if (normalizedTitle) {
    const matching = candidates.find((candidate) => candidate.title === normalizedTitle);
    if (matching) return matching;
  }
  return candidates[0];
}

function rangeLabel(start: number, end: number) {
  return `${chapterLabel(start)}-${chapterLabel(end)}`;
}

function markdown(title: string, content: string) {
  return `# ${title}\n\n${content.trim() || "（尚未保存）"}\n`;
}

function continuityContent(workspace: NovelWorkspaceData) {
  return String(workspace.continuityState?.content ?? "").trim()
    || "# 正文连续性状态\n\n> 截至第0章：尚未建立已确认的连续性状态。\n";
}

function taskContinuityContent(workspace: NovelWorkspaceData, chapterNumber: number) {
  const throughChapter = chapterNumber - 1;
  if (throughChapter === 0) return "# 正文连续性状态\n\n> 截至第0章：尚无已确认正文。\n";
  if (Number(workspace.continuityState?.throughChapter) === throughChapter && String(workspace.continuityState?.content ?? "").trim()) {
    return String(workspace.continuityState!.content).trim();
  }
  const previousContent = String(workspace.chapters.find((row) => Number(row.chapterNumber) === throughChapter)?.content ?? "");
  const event = [...workspace.continuityEvents]
    .filter((row) => Number(row.chapterNumber) === throughChapter && row.invalidatedAt === null && row.chapterHash === digest(previousContent) && String(row.stateContent).trim())
    .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))[0];
  if (event) return String(event.stateContent).trim();
  return `# 正文连续性状态\n<!-- DROPMIND_BASE_THROUGH_HASH: ${digest(previousContent)} -->\n\n> 需要在创作第${chapterNumber}章前重建截至第${throughChapter}章的连续性基线。\n\n当前数据库没有恰好截至第${throughChapter}章的有效状态。请按需读取“正文/”中第1—${throughChapter}章的已确认正文，先核对人物、时空、知情差、未解决线索和硬事实，再创作本章。不得把第${chapterNumber}章及之后的大纲内容写成已经发生的事实。\n`;
}

function writeText(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, content, "utf8");
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function novelIdentity(workspace: NovelWorkspaceData) {
  return {
    id: String(workspace.novel.id),
    name: String(workspace.novel.name),
  };
}

function desiredProjectFolder(workspace: NovelWorkspaceData) {
  const { id, name } = novelIdentity(workspace);
  const suffix = `-${id.slice(0, 8)}`;
  return { folderName: `${safeFolderName(name)}${suffix}`, suffix };
}

function runningAutomationRun(projectDir: string) {
  for (const automationFolder of ["自动生成", "自动正文"]) {
    const automationDir = path.join(projectDir, automationFolder);
    if (!fs.existsSync(automationDir)) continue;
    for (const entry of fs.readdirSync(automationDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(automationDir, entry.name, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")) as { status?: string };
        if (manifest.status === "running") return entry.name;
      } catch {
        // 损坏的历史任务不应阻止小说目录按当前书名迁移。
      }
    }
  }
  return null;
}

function alignNovelProjectFolder(workspace: NovelWorkspaceData, options: ProjectOptions = {}) {
  const rootDir = getNovelProjectsRoot(options);
  const desired = desiredProjectFolder(workspace);
  const desiredDir = path.join(rootDir, desired.folderName);
  if (!fs.existsSync(rootDir)) return { projectDir: desiredDir, folderName: desired.folderName, exists: false, renamedFrom: null as string | null };

  const matchingFolders = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(desired.suffix));
  const desiredEntry = matchingFolders.find((entry) => entry.name === desired.folderName);
  const previousEntries = matchingFolders.filter((entry) => entry.name !== desired.folderName);

  if (desiredEntry) {
    if (previousEntries.length > 0) throw new Error(`本地目录重命名冲突：目标目录和旧目录同时存在，请先检查 ${rootDir}`);
    return { projectDir: desiredDir, folderName: desired.folderName, exists: true, renamedFrom: null as string | null };
  }
  if (previousEntries.length === 0) return { projectDir: desiredDir, folderName: desired.folderName, exists: false, renamedFrom: null as string | null };
  if (previousEntries.length > 1) throw new Error(`发现多个属于当前小说的本地目录，请先检查 ${rootDir}`);

  const previousDir = path.join(rootDir, previousEntries[0].name);
  if (fs.existsSync(desiredDir)) throw new Error(`本地目录重命名失败：目标目录已存在 ${desiredDir}`);
  const activeRun = runningAutomationRun(previousDir);
  if (activeRun) throw new Error(`自动生成任务 ${activeRun} 正在运行，目录暂未重命名；任务结束后点击“同步全部资料”即可重试`);
  try {
    fs.renameSync(previousDir, desiredDir);
  } catch (error) {
    throw new Error(`本地目录重命名失败：${previousDir} → ${desiredDir}`, { cause: error });
  }
  return { projectDir: desiredDir, folderName: desired.folderName, exists: true, renamedFrom: previousDir };
}

export function getNovelCodexProjectInfo(workspace: NovelWorkspaceData, options: ProjectOptions = {}) {
  const rootDir = getNovelProjectsRoot(options);
  const desired = desiredProjectFolder(workspace);
  let folderName = desired.folderName;
  if (fs.existsSync(rootDir)) {
    const existing = fs.readdirSync(rootDir, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.endsWith(desired.suffix));
    if (existing) folderName = existing.name;
  }
  const projectDir = path.join(rootDir, folderName);
  return { projectDir, folderName, exists: fs.existsSync(projectDir) };
}

function stepContent(workspace: NovelWorkspaceData, key: string) {
  return String(workspace.steps.find((row) => row.key === key)?.content ?? "");
}

function draftInstruction(workspace: NovelWorkspaceData) {
  return String(workspace.templates.find((row) => row.key === "drafts")?.template ?? "");
}

function groupedChapterOutlines(workspace: NovelWorkspaceData) {
  const grouped = new Map<number, string>();
  for (const row of workspace.chapterOutlines) {
    const chapterNumber = Number(row.chapterNumber);
    const range = rangeForChapter(chapterNumber);
    const content = String(row.content ?? "");
    if (!grouped.has(range.start) || chapterNumber === range.start) grouped.set(range.start, content);
  }
  return grouped;
}

export function syncNovelCodexProject(workspace: NovelWorkspaceData, options: ProjectOptions = {}) {
  const info = alignNovelProjectFolder(workspace, options);
  const { projectDir } = info;
  const novel = workspace.novel;
  fs.mkdirSync(path.join(projectDir, "资料", "剧情单元"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "资料", "分章大纲"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "资料", "连续性"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "正文"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "待导入"), { recursive: true });

  writeText(path.join(projectDir, "AGENTS.override.md"), `# 小说正文创作项目\n\n- 本目录只用于创作当前小说，不修改 DropMind 程序代码。\n- 每次收到“执行当前任务”后，先完整读取《当前任务.md》及其中列出的资料。\n- 严格按任务指定章节创作，只写到结尾钩子，不提前创作下一章。\n- 必须把任务要求的完整结构化结果保存到指定的待导入文件；完成后只报告文件路径与正文字符数。\n- 若资料互相冲突或缺失，停止创作并指出具体文件。\n`);
  writeText(path.join(projectDir, "资料", "作品信息.md"), markdown("作品信息", `小说名称：${String(novel.name)}`));
  writeText(path.join(projectDir, "资料", "选题.md"), markdown("已选选题", String(novel.selectedTopic ?? "")));
  writeText(path.join(projectDir, "资料", "分卷大纲.md"), markdown("分卷大纲", stepContent(workspace, "volumes")));
  writeText(path.join(projectDir, "资料", "本卷大纲.md"), markdown("本卷大纲", String(novel.firstVolumeOutline ?? "")));
  writeText(path.join(projectDir, "资料", "核心设定.md"), markdown("小说核心设定", stepContent(workspace, "settings")));
  writeText(path.join(projectDir, "资料", "作品标签.md"), markdown("作品标签", stepContent(workspace, "tags")));
  const selectedTopic = parseSelectedTopic(String(novel.selectedTopic ?? ""));
  const coverInstruction = String(workspace.templates.find((row) => row.key === "cover")?.template ?? "");
  writeText(path.join(projectDir, "资料", "封面提示词.md"), markdown("封面提示词", buildCoverPrompt(selectedTopic.title || String(novel.name), selectedTopic.summary, coverInstruction)));
  writeText(path.join(projectDir, "资料", "正文创作要求.md"), markdown("正文创作要求", draftInstruction(workspace)));
  writeText(path.join(projectDir, "资料", "连续性", "当前状态.md"), `${continuityContent(workspace).trim()}\n`);

  for (const row of workspace.storyUnits) {
    const start = Number(row.startChapter);
    const end = Number(row.endChapter ?? start + 9);
    writeText(path.join(projectDir, "资料", "剧情单元", `第${rangeLabel(start, end)}章.md`), markdown(`第${start}-${end}章剧情单元`, String(row.content ?? "")));
  }
  for (const [start, content] of groupedChapterOutlines(workspace)) {
    const end = start + 9;
    writeText(path.join(projectDir, "资料", "分章大纲", `第${rangeLabel(start, end)}章.md`), markdown(`第${start}-${end}章分章大纲`, content));
  }
  for (const row of workspace.chapters) {
    const chapterNumber = Number(row.chapterNumber);
    const title = normalizeChapterTitle(String(row.title ?? ""));
    const content = String(row.content ?? "").trim();
    if (!content) continue;
    const desiredPath = path.join(chapterDirectory(projectDir), chapterFileName(chapterNumber, title));
    if (fs.existsSync(desiredPath)) continue;
    const candidates = chapterFileCandidates(projectDir, chapterNumber);
    const matchingContent = candidates.filter((candidate) => fs.readFileSync(candidate.filePath, "utf8").trim() === content);
    if (title && matchingContent.length === 1) {
      fs.renameSync(matchingContent[0].filePath, desiredPath);
      continue;
    }
    if (!candidates.length) writeText(desiredPath, content);
  }
  return { ...info, exists: true };
}

function taskRequirements(workspace: NovelWorkspaceData, chapterNumber: number) {
  const range = rangeForChapter(chapterNumber);
  const missing: string[] = [];
  if (!stepContent(workspace, "settings").trim()) missing.push("核心设定");
  if (!String(workspace.novel.firstVolumeOutline ?? "").trim()) missing.push("本卷大纲");
  if (!draftInstruction(workspace).trim()) missing.push("正文创作要求");
  if (!workspace.storyUnits.some((row) => Number(row.startChapter) === range.start && String(row.content ?? "").trim())) missing.push(`第${range.start}-${range.end}章剧情单元`);
  if (!workspace.chapterOutlines.some((row) => Number(row.chapterNumber) === chapterNumber && String(row.content ?? "").trim())) missing.push(`第${chapterNumber}章分章大纲`);
  if (chapterNumber > 1 && !workspace.chapters.some((row) => Number(row.chapterNumber) === chapterNumber - 1 && String(row.content ?? "").trim())) missing.push(`第${chapterNumber - 1}章正文`);
  return { range, missing };
}

function requiredTaskContent(workspace: NovelWorkspaceData, chapterNumber: number) {
  assertChapterGenerationAllowed(workspace, chapterNumber);
  const requirements = taskRequirements(workspace, chapterNumber);
  if (requirements.missing.length) throw new Error(`准备Codex任务前还缺少：${requirements.missing.join("、")}`);
  return requirements.range;
}

export function inspectCodexChapterState(workspace: NovelWorkspaceData, chapterNumber: number, options: ProjectOptions = {}): CodexChapterState {
  const info = getNovelCodexProjectInfo(workspace, options);
  const { missing } = taskRequirements(workspace, chapterNumber);
  const generation = chapterGenerationGuard(workspace, chapterNumber);
  const generationState = { generationAllowed: generation.allowed, generationBlockedReason: generation.reason, nextWritableChapter: generation.nextChapter };
  if (!info.exists) return { phase: "not_initialized", projectExists: false, taskChapter: null, fileExists: false, fileModifiedAt: null, missing, ...generationState };

  const taskPath = path.join(info.projectDir, "当前任务.md");
  const taskText = fs.existsSync(taskPath) ? fs.readFileSync(taskPath, "utf8") : "";
  const taskMatch = taskText.match(/^# (?:当前任务：创作|DropMind 自动正文节点：)第(\d+)章(?:正文)?/m);
  const taskChapter = taskMatch ? Number(taskMatch[1]) : null;
  const pendingPath = pendingChapterPath(info.projectDir, chapterNumber);
  const taskModifiedAt = fs.existsSync(taskPath) ? fs.statSync(taskPath).mtimeMs : 0;
  const pendingIsCurrent = fs.existsSync(pendingPath) && (taskChapter !== chapterNumber || fs.statSync(pendingPath).mtimeMs >= taskModifiedAt);
  const databaseChapter = workspace.chapters.find((row) => Number(row.chapterNumber) === chapterNumber);
  const chapterFile = pendingIsCurrent ? { filePath: pendingPath, title: "" } : findChapterFile(info.projectDir, chapterNumber, String(databaseChapter?.title ?? ""));
  const structuredTaskPending = taskChapter === chapterNumber && taskText.startsWith(`# DropMind 自动正文节点：第${chapterNumber}章`) && !pendingIsCurrent;
  const fileExists = !structuredTaskPending && Boolean(chapterFile && fs.statSync(chapterFile.filePath).size > 0);
  const fileModifiedAt = fileExists && chapterFile ? fs.statSync(chapterFile.filePath).mtimeMs : null;
  const fileContent = fileExists && chapterFile ? fs.readFileSync(chapterFile.filePath, "utf8").trim() : "";
  const databaseContent = String(databaseChapter?.content ?? "").trim();
  const databaseTitle = normalizeChapterTitle(String(databaseChapter?.title ?? ""));

  let phase: CodexChapterPhase = "synced";
  if (fileExists && pendingIsCurrent) {
    try {
      const parsed = parseStructuredChapter(fileContent, chapterNumber);
      phase = databaseContent && parsed.content === databaseContent && parsed.title === databaseTitle ? "imported" : "file_ready";
    } catch {
      phase = "file_ready";
    }
  }
  else if (fileExists && databaseContent && fileContent === databaseContent) phase = "imported";
  else if (fileExists) phase = "file_ready";
  else if (taskChapter === chapterNumber) phase = "task_ready";
  return { phase, projectExists: true, taskChapter, fileExists, fileModifiedAt, missing, ...generationState };
}

export function prepareCodexChapterTask(workspace: NovelWorkspaceData, chapterNumber: number, options: ProjectOptions = {}) {
  const range = requiredTaskContent(workspace, chapterNumber);
  const info = syncNovelCodexProject(workspace, options);
  const previousChapter = chapterNumber > 1 ? workspace.chapters.find((row) => Number(row.chapterNumber) === chapterNumber - 1) : null;
  const previousFile = previousChapter ? findChapterFile(info.projectDir, chapterNumber - 1, String(previousChapter.title ?? "")) : null;
  const previous = previousFile
    ? `- 上一章正文：正文/${path.basename(previousFile.filePath)}`
    : "- 本章是第1章，没有上一章正文。";
  const outputFile = `待导入/第${chapterLabel(chapterNumber)}章.md`;
  const continuityPath = "当前任务连续性.md";
  const task = `# DropMind 自动正文节点：第${chapterNumber}章\n\n你只创作第${chapterNumber}章正文。小说资料已经保存在本地文件中，不要要求用户重复粘贴；记忆不确定、称谓不统一或发现冲突时，主动读取对应资料核对。连续性状态只是已确认正文的检索索引，若摘要与原文冲突，以已确认正文为准。\n\n## 本章必须读取\n\n- 正文创作要求：资料/正文创作要求.md\n- 本章剧情单元：资料/剧情单元/第${rangeLabel(range.start, range.end)}章.md\n- 本章分章大纲：资料/分章大纲/第${rangeLabel(range.start, range.end)}章.md\n${previous}\n- 当前任务的连续性基线：${continuityPath}\n\n## 其他资料位置（按需读取）\n\n- 小说目前的全局连续性状态：资料/连续性/当前状态.md（重写较早章节时可能包含未来信息，不得直接沿用）\n- 作品信息：资料/作品信息.md\n- 已选选题：资料/选题.md\n- 分卷大纲：资料/分卷大纲.md\n- 本卷大纲：资料/本卷大纲.md\n- 核心设定：资料/核心设定.md\n- 更早正文：正文/\n\n## 输出要求\n\n1. 从分章大纲中只定位并创作第${chapterNumber}章，不提前写下一章。\n2. 衔接上一章，保持人物、时间、地点、信息差、伏笔和情绪变化连续。\n3. 根据本章正文拟定一个准确、有吸引力且不剧透核心反转的章节标题，不包含“第X章”前缀，最多60个字符。\n4. 完整结果第一行必须是精确格式：<!-- DROPMIND_TITLE: 章节标题 -->\n5. 标题标记后输出可直接入库的纯正文，正文中不重复章节标题，不写过程说明或总结。\n6. 正文结束后另起一行输出精确标记：<!-- DROPMIND_CHAPTER_EVENT -->\n7. 事件标记后输出一份简短 Markdown，只记录本章实际新增、改变、推进或解决的连续性事件，并保留或引用已有伏笔编号。\n8. 事件之后另起一行输出精确标记：<!-- DROPMIND_CONTINUITY -->\n9. 连续性标记后输出完整的最新状态快照，第一行必须是“# 正文连续性状态”，第二行必须是精确标记“<!-- DROPMIND_STATE_THROUGH: ${chapterNumber} -->”，正文中再明确写出“截至第${chapterNumber}章”。状态只保留仍有效的当前时空、活跃人物状态与知情差、未解决线索、硬事实和下一章交接；未解决线索使用稳定编号，除非本章明确解决不得遗漏。已解决历史只留在本章事件中。\n10. 状态快照必须控制在20000个字符以内，不得把未来大纲写成已经发生的事实。\n11. 将从标题标记到状态快照末尾的完整结果原样保存到：${outputFile}。不得只保存正文，也不要写入“正文/”目录。\n12. 保存完成后，最终回复只报告文件路径与正文字符数，不要再次粘贴正文。\n`;
  const taskPath = path.join(info.projectDir, "当前任务.md");
  writeText(path.join(info.projectDir, continuityPath), `${taskContinuityContent(workspace, chapterNumber).trim()}\n`);
  writeText(taskPath, task);
  return { ...info, taskPath, command: "执行当前任务" };
}

export function writeCodexChapter(workspace: NovelWorkspaceData, chapterNumber: number, content: string, options: ProjectOptions = {}) {
  const info = syncNovelCodexProject(workspace, options);
  const chapter = workspace.chapters.find((row) => Number(row.chapterNumber) === chapterNumber);
  const filePath = path.join(info.projectDir, "正文", chapterFileName(chapterNumber, String(chapter?.title ?? "")));
  writeText(filePath, content.trim());
  return { ...info, filePath };
}

export function readCodexChapter(workspace: NovelWorkspaceData, chapterNumber: number, options: ProjectOptions = {}) {
  const info = getNovelCodexProjectInfo(workspace, options);
  const chapter = workspace.chapters.find((row) => Number(row.chapterNumber) === chapterNumber);
  const taskPath = path.join(info.projectDir, "当前任务.md");
  const taskText = fs.existsSync(taskPath) ? fs.readFileSync(taskPath, "utf8") : "";
  const isCurrentStructuredTask = taskText.startsWith(`# DropMind 自动正文节点：第${chapterNumber}章`);
  const pendingPath = pendingChapterPath(info.projectDir, chapterNumber);
  if (fs.existsSync(pendingPath)) {
    if (!isCurrentStructuredTask || fs.statSync(pendingPath).mtimeMs >= fs.statSync(taskPath).mtimeMs) {
      if (isCurrentStructuredTask) {
        const continuityPath = path.join(info.projectDir, "当前任务连续性.md");
        if (!fs.existsSync(continuityPath)) throw new Error(`当前任务缺少连续性基线：${continuityPath}`);
        const taskContinuity = fs.readFileSync(continuityPath, "utf8").trim();
        if (taskContinuity !== taskContinuityContent(workspace, chapterNumber).trim()) throw new Error("当前任务的连续性基线已经变化，请重新准备本章任务");
      }
      const raw = fs.readFileSync(pendingPath, "utf8");
      if (!raw.trim()) throw new Error(`待导入文件为空：${pendingPath}`);
      return { ...info, filePath: pendingPath, ...parseStructuredChapter(raw, chapterNumber) };
    }
  }
  if (isCurrentStructuredTask) throw new Error(`还没有找到本次任务的结构化结果：${pendingPath}`);
  const result = findChapterFile(info.projectDir, chapterNumber, String(chapter?.title ?? ""));
  if (!result) throw new Error(`还没有找到本地正文：${path.join(info.projectDir, "正文", `第${chapterLabel(chapterNumber)}章__<章节标题>.md`)}`);
  const { filePath } = result;
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) throw new Error(`本地正文文件为空：${filePath}`);
  return {
    ...info,
    filePath,
    title: normalizeChapterTitle(result.title || String(chapter?.title ?? "")),
    content,
    continuitySummary: undefined,
    continuityState: undefined,
    continuityRunId: undefined,
  };
}
