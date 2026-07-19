import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_PROMPT_TEMPLATES } from "../../modules/novels/templates";
import { migrateLegacyBatchTemplate } from "../../modules/novels/batch-workflow-migration";
import { stripLegacyPlaceholders } from "../../modules/novels/structured-prompts";
import { promptTemplateKeyValues, type StepKey } from "./schema";

export const SYSTEM_SCHEME_ID = "system-default";

const CREATE_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS novels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, reference_title TEXT NOT NULL, reference_summary TEXT NOT NULL,
  selected_topic TEXT NOT NULL DEFAULT '', first_volume_outline TEXT NOT NULL DEFAULT '', prompt_scheme_id TEXT,
  current_step TEXT NOT NULL DEFAULT 'topics', current_range_start INTEGER NOT NULL DEFAULT 1,
  current_chapter INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE, key TEXT NOT NULL,
  template TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(novel_id, key)
);
CREATE TABLE IF NOT EXISTS prompt_schemes (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT '',is_system INTEGER NOT NULL DEFAULT 0,is_default INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS prompt_scheme_templates (id TEXT PRIMARY KEY,scheme_id TEXT NOT NULL REFERENCES prompt_schemes(id) ON DELETE CASCADE,key TEXT NOT NULL,template TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(scheme_id,key));
CREATE TABLE IF NOT EXISTS app_migrations (key TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS novel_steps (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE, key TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '', is_draft INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(novel_id, key)
);
CREATE TABLE IF NOT EXISTS story_units (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  start_chapter INTEGER NOT NULL, end_chapter INTEGER NOT NULL, content TEXT NOT NULL DEFAULT '',
  is_draft INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(novel_id, start_chapter)
);
CREATE TABLE IF NOT EXISTS chapter_outlines (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL, content TEXT NOT NULL DEFAULT '', is_draft INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(novel_id, chapter_number)
);
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'not_started',
  is_draft INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(novel_id, chapter_number)
);
CREATE INDEX IF NOT EXISTS chapter_novel_status ON chapters(novel_id, status);
CREATE TABLE IF NOT EXISTS content_versions (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL, content_key TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS content_version_lookup ON content_versions(novel_id, content_type, content_key);
`;

const CREATE_DELIVERY_SCHEMA = `
CREATE TABLE IF NOT EXISTS delivery_settings (
  id TEXT PRIMARY KEY, connection_token TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_targets (
  novel_id TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, book_name TEXT NOT NULL, manage_url TEXT NOT NULL, default_volume TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_jobs (
  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL, platform TEXT NOT NULL, target_book_name TEXT NOT NULL, target_manage_url TEXT NOT NULL,
  chapter_title TEXT NOT NULL, chapter_content TEXT NOT NULL, content_hash TEXT NOT NULL,
  status TEXT NOT NULL, last_error TEXT NOT NULL DEFAULT '', claimed_at INTEGER, filled_at INTEGER, submitted_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(novel_id, chapter_number, platform)
);
CREATE INDEX IF NOT EXISTS delivery_job_status ON delivery_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS delivery_job_novel ON delivery_jobs(novel_id, chapter_number);
`;

export function initializeNovelDatabase(sqlite: Database.Database) {
  sqlite.exec(CREATE_SCHEMA);
  ensurePromptSchemeColumn(sqlite);
  ensureWorkPositionColumns(sqlite);
  ensureChapterTitleColumn(sqlite);
  ensureDeliverySchema(sqlite);
  seedDefaultPromptScheme(sqlite);
  ensurePublishPromptTemplates(sqlite);
  migrateTenChapterWorkflow(sqlite);
  migrateStructuredPromptModel(sqlite);
  return sqlite;
}

export function ensureDeliverySchema(sqlite: Database.Database) {
  const tables = new Set((sqlite.prepare("select name from sqlite_master where type='table'").all() as Array<{ name: string }>).map((row) => row.name));
  if (["delivery_settings", "delivery_targets", "delivery_jobs"].every((table) => tables.has(table))) return;
  const novels = tables.has("novels") ? (sqlite.prepare("select count(*) count from novels").get() as { count: number }).count : 0;
  if (novels > 0) migrationBackup(sqlite, "fanqie-delivery-v1");
  sqlite.exec(CREATE_DELIVERY_SCHEMA);
}

function ensureChapterTitleColumn(sqlite: Database.Database) {
  const columns = sqlite.prepare("pragma table_info(chapters)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "title")) return;
  const rows = (sqlite.prepare("select count(*) count from chapters").get() as { count: number }).count;
  if (rows > 0) migrationBackup(sqlite, "chapter-titles-v1");
  sqlite.exec("alter table chapters add column title TEXT NOT NULL DEFAULT ''");
}

function ensurePromptSchemeColumn(sqlite: Database.Database) {
  const columns = sqlite.prepare("pragma table_info(novels)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "prompt_scheme_id")) sqlite.exec("alter table novels add column prompt_scheme_id TEXT");
}

function ensureWorkPositionColumns(sqlite: Database.Database) {
  const columns = sqlite.prepare("pragma table_info(novels)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "current_range_start")) sqlite.exec("alter table novels add column current_range_start INTEGER NOT NULL DEFAULT 1");
  if (!columns.some((column) => column.name === "current_chapter")) sqlite.exec("alter table novels add column current_chapter INTEGER NOT NULL DEFAULT 1");
}

export function seedDefaultPromptScheme(sqlite: Database.Database) {
  const now = Date.now();
  sqlite.prepare("insert or ignore into prompt_schemes (id,name,description,is_system,is_default,created_at,updated_at) values (?,?,?,?,?,?,?)").run(SYSTEM_SCHEME_ID, "系统默认版", "内置七步提示词", 1, 1, now, now);
  sqlite.prepare("update prompt_schemes set description=?,updated_at=? where id=? and description<>?").run("内置七步提示词", now, SYSTEM_SCHEME_ID, "内置七步提示词");
  const insert = sqlite.prepare("insert or ignore into prompt_scheme_templates (id,scheme_id,key,template,created_at,updated_at) values (?,?,?,?,?,?)");
  for (const [key, template] of Object.entries(DEFAULT_PROMPT_TEMPLATES)) insert.run(`${SYSTEM_SCHEME_ID}-${key}`, SYSTEM_SCHEME_ID, key, template, now, now);
}

function ensurePublishPromptTemplates(sqlite: Database.Database) {
  const timestamp = Date.now();
  const insertScheme = sqlite.prepare("insert or ignore into prompt_scheme_templates (id,scheme_id,key,template,created_at,updated_at) values (?,?,?,?,?,?)");
  for (const scheme of sqlite.prepare("select id from prompt_schemes").all() as Array<{ id: string }>) {
    for (const key of ["tags", "cover"] as const) insertScheme.run(`${scheme.id}-${key}`, scheme.id, key, DEFAULT_PROMPT_TEMPLATES[key], timestamp, timestamp);
  }
  const insertNovel = sqlite.prepare("insert or ignore into prompt_templates (id,novel_id,key,template,created_at,updated_at) values (?,?,?,?,?,?)");
  for (const novel of sqlite.prepare("select id from novels where prompt_scheme_id is null").all() as Array<{ id: string }>) {
    for (const key of ["tags", "cover"] as const) insertNovel.run(`${novel.id}-${key}`, novel.id, key, DEFAULT_PROMPT_TEMPLATES[key], timestamp, timestamp);
  }
}

function migrationBackup(sqlite: Database.Database, migrationKey: string) {
  const databaseName = (sqlite as Database.Database & { name?: string }).name;
  if (!databaseName || databaseName === ":memory:") return null;
  const databasePath = path.resolve(databaseName);
  const backupDir = path.join(path.dirname(databasePath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `pre-${migrationKey}-${timestamp}.db`);
  sqlite.prepare("vacuum into ?").run(backupPath);
  return backupPath;
}

export function migrateTenChapterWorkflow(sqlite: Database.Database) {
  const migrationKey = "ten-chapter-batches-v1";
  if (sqlite.prepare("select 1 from app_migrations where key = ?").get(migrationKey)) return;

  const incompatibleRows = sqlite.prepare("select (select count(*) from story_units) + (select count(*) from chapter_outlines) count").get() as { count: number };
  if (incompatibleRows.count > 0) migrationBackup(sqlite, migrationKey);

  sqlite.transaction(() => {
    const now = Date.now();
    const updateSystem = sqlite.prepare("update prompt_scheme_templates set template = ?, updated_at = ? where scheme_id = ? and key = ?");
    updateSystem.run(DEFAULT_PROMPT_TEMPLATES.units, now, SYSTEM_SCHEME_ID, "units");
    updateSystem.run(DEFAULT_PROMPT_TEMPLATES.outlines, now, SYSTEM_SCHEME_ID, "outlines");

    for (const table of ["prompt_scheme_templates", "prompt_templates"] as const) {
      const rows = sqlite.prepare(`select id,key,template from ${table} where key in ('units','outlines')`).all() as Array<{ id: string; key: StepKey; template: string }>;
      const update = sqlite.prepare(`update ${table} set template = ?, updated_at = ? where id = ?`);
      for (const row of rows) {
        if (table === "prompt_scheme_templates" && row.id.startsWith(`${SYSTEM_SCHEME_ID}-`)) continue;
        const template = migrateLegacyBatchTemplate(row.key, row.template);
        if (template !== row.template) update.run(template, now, row.id);
      }
    }

    sqlite.prepare("delete from story_units").run();
    sqlite.prepare("delete from chapter_outlines").run();
    sqlite.prepare("insert into app_migrations (key,applied_at) values (?,?)").run(migrationKey, now);
  })();
}

export function migrateStructuredPromptModel(sqlite: Database.Database) {
  const migrationKey = "structured-prompts-v1";
  if (sqlite.prepare("select 1 from app_migrations where key=?").get(migrationKey)) return;
  sqlite.transaction(() => {
    const timestamp = Date.now();
    const updateSystem = sqlite.prepare("update prompt_scheme_templates set template=?,updated_at=? where scheme_id=? and key=?");
    for (const [key, template] of Object.entries(DEFAULT_PROMPT_TEMPLATES)) updateSystem.run(template, timestamp, SYSTEM_SCHEME_ID, key);
    for (const table of ["prompt_scheme_templates", "prompt_templates"] as const) {
      const rows = sqlite.prepare(`select id,template from ${table}`).all() as Array<{ id: string; template: string }>;
      const update = sqlite.prepare(`update ${table} set template=?,updated_at=? where id=?`);
      for (const row of rows) {
        const instruction = stripLegacyPlaceholders(row.template);
        if (instruction !== row.template) update.run(instruction, timestamp, row.id);
      }
    }
    const schemeRows = sqlite.prepare("select scheme_id,key,template from prompt_scheme_templates order by key").all() as Array<{ scheme_id: string; key: string; template: string }>;
    const schemeSignatures = new Map<string, string>();
    for (const scheme of sqlite.prepare("select id from prompt_schemes").all() as Array<{ id: string }>) {
      const rows = schemeRows.filter((row) => row.scheme_id === scheme.id);
      if (rows.length === promptTemplateKeyValues.length) schemeSignatures.set(scheme.id, JSON.stringify(rows.map((row) => [row.key, row.template])));
    }
    for (const novel of sqlite.prepare("select id from novels where prompt_scheme_id is null").all() as Array<{ id: string }>) {
      const rows = sqlite.prepare("select key,template from prompt_templates where novel_id=? order by key").all(novel.id) as Array<{ key: string; template: string }>;
      const signature = JSON.stringify(rows.map((row) => [row.key, row.template]));
      const matches = [...schemeSignatures].filter(([, value]) => value === signature);
      if (matches.length === 1) sqlite.prepare("update novels set prompt_scheme_id=? where id=?").run(matches[0][0], novel.id);
    }
    sqlite.prepare("insert into app_migrations (key,applied_at) values (?,?)").run(migrationKey, timestamp);
  })();
}
