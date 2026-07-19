"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { createNovelBackup, exportVolumeText, parseNovelBackup } from "@/modules/novels/backup";
import { createAutomationRun, getLatestAutomationRun, importCompletedAutomationNodes, listAutomationRuns, readAutomationArtifact, readAutomationManifest, reconcileAutomationStaleness, recoverInterruptedAutomationRun, refreshAutomationRunnerFiles, requestAutomationControl, restartAutomationFromNode, seedAutomationRunFromWorkspace } from "@/modules/novels/automation";
import { createChapterAutomationRun, getLatestChapterAutomationRun, importCompletedChapterAutomationRun, listChapterAutomationRuns, readChapterAutomationArtifact, readChapterAutomationManifest, reconcileChapterAutomationStaleness, recoverInterruptedChapterAutomationRun, refreshChapterAutomationRunnerFiles, requestChapterAutomationControl } from "@/modules/novels/chapter-automation";
import { inspectCodexChapterState, prepareCodexChapterTask, readCodexChapter, syncNovelCodexProject, writeCodexChapter } from "@/modules/novels/codex-project";
import { deliveryRepository } from "@/modules/novels/delivery";
import { cancelDeliverySchema, queueDeliverySchema, saveDeliveryTargetSchema } from "@/modules/novels/delivery-schemas";
import { novelRepository } from "@/modules/novels/repository";
import {
  chapterTaskSchema, createChapterAutomationSchema, createNovelSchema, createSchemeSchema, idSchema, importCodexChapterSchema,
  saveChapterSchema, saveOutlineBatchSchema, saveSchemeSchema, saveSchemeTemplateSchema,
  saveStepSchema, saveUnitSchema, saveWorkPositionSchema, setNovelSchemeSchema,
  updateNovelSchema, updateTemplateSchema, restoreContentVersionSchema,
  updateChapterStatusSchema,
} from "@/modules/novels/schemas";

function errorMessage(error: unknown) {
  if (error instanceof ZodError) return error.issues.map((issue) => issue.message).join("；");
  return error instanceof Error ? error.message : "操作失败";
}

function databaseTimestamp(value: unknown) {
  if (value === undefined || value === null) return null;
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp)) throw new Error("本章更新时间数据异常，请刷新页面后重试");
  return timestamp;
}

function failure(error: unknown) {
  return { ok: false as const, error: errorMessage(error) };
}

function workspaceFor(novelId: string) {
  const workspace = novelRepository.getNovelWorkspace(novelId);
  if (!workspace) throw new Error("小说不存在");
  return workspace;
}

function syncNovelFiles(novelId: string) {
  const workspace = workspaceFor(novelId);
  const info = syncNovelCodexProject(workspace);
  for (const run of listAutomationRuns(workspace)) refreshAutomationRunnerFiles(run.runDir, run.manifest, { novelName: String(workspace.novel.name) });
  for (const run of listChapterAutomationRuns(workspace)) refreshChapterAutomationRunnerFiles(run.runDir, run.manifest);
  return info;
}

function syncWarning(novelId: string) {
  try {
    syncNovelFiles(novelId);
    return null;
  } catch (error) {
    return `内容已保存，但 Codex 目录同步失败：${errorMessage(error)}`;
  }
}

function automationRun(novelId: string, runId: string) {
  const workspace = workspaceFor(novelId);
  const run = listAutomationRuns(workspace).find((item) => item.manifest.runId === runId);
  if (!run) throw new Error("自动生成任务不存在");
  refreshAutomationRunnerFiles(run.runDir, run.manifest);
  return { workspace, ...run };
}

function chapterAutomationRun(novelId: string, runId: string) {
  const workspace = workspaceFor(novelId);
  const run = listChapterAutomationRuns(workspace).find((item) => item.manifest.runId === runId);
  if (!run) throw new Error("正文自动生成任务不存在");
  refreshChapterAutomationRunnerFiles(run.runDir, run.manifest);
  return { workspace, ...run };
}

