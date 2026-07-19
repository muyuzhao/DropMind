import type { StepKey } from "@/lib/novel-db/schema";

export const AUTOMATIC_CONTEXT_LABELS: Record<StepKey, string[]> = {
  topics: ["参考书名", "参考简介"],
  volumes: ["已选选题"],
  settings: ["已选选题", "分卷大纲"],
  units: ["本卷大纲", "当前十章范围"],
  outlines: ["当前十章剧情单元", "当前十章范围"],
  tags: ["书名", "简介"],
  drafts: ["当前任务.md", "本地资料目录", "上一章正文文件"],
};

export const CODEX_DRAFT_COMMAND = "执行当前任务";

export function stripLegacyPlaceholders(template: string) {
  return template
    .replace(/【?\{\{(?:reference_title|reference_summary|selected_topic|volume_outline|first_volume_outline|core_settings|story_unit|chapter_outline|previous_chapter)\}\}】?/g, "")
    .replace(/第?【?\{\{range_start\}\}-\{\{range_end\}\}】?章?/g, "当前十章")
    .replace(/第\{\{chapter_number\}\}章/g, "当前章节")
    .replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "")
    .replace(/^(书名|简介|选题|分卷大纲|小说核心设定|第一卷大纲|当前剧情单元|当前十章剧情单元|上一章正文)：\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
