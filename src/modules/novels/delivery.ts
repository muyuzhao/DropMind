import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { getNovelSqlite } from "../../lib/novel-db";
import { ensureDeliverySchema } from "../../lib/novel-db/initialize";

export const deliveryJobStatuses = ["ready", "claimed", "filled", "submitted", "failed", "stale", "cancelled"] as const;
export type DeliveryJobStatus = typeof deliveryJobStatuses[number];

export type DeliveryTargetData = {
  novelId: string;
  platform: "fanqie";
  bookName: string;
  manageUrl: string;
  defaultVolume: string;
  createdAt: number;
  updatedAt: number;
};

export type DeliveryJobData = {
  id: string;
  novelId: string;
  chapterNumber: number;
  platform: "fanqie";
  targetBookName: string;
  targetManageUrl: string;
  chapterTitle: string;
  contentHash: string;
  contentLength: number;
  status: DeliveryJobStatus;
  lastError: string;
  claimedAt: number | null;
  filledAt: number | null;
  submittedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ClaimedDeliveryJob = DeliveryJobData & {
  novelName: string;
  chapterContent: string;
};

export type NovelDeliveryState = {
  connectionToken: string;
  target: DeliveryTargetData | null;
  jobs: DeliveryJobData[];
};

type Row = Record<string, unknown>;
const CLAIM_TIMEOUT_MS = 30 * 60 * 1000;

function contentHash(title: string, content: string) {
  return createHash("sha256").update(title).update("\0").update(content).digest("hex");
}

function targetFromRow(row: Row | undefined): DeliveryTargetData | null {
  if (!row) return null;
  return {
    novelId: String(row.novel_id), platform: "fanqie", bookName: String(row.book_name), manageUrl: String(row.manage_url),
    defaultVolume: String(row.default_volume), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function jobFromRow(row: Row): DeliveryJobData {
  return {
    id: String(row.id), novelId: String(row.novel_id), chapterNumber: Number(row.chapter_number), platform: "fanqie",
    targetBookName: String(row.target_book_name), targetManageUrl: String(row.target_manage_url), chapterTitle: String(row.chapter_title),
    contentHash: String(row.content_hash), contentLength: Number(row.content_length ?? String(row.chapter_content ?? "").length),
    status: String(row.status) as DeliveryJobStatus, lastError: String(row.last_error ?? ""),
    claimedAt: row.claimed_at === null || row.claimed_at === undefined ? null : Number(row.claimed_at),
    filledAt: row.filled_at === null || row.filled_at === undefined ? null : Number(row.filled_at),
    submittedAt: row.submitted_at === null || row.submitted_at === undefined ? null : Number(row.submitted_at),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

function safeTokenEqual(actual: string, supplied: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createDeliveryRepository(sqlite: Database.Database) {
  ensureDeliverySchema(sqlite);
  const now = () => Date.now();

  function connectionToken() {
    const existing = sqlite.prepare("select connection_token from delivery_settings where id=?").get("local") as { connection_token: string } | undefined;
    if (existing) return existing.connection_token;
    const timestamp = now();
    const token = randomBytes(24).toString("base64url");
    sqlite.prepare("insert into delivery_settings (id,connection_token,created_at,updated_at) values (?,?,?,?)")
      .run("local", token, timestamp, timestamp);
    return token;
  }

  function assertToken(token: string) {
    if (!token || !safeTokenEqual(connectionToken(), token)) throw new Error("投递连接令牌无效");
  }

  function getTarget(novelId: string) {
    return targetFromRow(sqlite.prepare("select * from delivery_targets where novel_id=?").get(novelId) as Row | undefined);
  }

  function getJobs(novelId: string) {
    return (sqlite.prepare("select *,length(chapter_content) content_length from delivery_jobs where novel_id=? order by chapter_number,created_at").all(novelId) as Row[]).map(jobFromRow);
  }

  return {
    verifyConnection(token: string) {
      assertToken(token);
      return true;
    },

    getNovelState(novelId: string): NovelDeliveryState {
      return { connectionToken: connectionToken(), target: getTarget(novelId), jobs: getJobs(novelId) };
    },

    saveTarget(input: { novelId: string; bookName: string; manageUrl: string; defaultVolume: string }) {
      const novel = sqlite.prepare("select 1 from novels where id=?").get(input.novelId);
      if (!novel) throw new Error("小说不存在");
      const timestamp = now();
      sqlite.prepare(`insert into delivery_targets (novel_id,platform,book_name,manage_url,default_volume,created_at,updated_at)
        values (?,?,?,?,?,?,?) on conflict(novel_id) do update set book_name=excluded.book_name,manage_url=excluded.manage_url,
        default_volume=excluded.default_volume,updated_at=excluded.updated_at`)
        .run(input.novelId, "fanqie", input.bookName, input.manageUrl, input.defaultVolume, timestamp, timestamp);
      return getTarget(input.novelId)!;
    },

    queueChapter(novelId: string, chapterNumber: number) {
      return sqlite.transaction(() => {
        const target = getTarget(novelId);
        if (!target) throw new Error("请先在发布准备中绑定番茄作品");
        const chapter = sqlite.prepare("select title,content,status from chapters where novel_id=? and chapter_number=?").get(novelId, chapterNumber) as { title: string; content: string; status: string } | undefined;
        if (!chapter?.title.trim()) throw new Error("章节标题为空，不能投递");
        if (!chapter.content.trim()) throw new Error("章节正文为空，不能投递");
        if (chapter.status === "published") throw new Error("本章已经标记为已发布，不需要再次投递");
        const hash = contentHash(chapter.title, chapter.content);
        const existing = sqlite.prepare("select * from delivery_jobs where novel_id=? and chapter_number=? and platform=?").get(novelId, chapterNumber, "fanqie") as Row | undefined;
        if (existing && String(existing.content_hash) === hash && ["ready", "claimed", "filled", "submitted"].includes(String(existing.status))) return jobFromRow({ ...existing, content_length: chapter.content.length });
        if (existing && String(existing.status) === "submitted") throw new Error("本章已有提交记录；如需重投，请先确认平台状态并取消旧任务");
        const timestamp = now();
        const id = existing ? String(existing.id) : randomUUID();
        sqlite.prepare(`insert into delivery_jobs (id,novel_id,chapter_number,platform,target_book_name,target_manage_url,chapter_title,chapter_content,content_hash,status,last_error,created_at,updated_at)
          values (?,?,?,?,?,?,?,?,?,'ready','',?,?) on conflict(novel_id,chapter_number,platform) do update set
          target_book_name=excluded.target_book_name,target_manage_url=excluded.target_manage_url,chapter_title=excluded.chapter_title,
          chapter_content=excluded.chapter_content,content_hash=excluded.content_hash,status='ready',last_error='',claimed_at=null,filled_at=null,submitted_at=null,updated_at=excluded.updated_at`)
          .run(id, novelId, chapterNumber, "fanqie", target.bookName, target.manageUrl, chapter.title, chapter.content, hash, timestamp, timestamp);
        const queued = sqlite.prepare("select *,length(chapter_content) content_length from delivery_jobs where id=?").get(id) as Row;
        return jobFromRow(queued);
      })();
    },

    cancelJob(novelId: string, jobId: string) {
      const current = sqlite.prepare("select status from delivery_jobs where id=? and novel_id=?").get(jobId, novelId) as { status: string } | undefined;
      if (!current) throw new Error("投递任务不存在");
      if (current.status === "submitted") throw new Error("已提交的任务不能直接取消");
      sqlite.prepare("update delivery_jobs set status='cancelled',last_error='',updated_at=? where id=? and novel_id=?").run(now(), jobId, novelId);
      return getJobs(novelId).find((job) => job.id === jobId)!;
    },

    claimNext(token: string): ClaimedDeliveryJob | null {
      assertToken(token);
      return sqlite.transaction(() => {
        const timestamp = now();
        sqlite.prepare("update delivery_jobs set status='ready',claimed_at=null,updated_at=? where status='claimed' and claimed_at<?")
          .run(timestamp, timestamp - CLAIM_TIMEOUT_MS);
        const ready = sqlite.prepare("select * from delivery_jobs where status='ready' order by created_at limit 100").all() as Row[];
        for (const row of ready) {
          const chapter = sqlite.prepare("select title,content from chapters where novel_id=? and chapter_number=?").get(row.novel_id, row.chapter_number) as { title: string; content: string } | undefined;
          if (!chapter || contentHash(chapter.title, chapter.content) !== String(row.content_hash)) {
            sqlite.prepare("update delivery_jobs set status='stale',last_error=?,updated_at=? where id=?").run("工作台中的章节已修改，请重新加入投递队列", timestamp, row.id);
            continue;
          }
          const claimed = sqlite.prepare("update delivery_jobs set status='claimed',claimed_at=?,last_error='',updated_at=? where id=? and status='ready'").run(timestamp, timestamp, row.id);
          if (!claimed.changes) continue;
          const full = sqlite.prepare(`select j.*,length(j.chapter_content) content_length,n.name novel_name
            from delivery_jobs j join novels n on n.id=j.novel_id where j.id=?`).get(row.id) as Row;
          return { ...jobFromRow(full), novelName: String(full.novel_name), chapterContent: String(full.chapter_content) };
        }
        return null;
      })();
    },

    updateFromExtension(token: string, jobId: string, status: "filled" | "submitted" | "failed", error = "") {
      assertToken(token);
      return sqlite.transaction(() => {
        const current = sqlite.prepare("select * from delivery_jobs where id=?").get(jobId) as Row | undefined;
        if (!current) throw new Error("投递任务不存在");
        const currentStatus = String(current.status);
        const allowed = status === "filled" ? ["claimed", "filled"] : status === "submitted" ? ["claimed", "filled", "submitted"] : ["claimed", "filled", "failed"];
        if (!allowed.includes(currentStatus)) throw new Error(`任务当前状态为 ${currentStatus}，不能更新为 ${status}`);
        const timestamp = now();
        const filledAt = status === "filled" || status === "submitted" ? Number(current.filled_at ?? timestamp) : current.filled_at;
        const submittedAt = status === "submitted" ? Number(current.submitted_at ?? timestamp) : current.submitted_at;
        sqlite.prepare("update delivery_jobs set status=?,last_error=?,filled_at=?,submitted_at=?,updated_at=? where id=?")
          .run(status, status === "failed" ? error.trim().slice(0, 1000) || "扩展填入失败" : "", filledAt, submittedAt, timestamp, jobId);
        const updated = sqlite.prepare("select *,length(chapter_content) content_length from delivery_jobs where id=?").get(jobId) as Row;
        return jobFromRow(updated);
      })();
    },
  };
}

type DeliveryRepository = ReturnType<typeof createDeliveryRepository>;
let appRepository: DeliveryRepository | undefined;

function getAppDeliveryRepository() {
  if (appRepository) return appRepository;
  const sqlite = getNovelSqlite();
  ensureDeliverySchema(sqlite);
  appRepository = createDeliveryRepository(sqlite);
  return appRepository;
}

export const deliveryRepository = new Proxy({} as DeliveryRepository, {
  get(_target, property) {
    const repository = getAppDeliveryRepository();
    const value = repository[property as keyof DeliveryRepository];
    return typeof value === "function" ? value.bind(repository) : value;
  },
});

export function deliverySnapshotHash(title: string, content: string) {
  return contentHash(title, content);
}
