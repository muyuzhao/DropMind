export const stepKeyValues = ["topics", "volumes", "settings", "units", "outlines", "drafts"] as const;
export const chapterStatusValues = ["not_started", "saved", "published"] as const;
export type StepKey = (typeof stepKeyValues)[number];
export type ChapterStatus = (typeof chapterStatusValues)[number];
