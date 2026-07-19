import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initializeNovelDatabase } from "./initialize";
import { stepKeyValues } from "./schema";

describe("initializeNovelDatabase", () => {
  it("creates every novel workbench table", () => {
    const sqlite = new Database(":memory:");
    initializeNovelDatabase(sqlite);

    const names = sqlite.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>;
    expect(names.map((row) => row.name)).toEqual(expect.arrayContaining([
      "novels", "prompt_templates", "prompt_schemes", "prompt_scheme_templates", "novel_steps", "story_units", "chapter_outlines", "chapters", "content_versions", "app_migrations",
    ]));
  });

  it("adds work position columns to an existing novels table", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`create table novels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, reference_title TEXT NOT NULL, reference_summary TEXT NOT NULL,
      selected_topic TEXT NOT NULL DEFAULT '', first_volume_outline TEXT NOT NULL DEFAULT '',
      current_step TEXT NOT NULL DEFAULT 'topics', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    sqlite.prepare("insert into novels (id,name,reference_title,reference_summary,created_at,updated_at) values (?,?,?,?,?,?)")
      .run("legacy", "旧小说", "参考", "简介", 1, 1);

    initializeNovelDatabase(sqlite);

    expect(sqlite.prepare("select current_range_start,current_chapter from novels where id=?").get("legacy"))
      .toMatchObject({ current_range_start: 1, current_chapter: 1 });
  });

  it("backs up existing data before adding chapter titles", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dropmind-title-migration-"));
    const databasePath = path.join(directory, "novels.db");
    const sqlite = new Database(databasePath);
    try {
      sqlite.exec(`
        create table novels (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, reference_title TEXT NOT NULL, reference_summary TEXT NOT NULL,
          selected_topic TEXT NOT NULL DEFAULT '', first_volume_outline TEXT NOT NULL DEFAULT '',
          current_step TEXT NOT NULL DEFAULT 'topics', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        create table chapters (
          id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_number INTEGER NOT NULL,
          content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'not_started', is_draft INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(novel_id, chapter_number)
        );
      `);
      sqlite.prepare("insert into novels (id,name,reference_title,reference_summary,created_at,updated_at) values (?,?,?,?,?,?)")
        .run("novel-1", "旧小说", "参考", "简介", 1, 1);
      sqlite.prepare("insert into chapters (id,novel_id,chapter_number,content,status,is_draft,created_at,updated_at) values (?,?,?,?,?,?,?,?)")
        .run("chapter-1", "novel-1", 1, "迁移前正文", "saved", 0, 1, 1);

      initializeNovelDatabase(sqlite);

      expect(sqlite.prepare("select title,content from chapters where id=?").get("chapter-1"))
        .toMatchObject({ title: "", content: "迁移前正文" });
      const backups = fs.readdirSync(path.join(directory, "backups"));
      expect(backups).toHaveLength(1);
      const backup = new Database(path.join(directory, "backups", backups[0]), { readonly: true });
      expect(backup.prepare("select content from chapters where id=?").get("chapter-1"))
        .toMatchObject({ content: "迁移前正文" });
      backup.close();
    } finally {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("clears incompatible step 4 and 5 content only once", () => {
    const sqlite = new Database(":memory:");
    initializeNovelDatabase(sqlite);
    sqlite.prepare("delete from app_migrations where key = ?").run("ten-chapter-batches-v1");
    sqlite.prepare("insert into novels (id,name,reference_title,reference_summary,created_at,updated_at) values (?,?,?,?,?,?)")
      .run("novel-1", "测试小说", "参考书", "简介", 1, 1);
    sqlite.prepare("insert into story_units (id,novel_id,start_chapter,end_chapter,content,created_at,updated_at) values (?,?,?,?,?,?,?)")
      .run("unit-1", "novel-1", 1, 5, "旧剧情单元", 1, 1);
    sqlite.prepare("insert into chapter_outlines (id,novel_id,chapter_number,content,created_at,updated_at) values (?,?,?,?,?,?)")
      .run("outline-1", "novel-1", 1, "旧分章大纲", 1, 1);

    initializeNovelDatabase(sqlite);

    expect(sqlite.prepare("select count(*) count from story_units").get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare("select count(*) count from chapter_outlines").get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare("select count(*) count from app_migrations where key = ?").get("ten-chapter-batches-v1")).toMatchObject({ count: 1 });

    sqlite.prepare("insert into story_units (id,novel_id,start_chapter,end_chapter,content,created_at,updated_at) values (?,?,?,?,?,?,?)")
      .run("unit-2", "novel-1", 1, 10, "新剧情单元", 2, 2);
    initializeNovelDatabase(sqlite);
    expect(sqlite.prepare("select count(*) count from story_units").get()).toMatchObject({ count: 1 });
  });

  it("creates a consistent snapshot before a destructive file migration", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dropmind-migration-"));
    const databasePath = path.join(directory, "novels.db");
    const sqlite = new Database(databasePath);
    try {
      initializeNovelDatabase(sqlite);
      sqlite.prepare("delete from app_migrations where key = ?").run("ten-chapter-batches-v1");
      sqlite.prepare("insert into novels (id,name,reference_title,reference_summary,created_at,updated_at) values (?,?,?,?,?,?)")
        .run("novel-1", "测试小说", "参考书", "简介", 1, 1);
      sqlite.prepare("insert into story_units (id,novel_id,start_chapter,end_chapter,content,created_at,updated_at) values (?,?,?,?,?,?,?)")
        .run("unit-1", "novel-1", 1, 5, "待备份的旧剧情单元", 1, 1);

      initializeNovelDatabase(sqlite);

      const backups = fs.readdirSync(path.join(directory, "backups"));
      expect(backups).toHaveLength(1);
      const backup = new Database(path.join(directory, "backups", backups[0]), { readonly: true });
      expect(backup.prepare("select content from story_units where id=?").get("unit-1")).toMatchObject({ content: "待备份的旧剧情单元" });
      backup.close();
    } finally {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates legacy prompt variables without deleting saved novel content", () => {
    const sqlite = new Database(":memory:");
    initializeNovelDatabase(sqlite);
    sqlite.prepare("delete from app_migrations where key = ?").run("structured-prompts-v1");
    sqlite.prepare("insert into novels (id,name,reference_title,reference_summary,created_at,updated_at) values (?,?,?,?,?,?)")
      .run("novel-1", "测试小说", "参考书", "简介", 1, 1);
    const insertTemplate = sqlite.prepare("insert into prompt_templates (id,novel_id,key,template,created_at,updated_at) values (?,?,?,?,?,?)");
    for (const key of stepKeyValues) {
      insertTemplate.run(`template-${key}`, "novel-1", key, `【{{selected_topic}}】\n保留-${key}-创作要求`, 1, 1);
    }
    sqlite.prepare("insert into novel_steps (id,novel_id,key,content,is_draft,created_at,updated_at) values (?,?,?,?,?,?,?)")
      .run("step-1", "novel-1", "settings", "已经保存的核心设定", 0, 1, 1);

    initializeNovelDatabase(sqlite);

    const templates = sqlite.prepare("select template from prompt_templates where novel_id=?").all("novel-1") as Array<{ template: string }>;
    expect(templates).toHaveLength(8);
    expect(templates.every((row) => !row.template.includes("{{"))).toBe(true);
    expect(templates.filter((row) => !row.template.includes("番茄爽文小说封面创作")).every((row) => row.template.includes("创作要求"))).toBe(true);
    expect(templates.some((row) => row.template.includes("番茄爽文小说封面创作"))).toBe(true);
    expect(sqlite.prepare("select content from novel_steps where id=?").get("step-1")).toMatchObject({ content: "已经保存的核心设定" });
  });

  it("adds the default work tag guide when an existing scheme is missing it", () => {
    const sqlite = new Database(":memory:");
    initializeNovelDatabase(sqlite);
    sqlite.prepare("delete from prompt_scheme_templates where scheme_id=? and key='tags'").run("system-default");

    initializeNovelDatabase(sqlite);

    const row = sqlite.prepare("select template from prompt_scheme_templates where scheme_id=? and key='tags'")
      .get("system-default") as { template: string };
    expect(row.template).toContain("作品标签生成指南");
  });
});