export async function createNovelAction(input: unknown) {
  try {
    const value = createNovelSchema.parse(input);
    const { schemeId, ...novelInput } = value;
    const novel = novelRepository.createNovel(novelInput, schemeId);
    const warning = syncWarning(String(novel.id));
    revalidatePath("/novels");
    return { ok: true as const, id: String(novel.id), warning };
  } catch (error) { return failure(error); }
}

export async function importNovelBackupAction(json: unknown) {
  try {
    if (typeof json !== "string") throw new Error("请选择 JSON 备份文件");
    const backup = parseNovelBackup(json);
    const novel = novelRepository.importNovelBackup(backup.workspace);
    const warning = syncWarning(String(novel.id));
    revalidatePath("/novels");
    return { ok: true as const, id: String(novel.id), warning };
  } catch (error) { return failure(error); }
}

export async function createSchemeAction(input: unknown) {
  try { const value = createSchemeSchema.parse(input); const scheme = novelRepository.createPromptScheme(value); revalidatePath("/novels/prompts"); return { ok: true as const, id: String(scheme.id) }; } catch (error) { return failure(error); }
}

export async function saveSchemeAction(input: unknown) {
  try { const value = saveSchemeSchema.parse(input); novelRepository.updatePromptScheme(value.id, value); revalidatePath("/novels/prompts"); return { ok: true as const }; } catch (error) { return failure(error); }
}

export async function saveSchemeTemplateAction(input: unknown) {
  try { const value = saveSchemeTemplateSchema.parse(input); novelRepository.updatePromptSchemeTemplate(value.id, value.key, value.template); revalidatePath("/novels/prompts"); return { ok: true as const }; } catch (error) { return failure(error); }
}

export async function defaultSchemeAction(input: unknown) {
  try { const id = idSchema.parse(input); novelRepository.setDefaultPromptScheme(id); revalidatePath("/novels/prompts"); return { ok: true as const }; } catch (error) { return failure(error); }
}

export async function deleteSchemeAction(input: unknown) {
  try { const id = idSchema.parse(input); novelRepository.deletePromptScheme(id); revalidatePath("/novels/prompts"); return { ok: true as const }; } catch (error) { return failure(error); }
}

export async function setNovelSchemeAction(input: unknown) {
  try { const value = setNovelSchemeSchema.parse(input); novelRepository.setNovelPromptScheme(value.novelId, value.schemeId); const warning = syncWarning(value.novelId); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const, warning }; } catch (error) { return failure(error); }
}

export async function detachNovelSchemeAction(input: unknown) {
  try { const novelId = idSchema.parse(input); novelRepository.detachNovelPromptScheme(novelId); const warning = syncWarning(novelId); revalidatePath(`/novels/${novelId}`); return { ok: true as const, warning }; } catch (error) { return failure(error); }
}

export async function updateNovelAction(input: unknown) {
  try { const { novelId, ...patch } = updateNovelSchema.parse(input); novelRepository.updateNovel(novelId, patch); const warning = syncWarning(novelId); revalidatePath(`/novels/${novelId}`); return { ok: true as const, warning }; } catch (error) { return failure(error); }
}

export async function saveWorkPositionAction(input: unknown) {
  try { const { novelId, ...position } = saveWorkPositionSchema.parse(input); novelRepository.updateNovel(novelId, position); revalidatePath("/novels"); return { ok: true as const }; } catch (error) { return failure(error); }
}

export async function saveStepAction(input: unknown) {
  try { const value = saveStepSchema.parse(input); novelRepository.saveStep(value.novelId, value.key, value.content, value.draft); const warning = syncWarning(value.novelId); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const, warning }; } catch (error) { return failure(error); }
}

export async function saveUnitAction(input: unknown) {
  try { const value = saveUnitSchema.parse(input); novelRepository.saveStoryUnit(value.novelId, value.startChapter, value.content, value.draft); const warning = syncWarning(value.novelId); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const, warning }; } catch (error) { return failure(error); }
}

