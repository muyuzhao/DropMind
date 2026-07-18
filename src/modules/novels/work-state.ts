import { stepKeyValues, type StepKey } from "../../lib/novel-db/schema";
import { TEN_CHAPTER_RANGES } from "./ranges";

export type WorkPosition = {
  step: StepKey;
  rangeStart: number;
  chapter: number;
};

type ContentRow = Record<string, unknown>;

type ProgressInput = {
  novel: Record<string, unknown>;
  steps: ContentRow[];
  storyUnits: ContentRow[];
  chapterOutlines: ContentRow[];
  chapters: ContentRow[];
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
  if (position.step === "units" || position.step === "outlines") {
    return position.rangeStart < 51 ? { ...position, rangeStart: position.rangeStart + 10 } : null;
  }
  if (position.step === "drafts") {
    return position.chapter < 60 ? { ...position, chapter: position.chapter + 1 } : null;
  }
  return null;
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
    topics: { completed: String(input.novel.selectedTopic ?? "").trim() ? 1 : 0, total: 1 },
    volumes: { completed: savedStep("volumes") ? 1 : 0, total: 1 },
    settings: { completed: savedStep("settings") ? 1 : 0, total: 1 },
    units: { completed: TEN_CHAPTER_RANGES.filter((range) => unitStarts.has(range.start)).length, total: 6 },
    outlines: { completed: TEN_CHAPTER_RANGES.filter((range) => outlineStarts.has(range.start)).length, total: 6 },
    drafts: { completed: Array.from({ length: 60 }, (_, index) => index + 1).filter((chapter) => completedChapters.has(chapter)).length, total: 60 },
  };
}
