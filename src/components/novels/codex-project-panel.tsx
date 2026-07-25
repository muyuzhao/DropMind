"use client";

import type { CodexChapterState } from "@/modules/novels/codex-project";

const PHASES: CodexChapterState["phase"][] = ["not_initialized", "synced", "task_ready", "file_ready", "imported"];
const LABELS: Record<CodexChapterState["phase"], string> = { not_initialized: "未同步", synced: "资料已同步", task_ready: "任务已准备", file_ready: "检测到正文", imported: "已导入" };

export function CodexProjectPanel({ chapter, project, state, message, onSync, onPrepare, onImport, onRefresh, onCopyPath }: {
  chapter: number; project: { projectDir: string; folderName: string }; state: CodexChapterState; message: string;
  onSync: () => void; onPrepare: () => void; onImport: () => void; onRefresh: () => void; onCopyPath: () => void;
}) {
  const currentIndex = PHASES.indexOf(state.phase);
  return <section className="codex-project-panel"><div className="codex-project-info"><p className="novel-kicker">CODEX 本地写作目录</p><h3>{project.folderName}</h3><code>{project.projectDir}</code>
    <div className="codex-state-track">{PHASES.map((phase, index) => <span key={phase} className={index === currentIndex ? "current" : index < currentIndex ? "complete" : ""}>{index < currentIndex ? "✓ " : ""}{LABELS[phase]}</span>)}</div>
    {state.taskChapter && state.taskChapter !== chapter && <p>当前任务文件仍指向第 {state.taskChapter} 章，准备本章任务后会更新。</p>}
    {state.generationBlockedReason && <p className="novel-error">{state.generationBlockedReason}</p>}
    {state.missing.length > 0 && <p className="novel-error">准备本章还缺少：{state.missing.join("、")}</p>}
    {message && <p className="codex-project-message">{message}</p>}
  </div><div className="codex-project-actions"><button type="button" className="button-secondary" onClick={onSync}>同步全部资料</button><button type="button" className={state.fileExists ? "button-secondary" : ""} disabled={!state.generationAllowed || state.missing.length > 0} onClick={onPrepare}>准备任务并复制指令</button><button type="button" className={state.fileExists ? "" : "button-secondary"} disabled={!state.generationAllowed || !state.fileExists} onClick={onImport}>{state.phase === "imported" ? "重新读取本章正文" : "预览并导入本章正文"}</button><button type="button" className="button-quiet" onClick={onRefresh}>刷新状态</button><button type="button" className="button-quiet" onClick={onCopyPath}>复制项目路径</button></div></section>;
}
