"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { controlChapterAutomationRunAction, createChapterAutomationRunAction, previewChapterAutomationArtifactAction, recoverInterruptedChapterAutomationRunAction } from "@/app/novels/actions";
import type { ChapterAutomationManifest, ChapterAutomationNode } from "@/modules/novels/chapter-automation";
import { AUTOMATION_TASK_STATUS_LABELS, automationTaskProgress, chapterBatchEnd, maxChapterBatchCount, nextChapterBatchStart } from "@/modules/novels/automation-task";
import { inspectChapterAutomationRunQueued } from "./automation-inspection";
import { AutomationArtifactDrawer, WorkspaceConfirmDialog, type ArtifactPreview } from "./workspace-overlays";

type ImportedChapter = { chapterNumber: number; content: string };
type RunView = { runDir: string; manifest: ChapterAutomationManifest; importedCount?: number; importedChapters?: ImportedChapter[]; warning?: string | null };
type PendingConfirmation = { kind: "overwrite"; chapters: number[] } | { kind: "recover" } | { kind: "terminate" };

function elapsedLabel(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return "";
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
}

export function ChapterAutomationPanel({ novelId, currentChapter, savedChapters, publishedChapters, newBatchStart, onImported, onManifestChange, onOpenChapter }: {
  novelId: string;
  currentChapter: number;
  savedChapters: number[];
  publishedChapters: number[];
  newBatchStart: number | null;
  onImported: (chapters: ImportedChapter[]) => void;
  onManifestChange: (manifest: ChapterAutomationManifest | null) => void;
  onOpenChapter: (chapter: number) => void;
}) {
  const router = useRouter();
  const [run, setRun] = useState<RunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingNew, setCreatingNew] = useState(newBatchStart !== null);
  const [startChapter, setStartChapter] = useState(newBatchStart ?? currentChapter);
  const [chapterCount, setChapterCount] = useState(1);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [nodeMessage, setNodeMessage] = useState<{ nodeId: string; text: string } | null>(null);
  const copiedTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const result = await inspectChapterAutomationRunQueued(novelId);
    setLoading(false);
    if (!result.ok) { setMessage(result.error); return; }
    setRun(result.run);
    onManifestChange(result.run?.manifest ?? null);
    if (result.run?.importedCount) {
      setMessage(result.run.warning ?? `已校验并导入 ${result.run.importedCount} 章正文`);
      onImported(result.run.importedChapters);
      router.refresh();
    }
  }, [novelId, onImported, onManifestChange, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);
  useEffect(() => {
    const interval = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(interval);
  }, [refresh]);
  useEffect(() => {
    if (run?.manifest.status !== "running") return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [run?.manifest.status]);
  useEffect(() => {
    if (newBatchStart === null) return;
    const timeout = window.setTimeout(() => {
      setStartChapter(newBatchStart);
      setChapterCount(1);
      setCreatingNew(true);
      setMessage("");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [newBatchStart]);
  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  const maxChapterCount = maxChapterBatchCount(startChapter);
  const endChapter = chapterBatchEnd(startChapter, chapterCount);
  const completed = useMemo(() => run?.manifest.nodes.filter((node) => node.status === "completed").length ?? 0, [run]);
  const imported = useMemo(() => run?.manifest.nodes.filter((node) => node.imported).length ?? 0, [run]);
  const canCreateNew = Boolean(run && run.manifest.endChapter < 60 && !["pending", "running", "paused"].includes(run.manifest.status) && (run.manifest.status !== "completed" || run.manifest.nodes.every((node) => node.imported)));

  async function createRun(overwriteConfirmed = false) {
    if (busyAction) return;
    if (startChapter + chapterCount - 1 > 60) { setMessage("生成范围不能超过第 60 章"); return; }
    const published = publishedChapters.filter((chapter) => chapter >= startChapter && chapter <= endChapter);
    if (published.length) { setMessage(`第 ${published.join("、")} 章已经发布，不能自动覆盖`); return; }
    const existing = savedChapters.filter((chapter) => chapter >= startChapter && chapter <= endChapter);
    if (existing.length && !overwriteConfirmed) { setConfirmation({ kind: "overwrite", chapters: existing }); return; }
    setBusyAction("create");
    try {
      const result = await createChapterAutomationRunAction({ novelId, startChapter, chapterCount });
      if (!result.ok) { setMessage(result.error); return; }
      setRun({ runDir: result.runDir, manifest: result.manifest });
      onManifestChange(result.manifest);
      setCreatingNew(false);
      setMessage("正文任务已创建。下一步复制启动命令并在 PowerShell 中运行。");
    } finally { setBusyAction(null); }
  }

  async function control(action: "run" | "pause" | "terminate" | "retry", node?: ChapterAutomationNode) {
    if (!run || busyAction) return;
    const actionKey = `${action}-${node?.id ?? "run"}`;
    setBusyAction(actionKey);
    try {
      const result = await controlChapterAutomationRunAction({ novelId, runId: run.manifest.runId, action, nodeId: node?.id });
      if (!result.ok) { if (node) setNodeMessage({ nodeId: node.id, text: result.error }); else setMessage(result.error); return; }
      setRun({ ...run, manifest: result.manifest });
      onManifestChange(result.manifest);
      if (action === "pause") setMessage("已请求在当前章节完成后暂停。");
      else if (action === "terminate") setMessage("已请求终止；已生成正文仍会保留在任务目录。");
      else if (action === "retry" && node) setNodeMessage({ nodeId: node.id, text: `已准备重试${node.label}，请再次运行脚本。` });
      else setMessage("已切换为继续执行，请再次运行脚本。");
    } finally { setBusyAction(null); }
  }

  async function recoverInterrupted() {
    if (!run || busyAction) return;
    setBusyAction("recover");
    try {
      const result = await recoverInterruptedChapterAutomationRunAction({ novelId, runId: run.manifest.runId });
      if (!result.ok) { setMessage(result.error); return; }
      setRun({ ...run, manifest: result.manifest });
      onManifestChange(result.manifest);
      setMessage("已恢复中断状态，请在失败章节点击单独重试。");
    } finally { setBusyAction(null); }
  }

  async function showArtifact(node: ChapterAutomationNode, artifact: "output" | "log") {
    if (!run || busyAction) return;
    setBusyAction(`preview-${node.id}-${artifact}`);
    try {
      const result = await previewChapterAutomationArtifactAction({ novelId, runId: run.manifest.runId, nodeId: node.id, artifact });
      if (!result.ok) { setNodeMessage({ nodeId: node.id, text: result.error }); return; }
      setPreview({ nodeId: node.id, title: `${node.label} · ${artifact === "output" ? "正文" : "日志"}`, path: result.filePath, content: result.content });
    } finally { setBusyAction(null); }
  }

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedKey(null), 1600);
    }
    catch { setMessage("复制失败，请手动选择文本复制"); }
  }

  async function manualRefresh() {
    if (busyAction) return;
    setBusyAction("refresh");
    try { await refresh(); }
    finally { setBusyAction(null); }
  }

  async function confirmPendingAction() {
    const pending = confirmation;
    if (!pending || busyAction) return;
    setConfirmation(null);
    if (pending.kind === "overwrite") await createRun(true);
    else if (pending.kind === "recover") await recoverInterrupted();
    else await control("terminate");
  }

  const confirmationTitle = confirmation?.kind === "overwrite" ? "覆盖已有章节？"
    : confirmation?.kind === "recover" ? "确认终端已经中断？"
      : "终止这批正文任务？";
  const confirmationDescription = confirmation?.kind === "overwrite"
    ? `第 ${confirmation.chapters.join("、")} 章已有正文。导入时会覆盖当前内容，并自动保留历史版本。`
    : confirmation?.kind === "recover"
      ? "仅在 PowerShell 已返回提示符或窗口已经关闭时继续，运行中的章节会恢复为可重试状态。"
      : "任务不会再继续执行，已经生成的正文仍会保留在任务目录中。返回编辑不会停止任务。";

  const confirmationDialog = <WorkspaceConfirmDialog open={Boolean(confirmation)} title={confirmationTitle} description={confirmationDescription} confirmLabel={confirmation?.kind === "terminate" ? "终止任务" : confirmation?.kind === "recover" ? "确认已中断" : "继续创建"} danger={confirmation?.kind === "terminate" || confirmation?.kind === "overwrite"} busy={Boolean(busyAction)} onConfirm={() => void confirmPendingAction()} onClose={() => setConfirmation(null)} />;

  if (loading && !run) return <section className="automation-panel"><p>正在读取正文任务…</p></section>;
  if (!run || creatingNew) return <section className="automation-panel">
    <div className="automation-heading"><div><p className="novel-kicker">CODEX 本地正文流水线</p><h2>连续自动写 1–10 章</h2></div></div>
    <p>选择起始章和连续章数。每章独立调用一次 Codex，后一章读取前一章输出；所有章节完成且资料未变化后才会批量导入。</p>
    <div className="chapter-automation-form">
      <label>起始章节<input type="number" min={1} max={60} value={startChapter} onChange={(event) => { const next = Math.max(1, Math.min(60, Number(event.target.value) || 1)); setStartChapter(next); setChapterCount((current) => Math.min(current, maxChapterBatchCount(next))); }} /></label>
      <label>连续生成<select value={chapterCount} onChange={(event) => setChapterCount(Number(event.target.value))}>{Array.from({ length: maxChapterCount }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} 章</option>)}</select></label>
      <strong>范围：第 {startChapter}–{endChapter} 章</strong>
      <button type="button" disabled={Boolean(busyAction)} onClick={() => void createRun()}>{busyAction === "create" ? "创建中…" : "创建 Codex 正文任务"}</button>
    </div>
    {message && <div className="automation-message">{message}</div>}
    {confirmationDialog}
  </section>;

  const manifest = run.manifest;
  const taskProgress = automationTaskProgress(manifest);
  const nextBatchStart = nextChapterBatchStart(manifest.endChapter);
  const needsLaunch = manifest.status === "pending" && manifest.nodes.every((node) => node.attempts === 0);
  const focusNode = manifest.nodes.find((node) => node.id === manifest.currentNode)
    ?? manifest.nodes.find((node) => node.status === "failed" || node.status === "running")
    ?? manifest.nodes.find((node) => node.status === "pending")
    ?? (taskProgress.handoffReady ? undefined : manifest.nodes.at(-1));
  const otherNodes = focusNode ? manifest.nodes.filter((node) => node.id !== focusNode.id) : manifest.nodes;
  const operationBusy = busyAction !== null;

  function renderNode(node: ChapterAutomationNode, index: number) {
    return <li key={node.id} className={`automation-node ${node.status}`}><span className="automation-node-index">{String(index + 1).padStart(2, "0")}</span><div><strong>{node.label}</strong><small>{AUTOMATION_TASK_STATUS_LABELS[node.status] ?? node.status} · 尝试 {node.attempts}/{node.maxAttempts}{node.status === "running" && node.startedAt ? ` · 已运行 ${elapsedLabel(node.startedAt, now)}` : ""}{node.imported ? " · 已导入" : ""}</small>{node.failureReason && <em>{node.failureReason}</em>}{nodeMessage?.nodeId === node.id && <span className="automation-node-feedback">{nodeMessage.text}</span>}</div><div className="automation-node-actions">{node.status === "completed" && <button type="button" disabled={operationBusy} onClick={() => void showArtifact(node, "output")}>{busyAction === `preview-${node.id}-output` ? "读取中…" : "正文"}</button>}{node.attempts > 0 && <button type="button" disabled={operationBusy} onClick={() => void showArtifact(node, "log")}>{busyAction === `preview-${node.id}-log` ? "读取中…" : "日志"}</button>}{node.status === "failed" && <button type="button" disabled={operationBusy} onClick={() => void control("retry", node)}>{busyAction === `retry-${node.id}` ? "请求中…" : "单独重试"}</button>}</div></li>;
  }

  return <section className="automation-panel">
    <div className="automation-heading"><div><p className="novel-kicker">CODEX 本地正文流水线</p><h2>第 {manifest.startChapter}–{manifest.endChapter} 章</h2></div></div>
    <div className="automation-progress-summary"><strong>{completed}/{manifest.nodes.length} 已完成</strong><span>{imported} 已导入 · {AUTOMATION_TASK_STATUS_LABELS[manifest.status] ?? manifest.status}{focusNode ? ` · ${focusNode.label}` : ""}</span></div>
    <progress max={manifest.nodes.length} value={completed} aria-label="正文生成总体进度" />
    {taskProgress.handoffReady && <div className="automation-handoff"><div><strong>本批正文已完成并导入</strong><span>先查看首章衔接，也可以直接准备下一批。</span></div><div><button type="button" onClick={() => onOpenChapter(manifest.startChapter)}>查看第 {manifest.startChapter} 章</button>{nextBatchStart && <button type="button" className="button-secondary" onClick={() => { setStartChapter(nextBatchStart); setChapterCount(1); setCreatingNew(true); setMessage(""); }}>继续下一批</button>}</div></div>}
    <details className={`automation-collapsible ${needsLaunch ? "automation-next-action" : ""}`} open={needsLaunch}><summary>{needsLaunch ? "下一步：启动任务" : "启动信息"}</summary><div className="automation-launch"><code>{manifest.runner.command}</code><div className="panel-title-actions"><button type="button" onClick={() => void copy(manifest.runner.command, "command")}>{copiedKey === "command" ? "已复制" : "复制启动命令"}</button><button type="button" className="button-quiet" onClick={() => void copy(`${run.runDir}\\run-pipeline.cmd`, "cmd")}>{copiedKey === "cmd" ? "已复制" : "复制 CMD 路径"}</button><button type="button" className="button-quiet" onClick={() => void copy(run.runDir, "directory")}>{copiedKey === "directory" ? "已复制" : "复制任务目录"}</button></div><small>复制后在 PowerShell 中运行；关闭页面不会中止任务。</small></div></details>
    <div className="automation-controls">{manifest.status !== "running" && !taskProgress.handoffReady && <button type="button" disabled={operationBusy} onClick={() => void control("run")}>{busyAction === "run-run" ? "请求中…" : "继续"}</button>}{manifest.status === "running" && <button type="button" disabled={operationBusy} onClick={() => void control("pause")}>{busyAction === "pause-run" ? "请求中…" : "本章后暂停"}</button>}<button type="button" className="button-secondary" disabled={operationBusy} onClick={() => void manualRefresh()}>{busyAction === "refresh" ? "刷新中…" : "刷新状态"}</button>{manifest.status === "running" && <button type="button" className="button-quiet" disabled={operationBusy} onClick={() => setConfirmation({ kind: "recover" })}>{busyAction === "recover" ? "处理中…" : "终端已中断"}</button>}{canCreateNew && !taskProgress.handoffReady && <button type="button" className="button-secondary" disabled={operationBusy} onClick={() => { setStartChapter(Math.min(60, manifest.endChapter + 1)); setChapterCount(1); setCreatingNew(true); setMessage(""); }}>新建另一批</button>}</div>
    {message && <div className="automation-message">{message}</div>}
    <details className="automation-more-actions"><summary>更多操作</summary><div><p>返回编辑不会停止任务。终止后，已经生成的正文仍会保留在任务目录中。</p><button type="button" className="danger-button" disabled={operationBusy} onClick={() => setConfirmation({ kind: "terminate" })}>{busyAction === "terminate-run" ? "终止中…" : "终止任务"}</button></div></details>
    {manifest.failureReason && <div className="automation-error">{manifest.failureReason}</div>}
    {focusNode && <ol className="automation-nodes automation-focus-node">{renderNode(focusNode, manifest.nodes.indexOf(focusNode))}</ol>}
    {otherNodes.length > 0 && <details className="automation-collapsible"><summary>{focusNode ? "其他节点" : "全部节点"}（{otherNodes.length}）</summary><ol className="automation-nodes">{otherNodes.map((node) => renderNode(node, manifest.nodes.indexOf(node)))}</ol></details>}
    <AutomationArtifactDrawer preview={preview} onClose={() => setPreview(null)} />
    {confirmationDialog}
  </section>;
}
