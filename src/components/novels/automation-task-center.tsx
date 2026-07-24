"use client";

import type { MouseEvent } from "react";
import type { AutomationManifest } from "@/modules/novels/automation";
import type { ChapterAutomationManifest } from "@/modules/novels/chapter-automation";
import { AUTOMATION_TASK_STATUS_LABELS, automationTaskProgress, automationTaskTriggerSummary, nextChapterBatchStart } from "@/modules/novels/automation-task";

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
  const trigger = automationTaskTriggerSummary([
    ...(planningTask && planningProgress ? [{ label: "自动规划", status: planningTask.status, completed: planningProgress.completed, total: planningProgress.total }] : []),
    ...(chapterTask && chapterProgress ? [{ label: "自动正文", status: chapterTask.status, completed: chapterProgress.completed, total: chapterProgress.total }] : []),
  ]);

  return <details className={`automation-task-center tone-${trigger.tone}`}>
    <summary className="automation-task-trigger" aria-label="打开自动任务中心"><i aria-hidden="true" /><strong>{trigger.label}</strong><span aria-hidden="true">⌄</span></summary>
    <aside className="automation-task-popover" aria-label="自动任务中心">
    {(planningTask || activeView === "planning") && <div className={`automation-task-row status-${planningTask?.status ?? "empty"}`}>
      <div className="automation-task-summary">
        <i aria-hidden="true" />
        <strong>自动规划</strong>
        <span>{planningTask && planningProgress ? `${planningProgress.completed}/${planningProgress.total} · ${AUTOMATION_TASK_STATUS_LABELS[planningTask.status] ?? planningTask.status}` : "尚未创建"}</span>
        {planningTask && currentNodeLabel(planningTask) && <small>{currentNodeLabel(planningTask)}</small>}
      </div>
      <div className="automation-task-actions">
        {planningProgress?.handoffReady && <><button type="button" onClick={(event) => closeAndRun(event, onReviewPlanning)}>抽查结果</button><button type="button" className="save-secondary" onClick={(event) => closeAndRun(event, onPreparePublishing)}>进入发布准备</button></>}
        <button type="button" className="save-secondary" aria-pressed={activeView === "planning"} onClick={(event) => closeAndRun(event, onOpenPlanning)}>查看进度</button>
        {activeView === "planning" && <button type="button" onClick={(event) => closeAndRun(event, onReturnEditor)}>返回编辑</button>}
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
        {chapterTask && chapterProgress?.handoffReady && <button type="button" onClick={(event) => closeAndRun(event, () => onViewChapter(chapterTask.startChapter))}>查看第 {chapterTask.startChapter} 章</button>}
        {chapterProgress?.handoffReady && nextBatchStart && <button type="button" className="save-secondary" onClick={(event) => closeAndRun(event, () => onContinueChapterBatch(nextBatchStart))}>继续下一批</button>}
        <button type="button" className="save-secondary" aria-pressed={activeView === "chapters"} onClick={(event) => closeAndRun(event, onOpenChapters)}>查看进度</button>
        {activeView === "chapters" && <button type="button" onClick={(event) => closeAndRun(event, onReturnEditor)}>返回编辑</button>}
      </div>
    </div>}
      {activeView && <p className="automation-task-note">返回编辑不会停止任务；任务仍由本地 Codex 在浏览器之外继续执行。</p>}
    </aside>
  </details>;
}

function closeAndRun(event: MouseEvent<HTMLButtonElement>, action: () => void) {
  event.currentTarget.closest("details")?.removeAttribute("open");
  action();
}
