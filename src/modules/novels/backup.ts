import { z } from "zod";

const backupSchema = z.object({
  format: z.literal("dropmind-novel"),
  version: z.literal(1),
  exportedAt: z.string(),
  workspace: z.object({
    novel: z.record(z.string(), z.unknown()),
    templates: z.array(z.record(z.string(), z.unknown())),
    steps: z.array(z.record(z.string(), z.unknown())),
    storyUnits: z.array(z.record(z.string(), z.unknown())),
    chapterOutlines: z.array(z.record(z.string(), z.unknown())),
    chapters: z.array(z.record(z.string(), z.unknown())),
  }),
});

export function createNovelBackup(workspace: z.infer<typeof backupSchema>["workspace"]) {
  return JSON.stringify({ format: "dropmind-novel", version: 1, exportedAt: new Date().toISOString(), workspace }, null, 2);
}

export function parseNovelBackup(json: string) {
  try {
    return backupSchema.parse(JSON.parse(json));
  } catch {
    throw new Error("这不是有效的小说工作台备份文件");
  }
}

export function exportVolumeText(chapters: Array<{ chapterNumber: number; content: string }>) {
  return chapters
    .filter((chapter) => chapter.content.trim())
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .map((chapter) => `第${chapter.chapterNumber}章\n\n${chapter.content.trim()}`)
    .join("\n\n\n");
}
