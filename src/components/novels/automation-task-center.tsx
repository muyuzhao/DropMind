"use client";

import type { AutomationManifest } from "@/modules/novels/automation";
import type { ChapterAutomationManifest } from "@/modules/novels/chapter-automation";
import { AUTOMATION_TASK_STATUS_LABELS, automationTaskProgress, nextChapterBatchStart } from "@/modules/novels/automation-task";

export type AutomationTaskView = "planning" | "chapters";

type Props = {
  planningTask: AutomationManifest | null;
  chapterTask: ChapterAutomationManifest | null;
  activeView: AutomationTaskView | null;
  onOpenPlanning: () => void;
  onOpenChapters: () => void;
  onReturnEditor: () => void;
  onReviewPlanning: () => void;
  onPreparePublishing: () => void;
  onViewChapter: (chapter: number) => void;
  onContinueChapterBatch: (startChapter: number) => void;
};

function currentNodeLabel(manifest: AutomationManifest | ChapterAutomationManifest) {
  if (!manifest.currentNode) return "";
  return manifest.nodes.find((node) => node.id === manifest.currentNode)?.label ?? "";
}

export function AutomationTaskCenter({ planningTask, chapterTask, activeView, onOpenPlanning, onOpenChapters, onReturnEditor, onReviewPlanning, onPreparePublishing, onViewChapter, onContinueChapterBatch }: Props) {
  if (!planningTask && !chapterTask && !activeView) return null;

  const planningProgress = planningTask ? automationTaskProgress(planningTask) : null;
  const chapterProgress = chapterTask ? automationTaskProgress(chapterTask) : null;
  const nextBatchStart = chapterTask ? nextChapterBatchStart(chapterTask.endChapter) : null;

  return <aside className="automation-task-center" aria-label="自动任务中心">
    {(planningTask || activeView === "planning") && <div className={`automation-task-row status-${planningTask?.status ?? "empty"}`}>
      <div className="automation-task-summary">
        <i aria-hidden="true" />
        <strong>自动规划</strong>
        <span>{planningTask && planningProgress ? `${planningProgress.completed}/${planningProgress.total} · ${AUTOMATION_TASK_STATUS_LABELS[planningTask.status] ?? planningTask.status}` : "尚未创建"}</span>
        {planningTask && currentNodeLabel(planningTask) && <small>{currentNodeLabel(planningTask)}</small>}
      </div>
      <div className="automation-task-actions">
        {planningProgress?.handoffReady && <><button type="button" onClick={onReviewPlanning}>抽查结果</button><button type="button" className="save-secondary" onClick={onPreparePublishing}>进入发布准备</button></>}
        <button type="button" className="save-secondary" aria-pressed={activeView === "planning"} onClick={onOpenPlanning}>查看进度</button>
        {activeView === "planning" && <button type="button" onClick={onReturnEditor}>返回编辑</button>}
      </div>
    </div>}
    {(chapterTask || activeView === "chapters") && <div className={`automation-task-row status-${chapterTask?.status ?? "empty"}`}>
      <div className="automation-task-summary">
        <i aria-hidden="true" />
        <strong>{chapterTask ? `自动正文 ${chapterTask.startChapter}–${chapterTask.endChapter} 章` : "自动正文"}</strong>
        <span>{chapterTask && chapterProgress ? `${chapterProgress.completed}/${chapterProgress.total} · ${AUTOMATION_TASK_STATUS_LABELS[chapterTask.status] ?? chapterTask.status}` : "尚未创建"}</span>
        {chapterTask && currentNodeLabel(chapterTask) && <small>{currentNodeLabel(chapterTask)}</small>}
      </div>
      <div className="automation-task-actions">
        {chapterTask && chapterProgress?.handoffReady && <button type="button" onClick={() => onViewChapter(chapterTask.startChapter)}>查看第 {chapterTask.startChapter} 章</button>}
        {chapterProgress?.handoffReady && nextBatchStart && <button type="button" className="save-secondary" onClick={() => onContinueChapterBatch(nextBatchStart)}>继续下一批</button>}
        <button type="button" className="save-secondary" aria-pressed={activeView === "chapters"} onClick={onOpenChapters}>查看进度</button>
        {activeView === "chapters" && <button type="button" onClick={onReturnEditor}>返回编辑</button>}
      </div>
    </div>}
    {activeView && <p className="automation-task-note">返回编辑不会停止任务；任务仍由本地 Codex 在浏览器之外继续执行。</p>}
  </aside>;
}
