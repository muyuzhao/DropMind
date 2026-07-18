import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { stepKeyValues, type ChapterStatus, type StepKey } from "../../lib/novel-db/schema";
import { novelSqlite } from "../../lib/novel-db";
import { stripLegacyPlaceholders } from "./structured-prompts";

type CreateNovelInput = { name: string; referenceTitle: string; referenceSummary: string };
type Row = Record<string, unknown>;
type NovelRecord = { id: string; name: string; referenceTitle: string; referenceSummary: string; selectedTopic: string; firstVolumeOutline: string; promptSchemeId: string | null; currentStep: StepKey; currentRangeStart: number; currentChapter: number; createdAt: number; updatedAt: number };

function camel(row: Row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]));
}

export function createNovelRepository(sqlite: Database.Database) {
  const now = () => Date.now();
  const touch = (novelId: string) => sqlite.prepare("update novels set updated_at = ? where id = ?").run(now(), novelId);
  const all = (sql: string, ...args: unknown[]) => (sqlite.prepare(sql).all(...args) as Row[]).map(camel);
  const one = <T extends Row = Row>(sql: string, ...args: unknown[]) => {
    const row = sqlite.prepare(sql).get(...args) as Row | undefined;
    return row ? camel(row) as T : null;
  };

  function versionPrevious(novelId: string, contentType: string, contentKey: string, table: string, where: string, args: unknown[]) {
    const previous = sqlite.prepare(`select content from ${table} where ${where}`).get(...args) as { content: string } | undefined;
    if (previous?.content) {
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
      return one<NovelRecord & Row>("select * from novels where id = ?", id)!;
    },

    listNovels() {
      return all(`select n.*,
        (select count(*) from chapters c where c.novel_id=n.id and c.content<>'') completed_count,
        (select count(*) from chapters c where c.novel_id=n.id and c.status='published') published_count
        from novels n order by n.updated_at desc`);
    },

    getNovel(id: string) { return one<NovelRecord & Row>("select * from novels where id = ?", id); },
    getTemplates(novelId: string) { return all("select * from prompt_templates where novel_id = ? order by created_at", novelId); },
    listPromptSchemes() { return all("select * from prompt_schemes order by is_default desc,updated_at desc"); },
    getPromptScheme(id: string) { const scheme=one("select * from prompt_schemes where id=?",id); return scheme ? {...scheme,templates:all("select * from prompt_scheme_templates where scheme_id=? order by created_at",id)} : null; },
    createPromptScheme(input: {name:string;description:string;sourceSchemeId?:string}) {
      const id=randomUUID(), timestamp=now(), source=input.sourceSchemeId??"system-default";
      sqlite.transaction(()=>{ sqlite.prepare("insert into prompt_schemes (id,name,description,is_system,is_default,created_at,updated_at) values (?,?,?,?,?,?,?)").run(id,input.name,input.description,0,0,timestamp,timestamp);
        const rows=sqlite.prepare("select key,template from prompt_scheme_templates where scheme_id=?").all(source) as Array<{key:string;template:string}>;
        const ins=sqlite.prepare("insert into prompt_scheme_templates (id,scheme_id,key,template,created_at,updated_at) values (?,?,?,?,?,?)"); for(const row of rows) ins.run(randomUUID(),id,row.key,row.template,timestamp,timestamp); })(); return one<{id:string}&Row>("select * from prompt_schemes where id=?",id)!;
    },
    updatePromptScheme(id:string, patch:{name:string;description:string}) { sqlite.prepare("update prompt_schemes set name=?,description=?,updated_at=? where id=?").run(patch.name,patch.description,now(),id); },
    updatePromptSchemeTemplate(id:string,key:StepKey,template:string){ sqlite.prepare("update prompt_scheme_templates set template=?,updated_at=? where scheme_id=? and key=?").run(stripLegacyPlaceholders(template),now(),id,key); },
    setDefaultPromptScheme(id:string){ sqlite.transaction(()=>{sqlite.prepare("update prompt_schemes set is_default=0").run();sqlite.prepare("update prompt_schemes set is_default=1 where id=?").run(id);})(); },
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
      const scheme = schemeId ? one("select id,name from prompt_schemes where id=?", schemeId) : null;
      return {
        novel,
        promptSource: scheme ? { mode: "scheme", schemeId, schemeName: scheme.name } : { mode: "custom", schemeId: null, schemeName: "本书专用" },
        templates: scheme ? all("select * from prompt_scheme_templates where scheme_id = ? order by created_at", schemeId) : all("select * from prompt_templates where novel_id = ? order by created_at", id),
        steps: all("select * from novel_steps where novel_id = ?", id),
        storyUnits: all("select * from story_units where novel_id = ? order by start_chapter", id),
        chapterOutlines: all("select * from chapter_outlines where novel_id = ? order by chapter_number", id),
        chapters: all("select * from chapters where novel_id = ? order by chapter_number", id),
      };
    },

    updateNovel(id: string, patch: Partial<{ name: string; selectedTopic: string; firstVolumeOutline: string; currentStep: StepKey; currentRangeStart: number; currentChapter: number }>) {
      const fields: string[] = [];
      const values: unknown[] = [];
      const mapping = { name: "name", selectedTopic: "selected_topic", firstVolumeOutline: "first_volume_outline", currentStep: "current_step", currentRangeStart: "current_range_start", currentChapter: "current_chapter" } as const;
      for (const [key, column] of Object.entries(mapping)) if (patch[key as keyof typeof patch] !== undefined) {
        fields.push(`${column} = ?`); values.push(patch[key as keyof typeof patch]);
      }
      if (!fields.length) return;
      fields.push("updated_at = ?"); values.push(now(), id);
      sqlite.prepare(`update novels set ${fields.join(", ")} where id = ?`).run(...values);
    },

    saveStep(novelId: string, key: StepKey, content: string, draft: boolean) {
      const action = sqlite.transaction(() => {
        if (!draft) versionPrevious(novelId, "step", key, "novel_steps", "novel_id=? and key=?", [novelId, key]);
        const timestamp = now();
        sqlite.prepare(`insert into novel_steps (id, novel_id, key, content, is_draft, created_at, updated_at)
          values (?, ?, ?, ?, ?, ?, ?) on conflict(novel_id,key) do update set content=excluded.content,is_draft=excluded.is_draft,updated_at=excluded.updated_at`)
          .run(randomUUID(), novelId, key, content, draft ? 1 : 0, timestamp, timestamp);
        touch(novelId);
      }); action();
    },

    saveStoryUnit(novelId: string, startChapter: number, content: string, draft: boolean) {
      const timestamp = now();
      sqlite.prepare(`insert into story_units (id,novel_id,start_chapter,end_chapter,content,is_draft,created_at,updated_at)
        values (?,?,?,?,?,?,?,?) on conflict(novel_id,start_chapter) do update set content=excluded.content,is_draft=excluded.is_draft,updated_at=excluded.updated_at`)
        .run(randomUUID(), novelId, startChapter, startChapter + 9, content, draft ? 1 : 0, timestamp, timestamp); touch(novelId);
    },

    saveChapterOutline(novelId: string, chapterNumber: number, content: string, draft: boolean) {
      const timestamp = now();
      sqlite.prepare(`insert into chapter_outlines (id,novel_id,chapter_number,content,is_draft,created_at,updated_at)
        values (?,?,?,?,?,?,?) on conflict(novel_id,chapter_number) do update set content=excluded.content,is_draft=excluded.is_draft,updated_at=excluded.updated_at`)
        .run(randomUUID(), novelId, chapterNumber, content, draft ? 1 : 0, timestamp, timestamp); touch(novelId);
    },

    saveChapter(novelId: string, chapterNumber: number, content: string, status: ChapterStatus, draft: boolean) {
      sqlite.transaction(() => {
        if (!draft) versionPrevious(novelId, "chapter", String(chapterNumber), "chapters", "novel_id=? and chapter_number=?", [novelId, chapterNumber]);
        const timestamp = now();
        sqlite.prepare(`insert into chapters (id,novel_id,chapter_number,content,status,is_draft,created_at,updated_at)
          values (?,?,?,?,?,?,?,?) on conflict(novel_id,chapter_number) do update set content=excluded.content,status=excluded.status,is_draft=excluded.is_draft,updated_at=excluded.updated_at`)
          .run(randomUUID(), novelId, chapterNumber, content, status, draft ? 1 : 0, timestamp, timestamp); touch(novelId);
      })();
    },

    updateTemplate(novelId: string, key: StepKey, template: string) {
      sqlite.prepare("update prompt_templates set template=?, updated_at=? where novel_id=? and key=?").run(stripLegacyPlaceholders(template), now(), novelId, key); touch(novelId);
    },
    deleteNovel(id: string) { sqlite.prepare("delete from novels where id = ?").run(id); },
  };
}

export const novelRepository = createNovelRepository(novelSqlite);
export type NovelWorkspace = NonNullable<ReturnType<typeof novelRepository.getNovelWorkspace>>;
