import { z } from "zod";
import { chapterStatusValues, stepKeyValues } from "../../lib/novel-db/schema";

const required = z.string().trim().min(1, "此项不能为空");
export const createNovelSchema = z.object({ name: required.max(100), referenceTitle: required.max(200), referenceSummary: required.max(50_000), schemeId: z.string().optional() });
export const updateNovelSchema = z.object({ novelId: required, name: required.optional(), selectedTopic: z.string().optional(), firstVolumeOutline: z.string().optional(), currentStep: z.enum(stepKeyValues).optional(), currentRangeStart: z.number().int().min(1).max(51).refine((value) => (value - 1) % 10 === 0).optional(), currentChapter: z.number().int().min(1).max(60).optional() });
export const saveWorkPositionSchema = updateNovelSchema.pick({ novelId: true, currentStep: true, currentRangeStart: true, currentChapter: true }).required();
export const saveStepSchema = z.object({ novelId: required, key: z.enum(stepKeyValues), content: z.string(), draft: z.boolean() });
export const saveUnitSchema = z.object({ novelId: required, startChapter: z.number().int().min(1).max(56), content: z.string(), draft: z.boolean() });
export const saveOutlineSchema = z.object({ novelId: required, chapterNumber: z.number().int().min(1).max(60), content: z.string(), draft: z.boolean() });
export const saveChapterSchema = z.object({ novelId: required, chapterNumber: z.number().int().min(1).max(60), content: z.string(), status: z.enum(chapterStatusValues), draft: z.boolean() });
export const chapterTaskSchema = z.object({ novelId: required, chapterNumber: z.number().int().min(1).max(60) });
export const updateTemplateSchema = z.object({ novelId: required, key: z.enum(stepKeyValues), template: required });
export const setNovelSchemeSchema = z.object({ novelId: required, schemeId: required });
