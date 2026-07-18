import { stepKeyValues, type StepKey } from "../../lib/novel-db/schema";
import { TEN_CHAPTER_RANGES } from "./ranges";

export type WorkPosition = {
  step: StepKey;
  rangeStart: number;
  chapter: number;
};

type ContentRow = { content?: string; isDraft?: boolean | number };
export type ProgressInput = {
  novel: { selectedTopic?: string; firstVolumeOutline?: string };
  steps: Array<ContentRow & { key?: StepKey }>;
  storyUnits: Array<ContentRow & { startChapter?: number }>;
  chapterOutlines: Array<ContentRow & { chapterNumber?: number }>;
  chapters: Array<ContentRow & { chapterNumber?: number }>;
};

function hasSavedContent(row: ContentRow | undefined) {
  if (!String(row?.content ?? "").trim()) return false;
  return row?.isDraft !== true && Number(row?.isDraft ?? 0) !== 1;
}

export function normalizeWorkPosition(input: Partial<WorkPosition>): WorkPosition {
  const step = stepKeyValues.includes(input.step as StepKey) ? input.step as StepKey : "topics";
  const requestedRange = Number(input.rangeStart ?? 1);
  const rangeStart = TEN_CHAPTER_RANGES.some((range) => range.start === requestedRange) ? requestedRange : 1;
  const requestedChapter = Number(input.chapter ?? 1);
  const chapter = Number.isInteger(requestedChapter) && requestedChapter >= 1 && requestedChapter <= 60 ? requestedChapter : 1;
  return { step, rangeStart, chapter };
}

export function nextWorkPosition(position: WorkPosition): WorkPosition | null {
  if (position.step === "topics") return { step: "volumes", rangeStart: 1, chapter: 1 };
  if (position.step === "volumes") return { step: "settings", rangeStart: 1, chapter: 1 };
  if (position.step === "settings") return { step: "units", rangeStart: 1, chapter: 1 };
  if (position.step === "units") {
    return position.rangeStart < 51 ? { ...position, rangeStart: position.rangeStart + 10 } : { step: "outlines", rangeStart: 1, chapter: 1 };
  }
  if (position.step === "outlines") {
    return position.rangeStart < 51 ? { ...position, rangeStart: position.rangeStart + 10 } : { step: "drafts", rangeStart: 1, chapter: 1 };
  }
  if (position.step === "drafts") {
    return position.chapter < 60 ? { ...position, chapter: position.chapter + 1 } : null;
  }
  return null;
}

export function nextWorkActionLabel(position: WorkPosition) {
  const next = nextWorkPosition(position);
  if (!next) return null;
  if (next.step !== position.step) return `保存并进入${stepKeyValues.indexOf(next.step) + 1 === 6 ? "正文" : `第${stepKeyValues.indexOf(next.step) + 1}步`}`;
  return position.step === "drafts" ? "保存并进入下一章" : "保存并进入下一批";
}

export function formatWorkPosition(position: WorkPosition) {
  const stepNumber = stepKeyValues.indexOf(position.step) + 1;
  if (position.step === "units" || position.step === "outlines") {
    return `继续第${stepNumber}步 · ${position.rangeStart}-${position.rangeStart + 9}章`;
  }
  if (position.step === "drafts") return `继续第${stepNumber}步 · 第${position.chapter}章`;
  return `继续第${stepNumber}步`;
}

export function buildWorkflowProgress(input: ProgressInput): Record<StepKey, { completed: number; total: number }> {
  const savedStep = (key: StepKey) => hasSavedContent(input.steps.find((row) => row.key === key));
  const unitStarts = new Set(input.storyUnits.filter(hasSavedContent).map((row) => Number(row.startChapter)));
  const outlineStarts = new Set(input.chapterOutlines.filter(hasSavedContent).map((row) => Number(row.chapterNumber)));
  const completedChapters = new Set(input.chapters.filter(hasSavedContent).map((row) => Number(row.chapterNumber)));

  return {
    topics: { completed: Number(savedStep("topics")) + Number(Boolean(String(input.novel.selectedTopic ?? "").trim())), total: 2 },
    volumes: { completed: Number(savedStep("volumes")) + Number(Boolean(String(input.novel.firstVolumeOutline ?? "").trim())), total: 2 },
    settings: { completed: savedStep("settings") ? 1 : 0, total: 1 },
    units: { completed: TEN_CHAPTER_RANGES.filter((range) => unitStarts.has(range.start)).length, total: 6 },
    outlines: { completed: TEN_CHAPTER_RANGES.filter((range) => outlineStarts.has(range.start)).length, total: 6 },
    drafts: { completed: Array.from({ length: 60 }, (_, index) => index + 1).filter((chapter) => completedChapters.has(chapter)).length, total: 60 },
  };
}

export type WorkflowStepState = "blocked" | "ready" | "in_progress" | "complete";
export type WorkflowStepOverview = { state: WorkflowStepState; reason: string; completed: number; total: number };

export function buildWorkflowOverview(input: ProgressInput): Record<StepKey, WorkflowStepOverview> {
  const progress = buildWorkflowProgress(input);
  const savedStep = (key: StepKey) => hasSavedContent(input.steps.find((row) => row.key === key));
  const selectedTopic = Boolean(String(input.novel.selectedTopic ?? "").trim());
  const firstVolumeOutline = Boolean(String(input.novel.firstVolumeOutline ?? "").trim());
  const savedUnits = progress.units.completed;
  const savedOutlines = progress.outlines.completed;

  const item = (key: StepKey, blockedReason = ""): WorkflowStepOverview => {
    const value = progress[key];
    if (value.completed === value.total) return { ...value, state: "complete", reason: "已完成" };
    if (blockedReason) return { ...value, state: "blocked", reason: blockedReason };
    if (value.completed > 0) return { ...value, state: "in_progress", reason: "进行中" };
    return { ...value, state: "ready", reason: "可以开始" };
  };

  return {
    topics: item("topics"),
    volumes: item("volumes", selectedTopic ? "" : "先确认最终选题"),
    settings: item("settings", savedStep("volumes") ? "" : "先保存分卷大纲"),
    units: item("units", !savedStep("settings") ? "先保存核心设定" : firstVolumeOutline ? "" : "先确认本卷大纲"),
    outlines: item("outlines", savedUnits > 0 ? "" : "先保存剧情单元"),
    drafts: item("drafts", !savedStep("settings") ? "先保存核心设定" : savedUnits === 0 ? "先保存剧情单元" : savedOutlines > 0 ? "" : "先保存分章大纲"),
  };
}
