import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { initializeNovelDatabase } from "../../lib/novel-db";
import { createDeliveryRepository } from "./delivery";
import { createNovelRepository } from "./repository";

describe("fanqie delivery repository", () => {
  let sqlite: Database.Database;
  let novels: ReturnType<typeof createNovelRepository>;
  let delivery: ReturnType<typeof createDeliveryRepository>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    initializeNovelDatabase(sqlite);
    novels = createNovelRepository(sqlite);
    delivery = createDeliveryRepository(sqlite);
  });

  function savedChapter() {
    const novel = novels.createNovel({ name: "测试作品", referenceTitle: "参考", referenceSummary: "简介" });
    novels.saveChapter(novel.id, 1, "第一章正文", "saved", false, "初入王府");
    delivery.saveTarget({ novelId: novel.id, bookName: "番茄作品", manageUrl: "https://fanqienovel.com/main/writer/book-manage", defaultVolume: "第一卷" });
    return novel;
  }

  it("stores a target and queues an immutable chapter snapshot", () => {
    const novel = savedChapter();
    const queued = delivery.queueChapter(novel.id, 1);
    const state = delivery.getNovelState(novel.id);

    expect(state.target).toMatchObject({ bookName: "番茄作品", defaultVolume: "第一卷" });
    expect(queued).toMatchObject({ chapterNumber: 1, chapterTitle: "初入王府", contentLength: 5, status: "ready" });
    expect(delivery.queueChapter(novel.id, 1).id).toBe(queued.id);
  });

  it("claims, fills and submits a queued chapter with the extension token", () => {
    const novel = savedChapter();
    delivery.queueChapter(novel.id, 1);
    const token = delivery.getNovelState(novel.id).connectionToken;
    const claimed = delivery.claimNext(token)!;

    expect(claimed).toMatchObject({ novelName: "测试作品", chapterContent: "第一章正文", status: "claimed" });
    expect(delivery.updateFromExtension(token, claimed.id, "filled").status).toBe("filled");
    expect(delivery.updateFromExtension(token, claimed.id, "submitted").status).toBe("submitted");
  });

  it("marks a queued snapshot stale when the chapter changes", () => {
    const novel = savedChapter();
    delivery.queueChapter(novel.id, 1);
    novels.saveChapter(novel.id, 1, "修改后的正文", "saved", false, "新标题");
    const token = delivery.getNovelState(novel.id).connectionToken;

    expect(delivery.claimNext(token)).toBeNull();
    expect(delivery.getNovelState(novel.id).jobs[0]).toMatchObject({ status: "stale", lastError: "工作台中的章节已修改，请重新加入投递队列" });
  });

  it("rejects an invalid extension token", () => {
    const novel = savedChapter();
    delivery.queueChapter(novel.id, 1);
    expect(() => delivery.claimNext("wrong-token")).toThrow("投递连接令牌无效");
  });

  it("keeps submitted jobs separate from the chapter published status", () => {
    const novel = savedChapter();
    delivery.queueChapter(novel.id, 1);
    const token = delivery.getNovelState(novel.id).connectionToken;
    const claimed = delivery.claimNext(token)!;
    delivery.updateFromExtension(token, claimed.id, "submitted");

    expect(novels.getNovelWorkspace(novel.id)!.chapters[0].status).toBe("saved");
  });
});
