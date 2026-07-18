"use server";

import { revalidatePath } from "next/cache";
import { createNovelBackup, exportVolumeText } from "@/modules/novels/backup";
import { prepareCodexChapterTask, readCodexChapter, syncNovelCodexProject, writeCodexChapter } from "@/modules/novels/codex-project";
import { novelRepository } from "@/modules/novels/repository";
import { chapterTaskSchema, createNovelSchema, saveChapterSchema, saveOutlineSchema, saveStepSchema, saveUnitSchema, saveWorkPositionSchema, setNovelSchemeSchema, updateNovelSchema, updateTemplateSchema } from "@/modules/novels/schemas";

function failure(error: unknown) { return { ok: false as const, error: error instanceof Error ? error.message : "操作失败" }; }

function workspaceFor(novelId: string) {
  const workspace = novelRepository.getNovelWorkspace(novelId);
  if (!workspace) throw new Error("小说不存在");
  return workspace;
}

function syncNovelFiles(novelId: string) {
  return syncNovelCodexProject(workspaceFor(novelId));
}

export async function createNovelAction(input: unknown) {
  try { const value=createNovelSchema.parse(input); const {schemeId,...novelInput}=value; const novel = novelRepository.createNovel(novelInput,schemeId); syncNovelFiles(String(novel.id)); revalidatePath("/novels"); return { ok: true as const, id: String(novel.id) }; } catch (error) { return failure(error); }
}

export async function createSchemeAction(input:{name:string;description:string;sourceSchemeId?:string}) { try { const scheme=novelRepository.createPromptScheme(input); revalidatePath("/novels/prompts"); return {ok:true as const,id:String(scheme.id)}; } catch(error){return failure(error);} }
export async function saveSchemeAction(input:{id:string;name:string;description:string}) { try { novelRepository.updatePromptScheme(input.id,input); revalidatePath("/novels/prompts"); return {ok:true as const}; } catch(error){return failure(error);} }
export async function saveSchemeTemplateAction(input:{id:string;key:import("@/lib/novel-db/schema").StepKey;template:string}) { try { novelRepository.updatePromptSchemeTemplate(input.id,input.key,input.template); revalidatePath("/novels/prompts"); return {ok:true as const}; } catch(error){return failure(error);} }
export async function defaultSchemeAction(id:string) { try { novelRepository.setDefaultPromptScheme(id); revalidatePath("/novels/prompts"); return {ok:true as const}; } catch(error){return failure(error);} }
export async function deleteSchemeAction(id:string) { try { novelRepository.deletePromptScheme(id); revalidatePath("/novels/prompts"); return {ok:true as const}; } catch(error){return failure(error);} }
export async function setNovelSchemeAction(input: unknown) { try { const value=setNovelSchemeSchema.parse(input); novelRepository.setNovelPromptScheme(value.novelId,value.schemeId); syncNovelFiles(value.novelId); revalidatePath(`/novels/${value.novelId}`); return {ok:true as const}; } catch(error){return failure(error);} }
export async function detachNovelSchemeAction(novelId:string) { try { novelRepository.detachNovelPromptScheme(novelId); syncNovelFiles(novelId); revalidatePath(`/novels/${novelId}`); return {ok:true as const}; } catch(error){return failure(error);} }
export async function updateNovelAction(input: unknown) {
  try { const { novelId, ...patch } = updateNovelSchema.parse(input); novelRepository.updateNovel(novelId, patch); syncNovelFiles(novelId); revalidatePath(`/novels/${novelId}`); return { ok: true as const }; } catch (error) { return failure(error); }
}
export async function saveWorkPositionAction(input: unknown) {
  try { const { novelId, ...position } = saveWorkPositionSchema.parse(input); novelRepository.updateNovel(novelId, position); revalidatePath("/novels"); return { ok: true as const }; } catch (error) { return failure(error); }
}
export async function saveStepAction(input: unknown) {
  try { const value = saveStepSchema.parse(input); novelRepository.saveStep(value.novelId, value.key, value.content, value.draft); syncNovelFiles(value.novelId); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const }; } catch (error) { return failure(error); }
}
export async function saveUnitAction(input: unknown) {
  try { const value = saveUnitSchema.parse(input); novelRepository.saveStoryUnit(value.novelId, value.startChapter, value.content, value.draft); syncNovelFiles(value.novelId); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const }; } catch (error) { return failure(error); }
}
export async function saveOutlineAction(input: unknown) {
  try { const value = saveOutlineSchema.parse(input); novelRepository.saveChapterOutline(value.novelId, value.chapterNumber, value.content, value.draft); if ((value.chapterNumber - 1) % 10 === 0) syncNovelFiles(value.novelId); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const }; } catch (error) { return failure(error); }
}
export async function saveChapterAction(input: unknown) {
  try { const value = saveChapterSchema.parse(input); novelRepository.saveChapter(value.novelId, value.chapterNumber, value.content, value.status, value.draft); writeCodexChapter(workspaceFor(value.novelId), value.chapterNumber, value.content); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const }; } catch (error) { return failure(error); }
}
export async function updateTemplateAction(input: unknown) {
  try { const value = updateTemplateSchema.parse(input); novelRepository.updateTemplate(value.novelId, value.key, value.template); if (value.key === "drafts") syncNovelFiles(value.novelId); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const }; } catch (error) { return failure(error); }
}
export async function syncCodexProjectAction(novelId: string) {
  try { const info = syncNovelFiles(novelId); revalidatePath(`/novels/${novelId}`); return { ok: true as const, projectDir: info.projectDir }; } catch (error) { return failure(error); }
}
export async function prepareCodexChapterTaskAction(input: unknown) {
  try { const value = chapterTaskSchema.parse(input); const result = prepareCodexChapterTask(workspaceFor(value.novelId), value.chapterNumber); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const, projectDir: result.projectDir, taskPath: result.taskPath, command: result.command }; } catch (error) { return failure(error); }
}
export async function importCodexChapterAction(input: unknown) {
  try { const value = chapterTaskSchema.parse(input); const result = readCodexChapter(workspaceFor(value.novelId), value.chapterNumber); novelRepository.saveChapter(value.novelId, value.chapterNumber, result.content, "saved", false); revalidatePath(`/novels/${value.novelId}`); return { ok: true as const, content: result.content, filePath: result.filePath }; } catch (error) { return failure(error); }
}
export async function deleteNovelAction(input: { novelId: string; confirmation: string }) {
  try { const novel = novelRepository.getNovel(input.novelId); if (!novel || novel.name !== input.confirmation) throw new Error("小说名称不匹配"); novelRepository.deleteNovel(input.novelId); revalidatePath("/novels"); return { ok: true as const }; } catch (error) { return failure(error); }
}
export async function exportNovelAction(novelId: string, type: "json" | "txt") {
  try { const workspace = novelRepository.getNovelWorkspace(novelId); if (!workspace) throw new Error("小说不存在"); const content = type === "json" ? createNovelBackup(workspace) : exportVolumeText(workspace.chapters as Array<{ chapterNumber: number; content: string }>); return { ok: true as const, content }; } catch (error) { return failure(error); }
}