export async function saveOutlineBatchAction(input: unknown) {
  try { const value = saveOutlineBatchSchema.parse(input); novelRepository.saveChapterOutlineBatch(value.novelId, value.startChapter, value.content, value.draft); const warning = syncWarning(value.novelId); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const, warning }; } catch (error) { return failure(error); }
}

export async function saveChapterAction(input: unknown) {
  try {
    const value = saveChapterSchema.parse(input);
    novelRepository.saveChapter(value.novelId, value.chapterNumber, value.content, value.status, value.draft, value.title);
    let warning: string | null = null;
    try { writeCodexChapter(workspaceFor(value.novelId), value.chapterNumber, value.content); } catch (error) { warning = `正文已保存，但 Codex 文件写入失败：${errorMessage(error)}`; }
    revalidatePath(`/novels/${value.novelId}`);
    return { ok: true as const, warning };
  } catch (error) { return failure(error); }
}

export async function updateChapterStatusAction(input: unknown) {
  try { const value = updateChapterStatusSchema.parse(input); novelRepository.updateChapterStatus(value.novelId, value.chapterNumber, value.status); revalidatePath(`/novels/${value.novelId}`); revalidatePath("/novels"); return { ok: true as const }; } catch (error) { return failure(error); }
}

export async function getNovelDeliveryStateAction(input: unknown) {
  try { const novelId = idSchema.parse(input); return { ok: true as const, state: deliveryRepository.getNovelState(novelId) }; } catch (error) { return failure(error); }
}

export async function saveDeliveryTargetAction(input: unknown) {
  try {
    const value = saveDeliveryTargetSchema.parse(input);
    const target = deliveryRepository.saveTarget(value);
    revalidatePath(`/novels/${value.novelId}`);
    return { ok: true as const, target };
  } catch (error) { return failure(error); }
}

export async function queueChapterDeliveryAction(input: unknown) {
  try {
    const value = queueDeliverySchema.parse(input);
    const job = deliveryRepository.queueChapter(value.novelId, value.chapterNumber);
    revalidatePath(`/novels/${value.novelId}`);
    return { ok: true as const, job };
  } catch (error) { return failure(error); }
}

export async function cancelChapterDeliveryAction(input: unknown) {
  try {
    const value = cancelDeliverySchema.parse(input);
    const job = deliveryRepository.cancelJob(value.novelId, value.jobId);
    revalidatePath(`/novels/${value.novelId}`);
    return { ok: true as const, job };
  } catch (error) { return failure(error); }
}

export async function updateTemplateAction(input: unknown) {
  try { const value = updateTemplateSchema.parse(input); novelRepository.updateTemplate(value.novelId, value.key, value.template); const warning = value.key === "drafts" || value.key === "cover" ? syncWarning(value.novelId) : null; revalidatePath(`/novels/${value.novelId}`); return { ok: true as const, warning }; } catch (error) { return failure(error); }
}

export async function restoreContentVersionAction(input: unknown) {
  try {
    const value = restoreContentVersionSchema.parse(input);
    const version = novelRepository.restoreContentVersion(value.novelId, value.versionId);
    let warning: string | null = null;
    if (version.contentType === "chapter") {
      try { writeCodexChapter(workspaceFor(value.novelId), Number(version.contentKey), version.content); }
      catch (error) { warning = `内容已恢复，但 Codex 文件写入失败：${errorMessage(error)}`; }
    } else warning = syncWarning(value.novelId);
    revalidatePath(`/novels/${value.novelId}`);
    return { ok: true as const, version, warning };
  } catch (error) { return failure(error); }
}

export async function syncCodexProjectAction(input: unknown) {
  try { const novelId = idSchema.parse(input); const info = syncNovelFiles(novelId); revalidatePath(`/novels/${novelId}`); return { ok: true as const, projectDir: info.projectDir }; } catch (error) { return failure(error); }
}

