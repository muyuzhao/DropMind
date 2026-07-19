import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { stepKeyValues, type ChapterStatus, type StepKey } from "../../lib/novel-db/schema";
import { getNovelSqlite } from "../../lib/novel-db";
import { stripLegacyPlaceholders } from "./structured-prompts";
import type { NovelBackupWorkspace } from "./backup";
import type { ChapterData, ChapterOutlineData, ContentVersionData, NovelData, NovelListItem, NovelStepData, NovelWorkspaceData, PromptSchemeData, PromptSchemeSummary, PromptTemplateData, StoryUnitData, VersionedContentType } from "./types";

type CreateNovelInput = { name: string; referenceTitle: string; referenceSummary: string };
type Row = Record<string, unknown>;
type NovelRecord = NovelData;

function camel(row: Row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]));
}

export function createNovelRepository(sqlite: Database.Database) {
  const now = () => Date.now();
  const touch = (novelId: string) => sqlite.prepare("update novels set updated_at = ? where id = ?").run(now(), novelId);
  const all = <T = Row>(sql: string, ...args: unknown[]) => (sqlite.prepare(sql).all(...args) as Row[]).map(camel) as T[];
  const one = <T = Row>(sql: string, ...args: unknown[]) => {
    const row = sqlite.prepare(sql).get(...args) as Row | undefined;
    return row ? camel(row) as T : null;
  };

  function versionPrevious(novelId: string, contentType: VersionedContentType, contentKey: string, table: string, where: string, args: unknown[], nextContent: string, contentColumn = "content") {
    const previous = sqlite.prepare(`select ${contentColumn} content from ${table} where ${where}`).get(...args) as { content: string } | undefined;
    if (previous?.content && previous.content !== nextContent) {
      sqlite.prepare("insert into content_versions (id, novel_id, content_type, content_key, content, created_at) values (?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), novelId, contentType, contentKey, previous.content, now());
    }
  }

  return {
    createNovel(input: CreateNovelInput, schemeId?: string) {
      const id = randomUUID();
      const timestamp = now();
      sqlite.transaction(() => {
        const chosen = schemeId ?? String((sqlite.prepare("select id from prompt_schemes where is_default=1 limit 1").get() as {id:string}|undefined)?.id ?? "system-default");
        const source = sqlite.prepare("select key,template from prompt_scheme_templates where scheme_id=?").all(chosen) as Array<{key:string;template:string}>;
        if (source.length !== 6) throw new Error("提示词方案不完整");
        sqlite.prepare("insert into novels (id, name, reference_title, reference_summary, prompt_scheme_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
          .run(id, input.name, input.referenceTitle, input.referenceSummary, chosen, timestamp, timestamp);
        const insert = sqlite.prepare("insert into prompt_templates (id, novel_id, key, template, created_at, updated_at) values (?, ?, ?, ?, ?, ?)");
        for (const item of source) insert.run(randomUUID(), id, item.key, item.template, timestamp, timestamp);
      })();
      return one<NovelRecord>("select * from novels where id = ?", id)!;
    },

    importNovelBackup(workspace: NovelBackupWorkspace) {
      const id = randomUUID();
      const timestamp = now();
      const existingNames = new Set((sqlite.prepare("select name from novels").all() as Array<{ name: string }>).map((row) => row.name));
      const baseName = `${workspace.novel.name.slice(0, 95)}（导入）`;
      let name = baseName;
      for (let copy = 2; existingNames.has(name); copy += 1) name = `${baseName.slice(0, 90)} ${copy}`;

      sqlite.transaction(() => {
        sqlite.prepare(`insert into novels (id,name,reference_title,reference_summary,selected_topic,first_volume_outline,prompt_scheme_id,current_step,current_range_start,current_chapter,created_at,updated_at)
          values (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, name, workspace.novel.referenceTitle, workspace.novel.referenceSummary, workspace.novel.selectedTopic,
          workspace.novel.firstVolumeOutline, null, workspace.novel.currentStep, workspace.novel.currentRangeStart,
          workspace.novel.currentChapter, timestamp, timestamp,
        );

        const insertTemplate = sqlite.prepare("insert into prompt_templates (id,novel_id,key,template,created_at,updated_at) values (?,?,?,?,?,?)");
        for (const row of workspace.templates) insertTemplate.run(randomUUID(), id, row.key, row.template, timestamp, timestamp);

        const insertStep = sqlite.prepare("insert into novel_steps (id,novel_id,key,content,is_draft,created_at,updated_at) values (?,?,?,?,?,?,?)");
        for (const row of workspace.steps) insertStep.run(randomUUID(), id, row.key, row.content, row.isDraft ? 1 : 0, timestamp, timestamp);

        const insertUnit = sqlite.prepare("insert into story_units (id,novel_id,start_chapter,end_chapter,content,is_draft,created_at,updated_at) values (?,?,?,?,?,?,?,?)");
        for (const row of workspace.storyUnits) insertUnit.run(randomUUID(), id, row.startChapter, row.endChapter, row.content, row.isDraft ? 1 : 0, timestamp, timestamp);

        const insertOutline = sqlite.prepare("insert into chapter_outlines (id,novel_id,chapter_number,content,is_draft,created_at,updated_at) values (?,?,?,?,?,?,?)");
        for (const row of workspace.chapterOutlines) insertOutline.run(randomUUID(), id, row.chapterNumber, row.content, row.isDraft ? 1 : 0, timestamp, timestamp);

        const insertChapter = sqlite.prepare("insert into chapters (id,novel_id,chapter_number,content,status,is_draft,created_at,updated_at) values (?,?,?,?,?,?,?,?)");
        for (const row of workspace.chapters) insertChapter.run(randomUUID(), id, row.chapterNumber, row.content, row.status, row.isDraft ? 1 : 0, timestamp, timestamp);

        const insertVersion = sqlite.prepare("insert into content_versions (id,novel_id,content_type,content_key,content,created_at) values (?,?,?,?,?,?)");
        for (const row of workspace.contentVersions) insertVersion.run(randomUUID(), id, row.contentType, row.contentKey, row.content, row.createdAt);
      })();

      return one<NovelRecord>("select * from novels where id = ?", id)!;
    },

    listNovels() {
      return all<NovelListItem>(`select n.*,
        (select count(*) from chapters c where c.novel_id=n.id and c.content<>'') completed_count,
        (select count(*) from chapters c where c.novel_id=n.id and c.status='published') published_count
        from novels n order by n.updated_at desc`);
    },

    getNovel(id: string) { return one<NovelRecord>("select * from novels where id = ?", id); },
    getTemplates(novelId: string) { return all<PromptTemplateData>("select * from prompt_templates where novel_id = ? order by created_at", novelId); },
    listPromptSchemes() { return all<PromptSchemeSummary>("select * from prompt_schemes order by is_default desc,updated_at desc"); },
    getPromptScheme(id: string): PromptSchemeData | null { const scheme=one<PromptSchemeSummary>("select * from prompt_schemes where id=?",id); return scheme ? {...scheme,templates:all<PromptTemplateData>("select * from prompt_scheme_templates where scheme_id=? order by created_at",id)} : null; },
    createPromptScheme(input: {name:string;description:string;sourceSchemeId?:string}) {
      const id=randomUUID(), timestamp=now(), source=input.sourceSchemeId??"system-default";
      sqlite.transaction(()=>{ sqlite.prepare("insert into prompt_schemes (id,name,description,is_system,is_default,created_at,updated_at) values (?,?,?,?,?,?,?)").run(id,input.name,input.description,0,0,timestamp,timestamp);
        const rows=sqlite.prepare("select key,template from prompt_scheme_templates where scheme_id=?").all(source) as Array<{key:string;template:string}>;
        if (rows.length !== stepKeyValues.length) throw new Error("来源提示词方案不存在或不完整");
        const ins=sqlite.prepare("insert into prompt_scheme_templates (id,scheme_id,key,template,created_at,updated_at) values (?,?,?,?,?,?)"); for(const row of rows) ins.run(randomUUID(),id,row.key,row.template,timestamp,timestamp); })(); return one<{id:string}&Row>("select * from prompt_schemes where id=?",id)!;
    },
    updatePromptScheme(id:string, patch:{name:string;description:string}) { const result=sqlite.prepare("update prompt_schemes set name=?,description=?,updated_at=? where id=?").run(patch.name,patch.description,now(),id); if(!result.changes) throw new Error("提示词方案不存在"); },
    updatePromptSchemeTemplate(id:string,key:StepKey,template:string){ const result=sqlite.prepare("update prompt_scheme_templates set template=?,updated_at=? where scheme_id=? and key=?").run(stripLegacyPlaceholders(template),now(),id,key); if(!result.changes) throw new Error("提示词方案或模板不存在"); },
    setDefaultPromptScheme(id:string){ sqlite.transaction(()=>{const target=sqlite.prepare("select 1 from prompt_schemes where id=?").get(id);if(!target) throw new Error("提示词方案不存在");sqlite.prepare("update prompt_schemes set is_default=0").run();sqlite.prepare("update prompt_schemes set is_default=1 where id=?").run(id);})(); },
    deletePromptScheme(id:string){ const row=sqlite.prepare("select is_system,is_default from prompt_schemes where id=?").get(id) as {is_system:number;is_default:number}|undefined; if(!row) return; if(row.is_system) throw new Error("系统方案不可删除"); if(row.is_default) throw new Error("默认方案不可删除"); const linked=(sqlite.prepare("select count(*) count from novels where prompt_scheme_id=?").get(id) as {count:number}).count; if(linked) throw new Error(`仍有${linked}本小说正在跟随该方案`); sqlite.prepare("delete from prompt_schemes where id=?").run(id); },

    setNovelPromptScheme(novelId: string, schemeId: string) {
      const count = (sqlite.prepare("select count(*) count from prompt_scheme_templates where scheme_id=?").get(schemeId) as { count: number }).count;
      if (count !== stepKeyValues.length) throw new Error("提示词方案不存在或不完整");
      const result = sqlite.prepare("update novels set prompt_scheme_id=?,updated_at=? where id=?").run(schemeId, now(), novelId);
      if (!result.changes) throw new Error("小说不存在");
    },

    detachNovelPromptScheme(novelId: string) {
      const novel = sqlite.prepare("select prompt_scheme_id from novels where id=?").get(novelId) as { prompt_scheme_id: string | null } | undefined;
      if (!novel) throw new Error("小说不存在");
      if (!novel.prompt_scheme_id) return;
      const templates = sqlite.prepare("select key,template from prompt_scheme_templates where scheme_id=?").all(novel.prompt_scheme_id) as Array<{ key: StepKey; template: string }>;
      if (templates.length !== stepKeyValues.length) throw new Error("提示词方案不完整");
      sqlite.transaction(() => {
        const timestamp = now();
        const upsert = sqlite.prepare(`insert into prompt_templates (id,novel_id,key,template,created_at,updated_at) values (?,?,?,?,?,?)
          on conflict(novel_id,key) do update set template=excluded.template,updated_at=excluded.updated_at`);
        for (const item of templates) upsert.run(randomUUID(), novelId, item.key, item.template, timestamp, timestamp);
        sqlite.prepare("update novels set prompt_scheme_id=null,updated_at=? where id=?").run(timestamp, novelId);
      })();
    },

    getNovelWorkspace(id: string) {
      const novel = one("select * from novels where id = ?", id);
      if (!novel) return null;
      const schemeId = novel.promptSchemeId ? String(novel.promptSchemeId) : null;
      const scheme = schemeId ? one<Pick<PromptSchemeSummary, "id" | "name">>("select id,name from prompt_schemes where id=?", schemeId) : null;
      return {
        novel: novel as NovelData,
        promptSource: scheme ? { mode: "scheme", schemeId, schemeName: scheme.name } : { mode: "custom", schemeId: null, schemeName: "本书专用" },
        templates: scheme ? all<PromptTemplateData>("select * from prompt_scheme_templates where scheme_id = ? order by created_at", schemeId) : all<PromptTemplateData>("select * from prompt_templates where novel_id = ? order by created_at", id),
        steps: all<NovelStepData>("select * from novel_steps where novel_id = ?", id),
        storyUnits: all<StoryUnitData>("select * from story_units where novel_id = ? order by start_chapter", id),
        chapterOutlines: all<ChapterOutlineData>("select * from chapter_outlines where novel_id = ? order by chapter_number", id),
        chapters: all<ChapterData>("select * from chapters where novel_id = ? order by chapter_number", id),
        contentVersions: all<ContentVersionData>("select * from content_versions where novel_id = ? order by created_at desc", id),
      } satisfies NovelWorkspaceData;
    },

    updateNovel(id: string, patch: Partial<{ name: string; selectedTopic: string; firstVolumeOutline: string; currentStep: StepKey; currentRangeStart: number; currentChapter: number }>) {
      sqlite.transaction(() => {
        const fields: string[] = [];
        const values: unknown[] = [];
        const mapping = { name: "name", selectedTopic: "selected_topic", firstVolumeOutline: "first_volume_outline", currentStep: "current_step", currentRangeStart: "current_range_start", currentChapter: "current_chapter" } as const;
        const current = sqlite.prepare("select selected_topic,first_volume_outline from novels where id=?").get(id) as { selected_topic: string; first_volume_outline: string } | undefined;
        if (!current) throw new Error("小说不存在");
        if (patch.selectedTopic !== undefined && current.selected_topic && current.selected_topic !== patch.selectedTopic) {
          sqlite.prepare("insert into content_versions (id,novel_id,content_type,content_key,content,created_at) values (?,?,?,?,?,?)")
            .run(randomUUID(), id, "novel_field", "selectedTopic", current.selected_topic, now());
        }
        if (patch.firstVolumeOutline !== undefined && current.first_volume_outline && current.first_volume_outline !== patch.firstVolumeOutline) {
          sqlite.prepare("insert into content_versions (id,novel_id,content_type,content_key,content,created_at) values (?,?,?,?,?,?)")
            .run(randomUUID(), id, "novel_field", "firstVolumeOutline", current.first_volume_outline, now());
        }
        for (const [key, column] of Object.entries(mapping)) if (patch[key as keyof typeof patch] !== undefined) {
          fields.push(`${column} = ?`); values.push(patch[key as keyof typeof patch]);
        }
        if (!fields.length) return;
        fields.push("updated_at = ?"); values.push(now(), id);
        sqlite.prepare(`update novels set ${fields.join(", ")} where id = ?`).run(...values);
      })();
    },

    saveStep(novelId: string, key: StepKey, content: string, draft: boolean) {
      const action = sqlite.transaction(() => {
        if (!draft) versionPrevious(novelId, "step", key, "novel_steps", "novel_id=? and key=?", [novelId, key], content);
        const timestamp = now();
        sqlite.prepare(`insert into novel_steps (id, novel_id, key, content, is_draft, created_at, updated_at)
          values (?, ?, ?, ?, ?, ?, ?) on conflict(novel_id,key) do update set content=excluded.content,is_draft=excluded.is_draft,updated_at=excluded.updated_at`)
          .run(randomUUID(), novelId, key, content, draft ? 1 : 0, timestamp, timestamp);
        touch(novelId);
      }); action();
    },

    saveStoryUnit(novelId: string, startChapter: number, content: string, draft: boolean) {
      sqlite.transaction(() => {
        if (!draft) versionPrevious(novelId, "story_unit", String(startChapter), "story_units", "novel_id=? and start_chapter=?", [novelId, startChapter], content);
        const timestamp = now();
        sqlite.prepare(`insert into story_units (id,novel_id,start_chapter,end_chapter,content,is_draft,created_at,updated_at)
          values (?,?,?,?,?,?,?,?) on conflict(novel_id,start_chapter) do update set content=excluded.content,is_draft=excluded.is_draft,updated_at=excluded.updated_at`)
          .run(randomUUID(), novelId, startChapter, startChapter + 9, content, draft ? 1 : 0, timestamp, timestamp); touch(novelId);
      })();
    },

    saveChapterOutline(novelId: string, chapterNumber: number, content: string, draft: boolean) {
      const timestamp = now();
      sqlite.prepare(`insert into chapter_outlines (id,novel_id,chapter_number,content,is_draft,created_at,updated_at)
        values (?,?,?,?,?,?,?) on conflict(novel_id,chapter_number) do update set content=excluded.content,is_draft=excluded.is_draft,updated_at=excluded.updated_at`)
        .run(randomUUID(), novelId, chapterNumber, content, draft ? 1 : 0, timestamp, timestamp); touch(novelId);
    },

    saveChapterOutlineBatch(novelId: string, startChapter: number, content: string, draft: boolean) {
      sqlite.transaction(() => {
        if (!draft) versionPrevious(novelId, "outline_batch", String(startChapter), "chapter_outlines", "novel_id=? and chapter_number=?", [novelId, startChapter], content);
        const timestamp = now();
        const save = sqlite.prepare(`insert into chapter_outlines (id,novel_id,chapter_number,content,is_draft,created_at,updated_at)
          values (?,?,?,?,?,?,?) on conflict(novel_id,chapter_number) do update set content=excluded.content,is_draft=excluded.is_draft,updated_at=excluded.updated_at`);
        for (let chapterNumber = startChapter; chapterNumber < startChapter + 10; chapterNumber += 1) {
          save.run(randomUUID(), novelId, chapterNumber, content, draft ? 1 : 0, timestamp, timestamp);
        }
        touch(novelId);
      })();
    },

    saveChapter(novelId: string, chapterNumber: number, content: string, status: ChapterStatus, draft: boolean) {
      sqlite.transaction(() => {
        if (!draft) versionPrevious(novelId, "chapter", String(chapterNumber), "chapters", "novel_id=? and chapter_number=?", [novelId, chapterNumber], content);
        const timestamp = now();
        sqlite.prepare(`insert into chapters (id,novel_id,chapter_number,content,status,is_draft,created_at,updated_at)
          values (?,?,?,?,?,?,?,?) on conflict(novel_id,chapter_number) do update set content=excluded.content,status=excluded.status,is_draft=excluded.is_draft,updated_at=excluded.updated_at`)
          .run(randomUUID(), novelId, chapterNumber, content, status, draft ? 1 : 0, timestamp, timestamp); touch(novelId);
      })();
    },

    importCodexChapter(novelId: string, chapterNumber: number, content: string, expectedUpdatedAt: number | null, expectedDatabaseContent: string) {
      sqlite.transaction(() => {
        const current = sqlite.prepare("select content,updated_at from chapters where novel_id=? and chapter_number=?").get(novelId, chapterNumber) as { content: string; updated_at: number } | undefined;
        if ((current?.updated_at ?? null) !== expectedUpdatedAt || (current?.content ?? "") !== expectedDatabaseContent) throw new Error("工作台中的正文已在其他窗口更新，请重新读取 Codex 正文后再导入");
        versionPrevious(novelId, "chapter", String(chapterNumber), "chapters", "novel_id=? and chapter_number=?", [novelId, chapterNumber], content);
        const timestamp = now();
        sqlite.prepare(`insert into chapters (id,novel_id,chapter_number,content,status,is_draft,created_at,updated_at)
          values (?,?,?,?,?,?,?,?) on conflict(novel_id,chapter_number) do update set content=excluded.content,status=excluded.status,is_draft=excluded.is_draft,updated_at=excluded.updated_at`)
          .run(randomUUID(), novelId, chapterNumber, content, "saved", 0, timestamp, timestamp);
        touch(novelId);
      })();
    },

    importAutomationNode(input: { novelId: string; kind: "volumes" | "settings" | "units" | "outlines"; startChapter: number | null; content: string; firstVolumeOutline?: string }) {
      sqlite.transaction(() => {
        const timestamp = now();
        const content = input.content.trim();
        if (!content) throw new Error("自动生成结果为空");

        if (input.kind === "volumes" || input.kind === "settings") {
          const key = input.kind;
          versionPrevious(input.novelId, "step", key, "novel_steps", "novel_id=? and key=?", [input.novelId, key], content);
          sqlite.prepare(`insert into novel_steps (id,novel_id,key,content,is_draft,created_at,updated_at)
            values (?,?,?,?,?,?,?) on conflict(novel_id,key) do update set content=excluded.content,is_draft=0,updated_at=excluded.updated_at`)
            .run(randomUUID(), input.novelId, key, content, 0, timestamp, timestamp);

          if (input.kind === "volumes") {
            const firstVolumeOutline = String(input.firstVolumeOutline ?? content).trim();
            versionPrevious(input.novelId, "novel_field", "firstVolumeOutline", "novels", "id=?", [input.novelId], firstVolumeOutline, "first_volume_outline");
            sqlite.prepare("update novels set first_volume_outline=?,updated_at=? where id=?").run(firstVolumeOutline, timestamp, input.novelId);
          }
        } else {
          const startChapter = input.startChapter;
          if (startChapter === null || ![1, 11, 21, 31, 41, 51].includes(startChapter)) throw new Error("自动生成批次范围无效");
          if (input.kind === "units") {
            versionPrevious(input.novelId, "story_unit", String(startChapter), "story_units", "novel_id=? and start_chapter=?", [input.novelId, startChapter], content);
            sqlite.prepare(`insert into story_units (id,novel_id,start_chapter,end_chapter,content,is_draft,created_at,updated_at)
              values (?,?,?,?,?,?,?,?) on conflict(novel_id,start_chapter) do update set content=excluded.content,is_draft=0,updated_at=excluded.updated_at`)
              .run(randomUUID(), input.novelId, startChapter, startChapter + 9, content, 0, timestamp, timestamp);
          } else {
            versionPrevious(input.novelId, "outline_batch", String(startChapter), "chapter_outlines", "novel_id=? and chapter_number=?", [input.novelId, startChapter], content);
            const save = sqlite.prepare(`insert into chapter_outlines (id,novel_id,chapter_number,content,is_draft,created_at,updated_at)
              values (?,?,?,?,?,?,?) on conflict(novel_id,chapter_number) do update set content=excluded.content,is_draft=0,updated_at=excluded.updated_at`);
            for (let chapterNumber = startChapter; chapterNumber < startChapter + 10; chapterNumber += 1) {
              save.run(randomUUID(), input.novelId, chapterNumber, content, 0, timestamp, timestamp);
            }
          }
        }
        touch(input.novelId);
      })();
    },

    updateChapterStatus(novelId: string, chapterNumber: number, status: "saved" | "published") {
      const result = sqlite.prepare("update chapters set status=?,updated_at=? where novel_id=? and chapter_number=? and trim(content)<>''")
        .run(status, now(), novelId, chapterNumber);
      if (!result.changes) throw new Error("正文尚未保存，不能修改发布状态");
      touch(novelId);
    },

    updateTemplate(novelId: string, key: StepKey, template: string) {
      const content = stripLegacyPlaceholders(template);
      sqlite.transaction(() => {
        versionPrevious(novelId, "template", key, "prompt_templates", "novel_id=? and key=?", [novelId, key], content, "template");
        const result = sqlite.prepare("update prompt_templates set template=?, updated_at=? where novel_id=? and key=?").run(content, now(), novelId, key);
        if (!result.changes) throw new Error("本书正在跟随提示词方案，请先切换为本书专用");
        touch(novelId);
      })();
    },

    restoreContentVersion(novelId: string, versionId: string) {
      const version = one<ContentVersionData>("select * from content_versions where id=? and novel_id=?", versionId, novelId);
      if (!version) throw new Error("历史版本不存在");
      switch (version.contentType) {
        case "step": this.saveStep(novelId, version.contentKey as StepKey, version.content, false); break;
        case "novel_field":
          if (version.contentKey !== "selectedTopic" && version.contentKey !== "firstVolumeOutline") throw new Error("历史版本字段无效");
          this.updateNovel(novelId, { [version.contentKey]: version.content }); break;
        case "story_unit": this.saveStoryUnit(novelId, Number(version.contentKey), version.content, false); break;
        case "outline_batch": this.saveChapterOutlineBatch(novelId, Number(version.contentKey), version.content, false); break;
        case "chapter": {
          const chapterNumber = Number(version.contentKey);
          const current = one<Pick<ChapterData, "status">>("select status from chapters where novel_id=? and chapter_number=?", novelId, chapterNumber);
          this.saveChapter(novelId, chapterNumber, version.content, current?.status === "published" ? "published" : "saved", false);
          break;
        }
        case "template": this.updateTemplate(novelId, version.contentKey as StepKey, version.content); break;
        default: throw new Error("不支持的历史版本类型");
      }
      return version;
    },
    deleteNovel(id: string) { sqlite.prepare("delete from novels where id = ?").run(id); },
  };
}

type NovelRepository = ReturnType<typeof createNovelRepository>;
let appRepository: NovelRepository | undefined;

function getAppRepository() {
  appRepository ??= createNovelRepository(getNovelSqlite());
  return appRepository;
}

export const novelRepository = new Proxy({} as NovelRepository, {
  get(_target, property) {
    const repository = getAppRepository();
    const value = repository[property as keyof NovelRepository];
    return typeof value === "function" ? value.bind(repository) : value;
  },
});
export type NovelWorkspace = NovelWorkspaceData;
