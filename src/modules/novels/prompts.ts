import type { StepKey } from "../../lib/novel-db/schema";
import { rangeForChapter } from "./ranges";
import { AUTOMATIC_CONTEXT_LABELS } from "./structured-prompts";

const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g;

export function templateFields(template: string) {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

export function renderPrompt(template: string, values: Record<string, string | number | undefined>) {
  const missing = templateFields(template).filter((field) => String(values[field] ?? "").trim() === "");
  if (missing.length) throw new Error(`缺少内容：${missing.join("、")}`);
  return template.replace(PLACEHOLDER, (_, field: string) => String(values[field]));
}

type WorkspaceLike = {
  novel: Record<string, unknown>;
  templates: Array<Record<string, unknown>>;
  steps: Array<Record<string, unknown>>;
  storyUnits: Array<Record<string, unknown>>;
  chapterOutlines: Array<Record<string, unknown>>;
  chapters: Array<Record<string, unknown>>;
};

export function buildPromptContext(workspace: WorkspaceLike, selection: { step: StepKey; rangeStart?: number; chapter?: number }) {
  const chapter = selection.step === "drafts"
    ? selection.chapter ?? 1
    : selection.rangeStart ?? selection.chapter ?? 1;
  const range = rangeForChapter(chapter);
  const stepContent = (key: string) => String(workspace.steps.find((row) => row.key === key)?.content ?? "");
  const storyUnit = String(workspace.storyUnits.find((row) => Number(row.startChapter) === range.start)?.content ?? "");
  const chapterOutline = String(workspace.chapterOutlines.find((row) => Number(row.chapterNumber) === chapter)?.content ?? "");
  const previousChapter = chapter === 1 ? "（第一章，无上一章正文）" : String(workspace.chapters.find((row) => Number(row.chapterNumber) === chapter - 1)?.content ?? "");
  const instruction = String(workspace.templates.find((row) => row.key === selection.step)?.template ?? "").trim();
  const contextByStep: Record<StepKey, Array<[string, string]>> = {
    topics: [["参考书名", String(workspace.novel.referenceTitle ?? "")], ["参考简介", String(workspace.novel.referenceSummary ?? "")]],
    volumes: [["已选选题", String(workspace.novel.selectedTopic ?? "")]],
    settings: [["已选选题", String(workspace.novel.selectedTopic ?? "")], ["分卷大纲", stepContent("volumes")]],
    units: [["本卷大纲", String(workspace.novel.firstVolumeOutline ?? "")], ["当前十章范围", `第${range.start}-${range.end}章`]],
    outlines: [["当前十章剧情单元", storyUnit], ["当前十章范围", `第${range.start}-${range.end}章`]],
    drafts: [["核心设定", stepContent("settings")], ["本卷大纲", String(workspace.novel.firstVolumeOutline ?? "")], ["当前剧情单元", storyUnit], ["当前章大纲", chapterOutline], ["上一章正文", previousChapter]],
  };
  const blocks = contextByStep[selection.step];
  const missing = blocks.filter(([, value]) => !value.trim()).map(([label]) => label);
  if (!instruction) missing.push("创作要求");
  const prompt = missing.length ? "" : [...blocks.map(([label, value]) => `【${label}】\n${value}`), `【创作要求】\n${instruction}`].join("\n\n");
  return { prompt, missing, automaticLabels: AUTOMATIC_CONTEXT_LABELS[selection.step] };
}
