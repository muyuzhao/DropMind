import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const stepKeyValues = ["topics", "volumes", "settings", "units", "outlines", "drafts"] as const;
export const chapterStatusValues = ["not_started", "saved", "published"] as const;

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
};

export const novels = sqliteTable("novels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  referenceTitle: text("reference_title").notNull(),
  referenceSummary: text("reference_summary").notNull(),
  selectedTopic: text("selected_topic").notNull().default(""),
  firstVolumeOutline: text("first_volume_outline").notNull().default(""),
  promptSchemeId: text("prompt_scheme_id"),
  currentStep: text("current_step", { enum: stepKeyValues }).notNull().default("topics"),
  currentRangeStart: integer("current_range_start").notNull().default(1),
  currentChapter: integer("current_chapter").notNull().default(1),
  ...timestamps,
});

export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey(),
  novelId: text("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  key: text("key", { enum: stepKeyValues }).notNull(),
  template: text("template").notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("prompt_template_novel_key").on(table.novelId, table.key)]);

export const promptSchemes = sqliteTable("prompt_schemes", {
  id: text("id").primaryKey(), name: text("name").notNull().unique(), description: text("description").notNull().default(""),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false), isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false), ...timestamps,
});
export const promptSchemeTemplates = sqliteTable("prompt_scheme_templates", {
  id: text("id").primaryKey(), schemeId: text("scheme_id").notNull().references(() => promptSchemes.id, { onDelete: "cascade" }),
  key: text("key", { enum: stepKeyValues }).notNull(), template: text("template").notNull(), ...timestamps,
}, (table) => [uniqueIndex("scheme_template_scheme_key").on(table.schemeId, table.key)]);

export const novelSteps = sqliteTable("novel_steps", {
  id: text("id").primaryKey(),
  novelId: text("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  key: text("key", { enum: stepKeyValues }).notNull(),
  content: text("content").notNull().default(""),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [uniqueIndex("novel_step_novel_key").on(table.novelId, table.key)]);

export const storyUnits = sqliteTable("story_units", {
  id: text("id").primaryKey(),
  novelId: text("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  startChapter: integer("start_chapter").notNull(),
  endChapter: integer("end_chapter").notNull(),
  content: text("content").notNull().default(""),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [uniqueIndex("story_unit_novel_start").on(table.novelId, table.startChapter)]);

export const chapterOutlines = sqliteTable("chapter_outlines", {
  id: text("id").primaryKey(),
  novelId: text("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull(),
  content: text("content").notNull().default(""),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [uniqueIndex("chapter_outline_novel_number").on(table.novelId, table.chapterNumber)]);

export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  novelId: text("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull(),
  content: text("content").notNull().default(""),
  status: text("status", { enum: chapterStatusValues }).notNull().default("not_started"),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex("chapter_novel_number").on(table.novelId, table.chapterNumber),
  index("chapter_novel_status").on(table.novelId, table.status),
]);

export const contentVersions = sqliteTable("content_versions", {
  id: text("id").primaryKey(),
  novelId: text("novel_id").notNull().references(() => novels.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  contentKey: text("content_key").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("content_version_lookup").on(table.novelId, table.contentType, table.contentKey)]);

export type Novel = typeof novels.$inferSelect;
export type StepKey = (typeof stepKeyValues)[number];
export type ChapterStatus = (typeof chapterStatusValues)[number];
