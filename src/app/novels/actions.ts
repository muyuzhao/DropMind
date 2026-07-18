"use server";

import { revalidatePath } from "next/cache";
import { createNovelBackup, exportVolumeText, parseNovelBackup } from "@/modules/novels/backup";
import { inspectCodexChapterState, prepareCodexChapterTask, readCodexChapter, syncNovelCodexProject, writeCodexChapter } from "@/modules/novels/codex-project";
import { novelRepository } from "@/modules/novels/repository";
import {
  chapterTaskSchema, createNovelSchema, createSchemeSchema, idSchema, importCodexChapterSchema,
  saveChapterSchema, saveOutlineBatchSchema, saveSchemeSchema, saveSchemeTemplateSchema,
  saveStepSchema, saveUnitSchema, saveWorkPositionSchema, setNovelSchemeSchema,
  updateNovelSchema, updateTemplateSchema, restoreContentVersionSchema,
  updateChapterStatusSchema,
} from "@/modules/novels/schemas";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
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
  return syncNovelCodexProject(workspaceFor(novelId));
}

function syncWarning(novelId: string) {
  try {
    syncNovelFiles(novelId);
    return null;
  } catch (error) {
    return `内容已保存，但 Codex 目录同步失败：${errorMessage(error)}`;
  }
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
    novelRepository.saveChapter(value.novelId, value.chapterNumber, value.content, value.status, value.draft);
    let warning: string | null = null;
    try { writeCodexChapter(workspaceFor(value.novelId), value.chapterNumber, value.content); } catch (error) { warning = `正文已保存，但 Codex 文件写入失败：${errorMessage(error)}`; }
    revalidatePath(`/novels/${value.novelId}`);
    return { ok: true as const, warning };
  } catch (error) { return failure(error); }
}

export async function updateChapterStatusAction(input: unknown) {
  try { const value = updateChapterStatusSchema.parse(input); novelRepository.updateChapterStatus(value.novelId, value.chapterNumber, value.status); revalidatePath(`/novels/${value.novelId}`); revalidatePath("/novels"); return { ok: true as const }; } catch (error) { return failure(error); }
}

export async function updateTemplateAction(input: unknown) {
  try { const value = updateTemplateSchema.parse(input); novelRepository.updateTemplate(value.novelId, value.key, value.template); const warning = value.key === "drafts" ? syncWarning(value.novelId) : null; revalidatePath(`/novels/${value.novelId}`); return { ok: true as const, warning }; } catch (error) { return failure(error); }
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
    return { ok: true as const, content: result.content, filePath: result.filePath, databaseContent: String(current?.content ?? ""), databaseUpdatedAt: current?.updatedAt ? Number(current.updatedAt) : null };
  } catch (error) { return failure(error); }
}

export async function importCodexChapterAction(input: unknown) {
  try {
    const value = importCodexChapterSchema.parse(input);
    const result = readCodexChapter(workspaceFor(value.novelId), value.chapterNumber);
    if (result.content !== value.expectedFileContent) throw new Error("Codex 正文文件在确认期间发生了变化，请重新读取后再导入");
    novelRepository.importCodexChapter(value.novelId, value.chapterNumber, result.content, value.expectedUpdatedAt, value.expectedDatabaseContent);
    revalidatePath(`/novels/${value.novelId}`);
    return { ok: true as const, content: result.content, filePath: result.filePath };
  } catch (error) { return failure(error); }
}

export async function deleteNovelAction(input: { novelId: string; confirmation: string }) {
  try { const novelId = idSchema.parse(input.novelId); const novel = novelRepository.getNovel(novelId); if (!novel || novel.name !== input.confirmation) throw new Error("小说名称不匹配"); novelRepository.deleteNovel(novelId); revalidatePath("/novels"); return { ok: true as const }; } catch (error) { return failure(error); }
}

export async function exportNovelAction(input: unknown, type: "json" | "txt") {
  try { const novelId = idSchema.parse(input); const workspace = novelRepository.getNovelWorkspace(novelId); if (!workspace) throw new Error("小说不存在"); const content = type === "json" ? createNovelBackup(workspace) : exportVolumeText(workspace.chapters as Array<{ chapterNumber: number; content: string }>); return { ok: true as const, content }; } catch (error) { return failure(error); }
}
