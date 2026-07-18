import type { ChapterStatus, StepKey } from "../../lib/novel-db/schema";

export type DraftFlag = boolean | 0 | 1;

export type NovelData = {
  id: string;
  name: string;
  referenceTitle: string;
  referenceSummary: string;
  selectedTopic: string;
  firstVolumeOutline: string;
  promptSchemeId: string | null;
  currentStep: StepKey;
  currentRangeStart: number;
  currentChapter: number;
  createdAt: number;
  updatedAt: number;
};

export type PromptTemplateData = { id: string; key: StepKey; template: string; createdAt: number; updatedAt: number; novelId?: string; schemeId?: string };
export type NovelStepData = { id: string; novelId: string; key: StepKey; content: string; isDraft: DraftFlag; createdAt: number; updatedAt: number };
export type StoryUnitData = { id: string; novelId: string; startChapter: number; endChapter: number; content: string; isDraft: DraftFlag; createdAt: number; updatedAt: number };
export type ChapterOutlineData = { id: string; novelId: string; chapterNumber: number; content: string; isDraft: DraftFlag; createdAt: number; updatedAt: number };
export type ChapterData = { id: string; novelId: string; chapterNumber: number; content: string; status: ChapterStatus; isDraft: DraftFlag; createdAt: number; updatedAt: number };
export type VersionedContentType = "step" | "novel_field" | "story_unit" | "outline_batch" | "chapter" | "template";
export type ContentVersionData = { id: string; novelId: string; contentType: VersionedContentType; contentKey: string; content: string; createdAt: number };

export type PromptSourceData = { mode: "scheme" | "custom"; schemeId: string | null; schemeName: string };

export type NovelWorkspaceData = {
  novel: NovelData;
  promptSource: PromptSourceData;
  templates: PromptTemplateData[];
  steps: NovelStepData[];
  storyUnits: StoryUnitData[];
  chapterOutlines: ChapterOutlineData[];
  chapters: ChapterData[];
  contentVersions: ContentVersionData[];
};

export type PromptSchemeSummary = { id: string; name: string; description: string; isSystem: DraftFlag; isDefault: DraftFlag; createdAt: number; updatedAt: number };
export type PromptSchemeData = PromptSchemeSummary & { templates: PromptTemplateData[] };
export type NovelListItem = NovelData & { completedCount: number; publishedCount: number };
