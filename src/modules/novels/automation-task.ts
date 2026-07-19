export const AUTOMATION_TASK_STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
  paused: "已暂停",
  stale: "资料已变化",
  terminated: "已终止",
};

type TaskNode = {
  status: string;
  imported: boolean;
};

type TaskManifest = {
  status: string;
  nodes: TaskNode[];
};

export function automationTaskProgress(manifest: TaskManifest) {
  const total = manifest.nodes.length;
  const completed = manifest.nodes.filter((node) => node.status === "completed").length;
  const imported = manifest.nodes.filter((node) => node.imported).length;
  const handoffReady = manifest.status === "completed"
    && total > 0
    && manifest.nodes.every((node) => node.status === "completed" && node.imported);
  return { total, completed, imported, handoffReady };
}

export function nextChapterBatchStart(endChapter: number) {
  return endChapter < 60 ? endChapter + 1 : null;
}

export function maxChapterBatchCount(startChapter: number) {
  return Math.min(10, Math.max(1, 61 - startChapter));
}

export function chapterBatchEnd(startChapter: number, chapterCount: number) {
  return startChapter + chapterCount - 1;
}
