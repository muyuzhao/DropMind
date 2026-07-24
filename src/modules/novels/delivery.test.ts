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
    const queued = delivery.queueChapter(novel.id, 1, "2026-07-20");
    const state = delivery.getNovelState(novel.id);

    expect(state.target).toMatchObject({ bookName: "番茄作品", defaultVolume: "第一卷" });
    expect(queued).toMatchObject({ chapterNumber: 1, chapterTitle: "初入王府", publishDate: "2026-07-20", contentLength: 5, status: "ready" });
    expect(delivery.queueChapter(novel.id, 1, "2026-07-20").id).toBe(queued.id);
  });

  it("claims, fills and submits a queued chapter with the extension token", () => {
    const novel = savedChapter();
    delivery.queueChapter(novel.id, 1, "2026-07-20");
    const token = delivery.getNovelState(novel.id).connectionToken;
    const claimed = delivery.claimNext(token)!;

    expect(claimed).toMatchObject({ novelName: "测试作品", chapterContent: "第一章正文", publishDate: "2026-07-20", status: "claimed" });
    expect(delivery.updateFromExtension(token, claimed.id, "filled").status).toBe("filled");
    expect(delivery.updateFromExtension(token, claimed.id, "submitted").status).toBe("submitted");
  });

  it("claims the exact job selected from the workbench and can resume it", () => {
    const firstNovel = savedChapter();
    const first = delivery.queueChapter(firstNovel.id, 1, "2026-07-20");
    const secondNovel = novels.createNovel({ name: "第二部作品", referenceTitle: "参考", referenceSummary: "简介" });
    novels.saveChapter(secondNovel.id, 1, "第二部正文", "saved", false, "第二部首章");
    delivery.saveTarget({ novelId: secondNovel.id, bookName: "番茄第二部", manageUrl: "https://fanqienovel.com/main/writer/book-manage", defaultVolume: "第一卷" });
    const second = delivery.queueChapter(secondNovel.id, 1, "2026-07-21");
    const token = delivery.getNovelState(firstNovel.id).connectionToken;

    expect(delivery.claimNext(token, second.id)).toMatchObject({ id: second.id, status: "claimed", novelName: "第二部作品" });
    expect(delivery.claimNext(token, second.id)).toMatchObject({ id: second.id, status: "claimed" });
    expect(delivery.getNovelState(firstNovel.id).jobs[0]).toMatchObject({ id: first.id, status: "ready" });
  });

  it("marks a queued snapshot stale when the chapter changes", () => {
    const novel = savedChapter();
    delivery.queueChapter(novel.id, 1, "2026-07-20");
    novels.saveChapter(novel.id, 1, "修改后的正文", "saved", false, "新标题");
    const token = delivery.getNovelState(novel.id).connectionToken;

    expect(delivery.claimNext(token)).toBeNull();
    expect(delivery.getNovelState(novel.id).jobs[0]).toMatchObject({ status: "stale", lastError: "工作台中的章节已修改，请重新加入投递队列" });
  });

  it("rejects an invalid extension token", () => {
    const novel = savedChapter();
    delivery.queueChapter(novel.id, 1, "2026-07-20");
    expect(() => delivery.claimNext("wrong-token")).toThrow("投递连接令牌无效");
  });

  it("keeps submitted jobs separate from the chapter published status", () => {
    const novel = savedChapter();
    delivery.queueChapter(novel.id, 1, "2026-07-20");
    const token = delivery.getNovelState(novel.id).connectionToken;
    const claimed = delivery.claimNext(token)!;
    delivery.updateFromExtension(token, claimed.id, "submitted");

    expect(novels.getNovelWorkspace(novel.id)!.chapters[0].status).toBe("saved");
  });

  it("updates a queued chapter date before the extension claims it", () => {
    const novel = savedChapter();
    const queued = delivery.queueChapter(novel.id, 1, "2026-07-20");

    const updated = delivery.queueChapter(novel.id, 1, "2026-07-21");

    expect(updated).toMatchObject({ id: queued.id, publishDate: "2026-07-21", status: "ready" });
  });

  it("does not change the date after the extension claims a chapter", () => {
    const novel = savedChapter();
    delivery.queueChapter(novel.id, 1, "2026-07-20");
    delivery.claimNext(delivery.getNovelState(novel.id).connectionToken);

    expect(() => delivery.queueChapter(novel.id, 1, "2026-07-21")).toThrow("扩展已经领取本章");
  });
});
