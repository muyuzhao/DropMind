import fs from "node:fs";
import path from "node:path";
import { rangeForChapter } from "./ranges";
import type { NovelWorkspace } from "./repository";

type ProjectOptions = { rootDir?: string };

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

function rangeLabel(start: number, end: number) {
  return `${chapterLabel(start)}-${chapterLabel(end)}`;
}

function markdown(title: string, content: string) {
  return `# ${title}\n\n${content.trim() || "（尚未保存）"}\n`;
}

function writeText(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function novelIdentity(workspace: NovelWorkspace) {
  return {
    id: String(workspace.novel.id),
    name: String(workspace.novel.name),
  };
}

export function getNovelCodexProjectInfo(workspace: NovelWorkspace, options: ProjectOptions = {}) {
  const { id, name } = novelIdentity(workspace);
  const rootDir = getNovelProjectsRoot(options);
  const suffix = `-${id.slice(0, 8)}`;
  let folderName = `${safeFolderName(name)}${suffix}`;
  if (fs.existsSync(rootDir)) {
    const existing = fs.readdirSync(rootDir, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.endsWith(suffix));
    if (existing) folderName = existing.name;
  }
  const projectDir = path.join(rootDir, folderName);
  return { projectDir, folderName, exists: fs.existsSync(projectDir) };
}

function stepContent(workspace: NovelWorkspace, key: string) {
  return String(workspace.steps.find((row) => row.key === key)?.content ?? "");
}

function draftInstruction(workspace: NovelWorkspace) {
  return String(workspace.templates.find((row) => row.key === "drafts")?.template ?? "");
}

function groupedChapterOutlines(workspace: NovelWorkspace) {
  const grouped = new Map<number, string>();
  for (const row of workspace.chapterOutlines) {
    const chapterNumber = Number(row.chapterNumber);
    const range = rangeForChapter(chapterNumber);
    const content = String(row.content ?? "");
    if (!grouped.has(range.start) || chapterNumber === range.start) grouped.set(range.start, content);
  }
  return grouped;
}

export function syncNovelCodexProject(workspace: NovelWorkspace, options: ProjectOptions = {}) {
  const info = getNovelCodexProjectInfo(workspace, options);
  const { projectDir } = info;
  const novel = workspace.novel;
  fs.mkdirSync(path.join(projectDir, "资料", "剧情单元"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "资料", "分章大纲"), { recursive: true });
  fs.mkdirSync(path.join(projectDir, "正文"), { recursive: true });

  writeText(path.join(projectDir, "AGENTS.override.md"), `# 小说正文创作项目\n\n- 本目录只用于创作当前小说，不修改 DropMind 程序代码。\n- 每次收到“执行当前任务”后，先完整读取《当前任务.md》及其中列出的资料。\n- 严格按任务指定章节创作，只写到结尾钩子，不提前创作下一章。\n- 正文必须保存到任务指定的文件；完成后只报告文件路径与正文字符数。\n- 若资料互相冲突或缺失，停止创作并指出具体文件。\n`);
  writeText(path.join(projectDir, "资料", "作品信息.md"), markdown("作品信息", `小说名称：${String(novel.name)}`));
  writeText(path.join(projectDir, "资料", "选题.md"), markdown("已选选题", String(novel.selectedTopic ?? "")));
  writeText(path.join(projectDir, "资料", "分卷大纲.md"), markdown("分卷大纲", stepContent(workspace, "volumes")));
  writeText(path.join(projectDir, "资料", "本卷大纲.md"), markdown("本卷大纲", String(novel.firstVolumeOutline ?? "")));
  writeText(path.join(projectDir, "资料", "核心设定.md"), markdown("小说核心设定", stepContent(workspace, "settings")));
  writeText(path.join(projectDir, "资料", "正文创作要求.md"), markdown("正文创作要求", draftInstruction(workspace)));

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
    const content = String(row.content ?? "").trim();
    const filePath = path.join(projectDir, "正文", `第${chapterLabel(chapterNumber)}章.md`);
    if (content && !fs.existsSync(filePath)) writeText(filePath, content);
  }
  return { ...info, exists: true };
}

function requiredTaskContent(workspace: NovelWorkspace, chapterNumber: number) {
  const range = rangeForChapter(chapterNumber);
  const missing: string[] = [];
  if (!stepContent(workspace, "settings").trim()) missing.push("核心设定");
  if (!String(workspace.novel.firstVolumeOutline ?? "").trim()) missing.push("本卷大纲");
  if (!draftInstruction(workspace).trim()) missing.push("正文创作要求");
  if (!workspace.storyUnits.some((row) => Number(row.startChapter) === range.start && String(row.content ?? "").trim())) missing.push(`第${range.start}-${range.end}章剧情单元`);
  if (!workspace.chapterOutlines.some((row) => Number(row.chapterNumber) === chapterNumber && String(row.content ?? "").trim())) missing.push(`第${chapterNumber}章分章大纲`);
  if (chapterNumber > 1 && !workspace.chapters.some((row) => Number(row.chapterNumber) === chapterNumber - 1 && String(row.content ?? "").trim())) missing.push(`第${chapterNumber - 1}章正文`);
  if (missing.length) throw new Error(`准备Codex任务前还缺少：${missing.join("、")}`);
  return range;
}

export function prepareCodexChapterTask(workspace: NovelWorkspace, chapterNumber: number, options: ProjectOptions = {}) {
  const range = requiredTaskContent(workspace, chapterNumber);
  const info = syncNovelCodexProject(workspace, options);
  const previous = chapterNumber > 1 ? `- 正文/第${chapterLabel(chapterNumber - 1)}章.md` : "- 本章为第一章，无上一章正文";
  const task = `# 当前任务：创作第${chapterNumber}章正文\n\n## 请按顺序读取\n\n- 资料/正文创作要求.md\n- 资料/核心设定.md\n- 资料/分卷大纲.md\n- 资料/本卷大纲.md\n- 资料/剧情单元/第${rangeLabel(range.start, range.end)}章.md\n- 资料/分章大纲/第${rangeLabel(range.start, range.end)}章.md\n${previous}\n\n## 本次任务\n\n1. 从分章大纲中定位第${chapterNumber}章，只创作这一章。\n2. 联系前文，确保人物、时间、地点、信息差和情绪变化连贯。\n3. 正文不要带章节标题，不写解释、总结或下一章内容。\n4. 将最终正文保存到：正文/第${chapterLabel(chapterNumber)}章.md\n5. 写到本章大纲的结尾钩子立即停止。\n`;
  const taskPath = path.join(info.projectDir, "当前任务.md");
  writeText(taskPath, task);
  return { ...info, taskPath, command: "执行当前任务" };
}

export function writeCodexChapter(workspace: NovelWorkspace, chapterNumber: number, content: string, options: ProjectOptions = {}) {
  const info = syncNovelCodexProject(workspace, options);
  const filePath = path.join(info.projectDir, "正文", `第${chapterLabel(chapterNumber)}章.md`);
  writeText(filePath, content.trim());
  return { ...info, filePath };
}

export function readCodexChapter(workspace: NovelWorkspace, chapterNumber: number, options: ProjectOptions = {}) {
  const info = getNovelCodexProjectInfo(workspace, options);
  const filePath = path.join(info.projectDir, "正文", `第${chapterLabel(chapterNumber)}章.md`);
  if (!fs.existsSync(filePath)) throw new Error(`还没有找到本地正文：${filePath}`);
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) throw new Error(`本地正文文件为空：${filePath}`);
  return { ...info, filePath, content };
}