export async function prepareCodexChapterTaskAction(input: unknown) {
  try { const value = chapterTaskSchema.parse(input); const result = prepareCodexChapterTask(workspaceFor(value.novelId), value.chapterNumber); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const, projectDir: result.projectDir, taskPath: result.taskPath, command: result.command }; } catch (error) { return failure(error); }
}

export async function inspectCodexChapterAction(input: unknown) {
  try { const value = chapterTaskSchema.parse(input); return { ok: true as const, state: inspectCodexChapterState(workspaceFor(value.novelId), value.chapterNumber) }; } catch (error) { return failure(error); }
}

export async function previewCodexChapterAction(input: unknown) {
  try {
    const value = chapterTaskSchema.parse(input);
    const workspace = workspaceFor(value.novelId);
    const result = readCodexChapter(workspace, value.chapterNumber);
    const current = workspace.chapters.find((row) => Number(row.chapterNumber) === value.chapterNumber);
    return { ok: true as const, title: result.title, content: result.content, filePath: result.filePath, databaseTitle: String(current?.title ?? ""), databaseContent: String(current?.content ?? ""), databaseUpdatedAt: databaseTimestamp(current?.updatedAt) };
  } catch (error) { return failure(error); }
}

export async function importCodexChapterAction(input: unknown) {
  try {
    const value = importCodexChapterSchema.parse(input);
    const result = readCodexChapter(workspaceFor(value.novelId), value.chapterNumber);
    if (result.title !== value.expectedFileTitle || result.content !== value.expectedFileContent) throw new Error("Codex 章节标题或正文文件在确认期间发生了变化，请重新读取后再导入");
    novelRepository.importCodexChapter(value.novelId, value.chapterNumber, result.title, result.content, value.expectedUpdatedAt, value.expectedDatabaseTitle, value.expectedDatabaseContent);
    revalidatePath(`/novels/${value.novelId}`);
    return { ok: true as const, title: result.title, content: result.content, filePath: result.filePath };
  } catch (error) { return failure(error); }
}

export async function createAutomationRunAction(input: unknown) {
  try {
    const novelId = idSchema.parse(input);
    const workspace = workspaceFor(novelId);
    const latest = getLatestAutomationRun(workspace);
    if (latest && (["pending", "running", "paused"].includes(latest.manifest.status) || latest.manifest.nodes.some((node) => node.status === "completed" && !node.imported))) throw new Error("已有未结束或待导入的自动生成任务，请继续处理后再创建新任务");
    const result = createAutomationRun(workspace);
    revalidatePath(`/novels/${novelId}`);
    return { ok: true as const, runDir: result.runDir, manifest: result.manifest, seededCount: result.seededCount };
  } catch (error) { return failure(error); }
}

export async function inspectAutomationRunAction(input: unknown, options: { importPaused?: boolean } = {}) {
  try {
    const novelId = idSchema.parse(input);
    let workspace = workspaceFor(novelId);
    const latest = getLatestAutomationRun(workspace);
    if (!latest) return { ok: true as const, run: null };
    const seededCount = seedAutomationRunFromWorkspace(latest.runDir, latest.manifest, workspace);
    refreshAutomationRunnerFiles(latest.runDir, latest.manifest);
    let importedCount = 0;
    // The runner owns manifest writes while active. Import only at a stable boundary
    // so runner status updates cannot overwrite imported hashes or refreshed snapshots.
    if (latest.manifest.status !== "running" && latest.manifest.status !== "pending" && (latest.manifest.status !== "paused" || options.importPaused)) {
      reconcileAutomationStaleness(latest.runDir, latest.manifest, workspace);
      importedCount = importCompletedAutomationNodes(latest.runDir, latest.manifest, workspace, novelRepository);
    }
    if (importedCount) {
      workspace = workspaceFor(novelId);
      revalidatePath(`/novels/${novelId}`);
    }
    const manifest = readAutomationManifest(latest.runDir);
    return { ok: true as const, run: { runDir: latest.runDir, manifest, importedCount, seededCount } };
  } catch (error) { return failure(error); }
}

