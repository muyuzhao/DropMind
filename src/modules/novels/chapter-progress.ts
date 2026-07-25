import type { NovelWorkspaceData } from "./types";

const MAX_CHAPTER = 60;

export function nextWritableChapter(workspace: NovelWorkspaceData) {
  for (let chapterNumber = 1; chapterNumber <= MAX_CHAPTER; chapterNumber += 1) {
    const chapter = workspace.chapters.find((row) => Number(row.chapterNumber) === chapterNumber);
    if (!String(chapter?.content ?? "").trim()) return chapterNumber;
  }
  return null;
}

export function chapterGenerationGuard(workspace: NovelWorkspaceData, chapterNumber: number) {
  const nextChapter = nextWritableChapter(workspace);
  const current = workspace.chapters.find((row) => Number(row.chapterNumber) === chapterNumber);
  if (String(current?.status ?? "not_started") === "published") {
    return { allowed: false, nextChapter, reason: `第${chapterNumber}章已经发布，不能创建正文生成任务` };
  }
  if (nextChapter === null) {
    return { allowed: false, nextChapter, reason: "第一卷第1–60章均已有正文，不能再创建普通正文生成任务" };
  }
  if (chapterNumber < nextChapter || String(current?.content ?? "").trim()) {
    return { allowed: false, nextChapter, reason: `第${chapterNumber}章已有正文；普通正文生成只能从第${nextChapter}章继续，如需修改请使用正文编辑器` };
  }
  if (chapterNumber > nextChapter) {
    return { allowed: false, nextChapter, reason: `正文需要连续创作，请先完成第${nextChapter}章` };
  }
  return { allowed: true, nextChapter, reason: null };
}

export function assertChapterGenerationAllowed(workspace: NovelWorkspaceData, chapterNumber: number) {
  const guard = chapterGenerationGuard(workspace, chapterNumber);
  if (!guard.allowed) throw new Error(guard.reason!);
  return guard;
}
