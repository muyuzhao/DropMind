export const stepKeyValues = ["topics", "volumes", "settings", "units", "outlines", "tags", "drafts"] as const;
export const promptTemplateKeyValues = [...stepKeyValues, "cover"] as const;
export const chapterStatusValues = ["not_started", "saved", "published"] as const;
export type StepKey = (typeof stepKeyValues)[number];
export type PromptTemplateKey = (typeof promptTemplateKeyValues)[number];
export type ChapterStatus = (typeof chapterStatusValues)[number];