export async function controlAutomationRunAction(input: { novelId: unknown; runId: unknown; action: unknown; nodeId?: unknown }) {
  try {
    const novelId = idSchema.parse(input.novelId);
    if (typeof input.runId !== "string" || !input.runId.trim()) throw new Error("任务编号无效");
    if (input.action !== "run" && input.action !== "pause" && input.action !== "terminate" && input.action !== "retry") throw new Error("任务操作无效");
    const run = automationRun(novelId, input.runId);
    const result = input.action === "retry"
      ? requestAutomationControl(run.runDir, "run", { mode: "retry-node", targetNodeId: typeof input.nodeId === "string" ? input.nodeId : null })
      : requestAutomationControl(run.runDir, input.action);
    return { ok: true as const, manifest: result.manifest };
  } catch (error) { return failure(error); }
}

export async function recoverInterruptedAutomationRunAction(input: { novelId: unknown; runId: unknown }) {
  try {
    const novelId = idSchema.parse(input.novelId);
    if (typeof input.runId !== "string" || !input.runId.trim()) throw new Error("任务编号无效");
    const run = automationRun(novelId, input.runId);
    return { ok: true as const, manifest: recoverInterruptedAutomationRun(run.runDir) };
  } catch (error) { return failure(error); }
}

export async function restartAutomationFromNodeAction(input: { novelId: unknown; runId: unknown; nodeId: unknown }) {
  try {
    const novelId = idSchema.parse(input.novelId);
    if (typeof input.runId !== "string" || typeof input.nodeId !== "string") throw new Error("任务参数无效");
    const run = automationRun(novelId, input.runId);
    const result = restartAutomationFromNode(run.runDir, input.nodeId, workspaceFor(novelId));
    return { ok: true as const, manifest: result.manifest };
  } catch (error) { return failure(error); }
}

export async function previewAutomationArtifactAction(input: { novelId: unknown; runId: unknown; nodeId: unknown; artifact: unknown }) {
  try {
    const novelId = idSchema.parse(input.novelId);
    if (typeof input.runId !== "string" || typeof input.nodeId !== "string" || (input.artifact !== "output" && input.artifact !== "log")) throw new Error("任务文件参数无效");
    const run = automationRun(novelId, input.runId);
    return { ok: true as const, ...readAutomationArtifact(run.runDir, input.nodeId, input.artifact) };
  } catch (error) { return failure(error); }
}

export async function createChapterAutomationRunAction(input: unknown) {
  try {
    const value = createChapterAutomationSchema.parse(input);
    let workspace = workspaceFor(value.novelId);
    const latest = getLatestChapterAutomationRun(workspace);
    if (latest && (["pending", "running", "paused"].includes(latest.manifest.status) || (latest.manifest.status === "completed" && latest.manifest.nodes.some((node) => !node.imported)))) {
      throw new Error("已有未结束或待导入的正文任务，请先继续处理");
    }
    syncNovelFiles(value.novelId);
    workspace = workspaceFor(value.novelId);
    const result = createChapterAutomationRun(workspace, value);
    revalidatePath(`/novels/${value.novelId}`);
    return { ok: true as const, runDir: result.runDir, manifest: result.manifest };
  } catch (error) { return failure(error); }
}

