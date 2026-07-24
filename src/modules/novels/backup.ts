import { z } from "zod";
import { chapterStatusValues, promptTemplateKeyValues, stepKeyValues } from "../../lib/novel-db/schema";
import { DEFAULT_PROMPT_TEMPLATES } from "./templates";

const draftFlag = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean);
const batchStart = z.number().int().refine((value) => [1, 11, 21, 31, 41, 51].includes(value));
const chapterNumber = z.number().int().min(1).max(60);
const promptTemplateSchema = z.object({ key: z.enum(promptTemplateKeyValues), template: z.string() }).passthrough();

const compatiblePromptTemplatesSchema = z.array(promptTemplateSchema).transform((rows) => {
  const templates = [...rows];
  if (!templates.some((row) => row.key === "tags")) {
    templates.push({ key: "tags", template: DEFAULT_PROMPT_TEMPLATES.tags });
  }
  if (!templates.some((row) => row.key === "cover")) {
    templates.push({ key: "cover", template: DEFAULT_PROMPT_TEMPLATES.cover });
  }
  return templates;
});

const backupWorkspaceSchema = z.object({
  novel: z.object({
    name: z.string().trim().min(1).max(100),
    referenceTitle: z.string().max(200),
    referenceSummary: z.string().max(50_000),
    selectedTopic: z.string().default(""),
    firstVolumeOutline: z.string().default(""),
    currentStep: z.enum(stepKeyValues).default("topics"),
    currentRangeStart: batchStart.default(1),
    currentChapter: chapterNumber.default(1),
  }).passthrough(),
  templates: compatiblePromptTemplatesSchema,
  steps: z.array(z.object({ key: z.enum(stepKeyValues), content: z.string(), isDraft: draftFlag.default(false) }).passthrough()),
  storyUnits: z.array(z.object({ startChapter: batchStart, endChapter: chapterNumber, content: z.string(), isDraft: draftFlag.default(false) }).passthrough()),
  chapterOutlines: z.array(z.object({ chapterNumber, content: z.string(), isDraft: draftFlag.default(false) }).passthrough()),
  chapters: z.array(z.object({ chapterNumber, title: z.string().default(""), content: z.string(), status: z.enum(chapterStatusValues), isDraft: draftFlag.default(false) }).passthrough()),
  contentVersions: z.array(z.object({
    contentType: z.enum(["step", "novel_field", "story_unit", "outline_batch", "chapter", "template"]),
    contentKey: z.string(), content: z.string(), createdAt: z.number().int(),
  }).passthrough()).default([]),
  continuityState: z.object({
    throughChapter: z.number().int().min(0).max(60),
    revision: z.number().int().min(0),
    content: z.string(),
    sourceRunId: z.string().nullable().default(null),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  }).passthrough().nullable().default(null),
  continuityEvents: z.array(z.object({
    chapterNumber,
    runId: z.string(),
    chapterHash: z.string(),
    summary: z.string(),
    stateContent: z.string(),
    invalidatedAt: z.number().int().nullable().default(null),
    createdAt: z.number().int(),
  }).passthrough()).default([]),
}).superRefine((workspace, context) => {
  const templateKeys = workspace.templates.map((row) => row.key);
  if (templateKeys.length !== promptTemplateKeyValues.length || new Set(templateKeys).size !== promptTemplateKeyValues.length || promptTemplateKeyValues.some((key) => !templateKeys.includes(key))) {
    context.addIssue({ code: "custom", message: "备份中的提示词不完整", path: ["templates"] });
  }
  for (const [field, values] of [
    ["steps", workspace.steps.map((row) => row.key)],
    ["storyUnits", workspace.storyUnits.map((row) => row.startChapter)],
    ["chapterOutlines", workspace.chapterOutlines.map((row) => row.chapterNumber)],
    ["chapters", workspace.chapters.map((row) => row.chapterNumber)],
  ] as const) {
    if (new Set<unknown>(values).size !== values.length) context.addIssue({ code: "custom", message: `备份中的${field}存在重复记录`, path: [field] });
  }
  for (const [index, unit] of workspace.storyUnits.entries()) {
    if (unit.endChapter !== unit.startChapter + 9) context.addIssue({ code: "custom", message: "剧情单元章节范围不一致", path: ["storyUnits", index, "endChapter"] });
  }
});

const backupSchema = z.object({
  format: z.literal("dropmind-novel"),
  version: z.literal(1),
  exportedAt: z.string(),
  workspace: backupWorkspaceSchema,
});

export type NovelBackupWorkspace = z.infer<typeof backupWorkspaceSchema>;

export function createNovelBackup(workspace: unknown) {
  const validated = backupWorkspaceSchema.parse(workspace);
  return JSON.stringify({ format: "dropmind-novel", version: 1, exportedAt: new Date().toISOString(), workspace: validated }, null, 2);
}

export function parseNovelBackup(json: string) {
  try {
    return backupSchema.parse(JSON.parse(json));
  } catch {
    throw new Error("这不是有效的小说工作台备份文件");
  }
}

export function exportVolumeText(chapters: Array<{ chapterNumber: number; title?: string; content: string }>) {
  return chapters
    .filter((chapter) => chapter.content.trim())
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .map((chapter) => `第${chapter.chapterNumber}章${chapter.title?.trim() ? ` ${chapter.title.trim()}` : ""}\n\n${chapter.content.trim()}`)
    .join("\n\n\n");
}