export async function inspectChapterAutomationRunAction(input: unknown) {
  try {
    const novelId = idSchema.parse(input);
    let workspace = workspaceFor(novelId);
    const latest = getLatestChapterAutomationRun(workspace);
    if (!latest) return { ok: true as const, run: null };
    refreshChapterAutomationRunnerFiles(latest.runDir, latest.manifest);
    let importedCount = 0;
    let importedChapters: Array<{ chapterNumber: number; title: string; content: string }> = [];
    let warning: string | null = null;
    if (latest.manifest.status !== "running" && latest.manifest.status !== "pending") {
      reconcileChapterAutomationStaleness(latest.runDir, latest.manifest, workspace);
      const imported = importCompletedChapterAutomationRun(latest.runDir, latest.manifest, workspace, novelRepository);
      importedCount = imported.importedCount;
      importedChapters = imported.chapters;
      if (importedCount) {
        workspace = workspaceFor(novelId);
        try {
          for (const chapter of imported.chapters) writeCodexChapter(workspace, chapter.chapterNumber, chapter.content);
        } catch (error) {
          warning = `正文已导入数据库，但本地正文文件同步失败：${errorMessage(error)}`;
        }
        revalidatePath(`/novels/${novelId}`);
        revalidatePath("/novels");
      }
    }
    return { ok: true as const, run: { runDir: latest.runDir, manifest: readChapterAutomationManifest(latest.runDir), importedCount, importedChapters, warning } };
  } catch (error) { return failure(error); }
}

export async function controlChapterAutomationRunAction(input: { novelId: unknown; runId: unknown; action: unknown; nodeId?: unknown }) {
  try {
    const novelId = idSchema.parse(input.novelId);
    if (typeof input.runId !== "string" || !input.runId.trim()) throw new Error("任务编号无效");
    if (input.action !== "run" && input.action !== "pause" && input.action !== "terminate" && input.action !== "retry") throw new Error("任务操作无效");
    const run = chapterAutomationRun(novelId, input.runId);
    const manifest = input.action === "retry"
      ? requestChapterAutomationControl(run.runDir, "run", { mode: "retry-node", targetNodeId: typeof input.nodeId === "string" ? input.nodeId : null })
      : requestChapterAutomationControl(run.runDir, input.action);
    return { ok: true as const, manifest };
  } catch (error) { return failure(error); }
}

export async function recoverInterruptedChapterAutomationRunAction(input: { novelId: unknown; runId: unknown }) {
  try {
    const novelId = idSchema.parse(input.novelId);
    if (typeof input.runId !== "string" || !input.runId.trim()) throw new Error("任务编号无效");
    const run = chapterAutomationRun(novelId, input.runId);
    return { ok: true as const, manifest: recoverInterruptedChapterAutomationRun(run.runDir) };
  } catch (error) { return failure(error); }
}

export async function previewChapterAutomationArtifactAction(input: { novelId: unknown; runId: unknown; nodeId: unknown; artifact: unknown }) {
  try {
    const novelId = idSchema.parse(input.novelId);
    if (typeof input.runId !== "string" || typeof input.nodeId !== "string" || (input.artifact !== "output" && input.artifact !== "log")) throw new Error("任务文件参数无效");
    const run = chapterAutomationRun(novelId, input.runId);
    return { ok: true as const, ...readChapterAutomationArtifact(run.runDir, input.nodeId, input.artifact) };
  } catch (error) { return failure(error); }
}

export async function deleteNovelAction(input: { novelId: string; confirmation: string }) {
  try { const novelId = idSchema.parse(input.novelId); const novel = novelRepository.getNovel(novelId); if (!novel || novel.name !== input.confirmation) throw new Error("小说名称不匹配"); novelRepository.deleteNovel(novelId); revalidatePath("/novels"); return { ok: true as const }; } catch (error) { return failure(error); }
}

export async function exportNovelAction(input: unknown, type: "json" | "txt") {
  try { const novelId = idSchema.parse(input); const workspace = novelRepository.getNovelWorkspace(novelId); if (!workspace) throw new Error("小说不存在"); const content = type === "json" ? createNovelBackup(workspace) : exportVolumeText(workspace.chapters as Array<{ chapterNumber: number; content: string }>); return { ok: true as const, content }; } catch (error) { return failure(error); }
}
