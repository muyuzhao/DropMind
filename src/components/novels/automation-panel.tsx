"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { controlAutomationRunAction, createAutomationRunAction, previewAutomationArtifactAction, recoverInterruptedAutomationRunAction, restartAutomationFromNodeAction } from "@/app/novels/actions";
import type { AutomationManifest, AutomationNode } from "@/modules/novels/automation";
import { AUTOMATION_TASK_STATUS_LABELS, automationTaskProgress } from "@/modules/novels/automation-task";
import { inspectAutomationRunQueued } from "./automation-inspection";
import { AutomationArtifactDrawer, WorkspaceConfirmDialog, type ArtifactPreview } from "./workspace-overlays";

type RunView = { runDir: string; manifest: AutomationManifest; importedCount?: number; seededCount?: number };
type PendingConfirmation = { kind: "restart"; node: AutomationNode } | { kind: "recover" } | { kind: "terminate" };

function seededMessage(manifest: AutomationManifest, seededCount: number) {
  const next = manifest.nodes[seededCount];
  return next
    ? `已沿用工作台前 ${seededCount} 个正式节点，将从“${next.label}”继续生成。`
    : "第 2–5 步已经全部完成，无需重复生成。";
}

function elapsedLabel(startedAt: string, now: number) {
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (!Number.isFinite(elapsedSeconds)) return "";
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

function durationLabel(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes > 0 ? `${minutes}分${remainder}秒` : `${remainder}秒`;
}

export function AutomationPanel({ novelId, onManifestChange, onReviewResults, onPreparePublishing }: {
  novelId: string;
  onManifestChange: (manifest: AutomationManifest | null) => void;
  onReviewResults: () => void;
  onPreparePublishing: () => void;
}) {
  const router = useRouter();
  const [run, setRun] = useState<RunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [nodeMessage, setNodeMessage] = useState<{ nodeId: string; text: string } | null>(null);
  const copiedTimer = useRef<number | null>(null);

  const refresh = useCallback(async (quiet = false, importPaused = false) => {
    const result = await inspectAutomationRunQueued(novelId, { importPaused });
    setLoading(false);
    if (!result.ok) { if (!quiet) setMessage(result.error); return; }
    setRun(result.run);
    onManifestChange(result.run?.manifest ?? null);
    if (result.run?.importedCount) {
      setMessage(`已校验并导入 ${result.run.importedCount} 个新节点`);
      router.refresh();
    } else if (result.run?.seededCount) setMessage(seededMessage(result.run.manifest, result.run.seededCount));
  }, [novelId, onManifestChange, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);
  useEffect(() => {
    const interval = window.setInterval(() => { void refresh(true); }, 3000);
    return () => window.clearInterval(interval);
  }, [refresh]);
  useEffect(() => {
    if (run?.manifest.status !== "running") return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [run?.manifest.status]);
  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);
  const completed = useMemo(() => run?.manifest.nodes.filter((node) => node.status === "completed").length ?? 0, [run]);
  const imported = useMemo(() => run?.manifest.nodes.filter((node) => node.imported).length ?? 0, [run]);

  async function createRun() {
    if (busyAction) return;
    setBusyAction("create");
    try {
      const result = await createAutomationRunAction(novelId);
      if (!result.ok) { setMessage(result.error); return; }
      setRun({ runDir: result.runDir, manifest: result.manifest, seededCount: result.seededCount });
      onManifestChange(result.manifest);
      setMessage(result.seededCount ? seededMessage(result.manifest, result.seededCount) : "任务已创建。下一步复制启动命令并在 PowerShell 中运行。");
    } finally { setBusyAction(null); }
  }

  async function control(action: "run" | "pause" | "terminate" | "retry", node?: AutomationNode) {
    if (!run || busyAction) return;
    const actionKey = `${action}-${node?.id ?? "run"}`;
    setBusyAction(actionKey);
    try {
      const result = await controlAutomationRunAction({ novelId, runId: run.manifest.runId, action, nodeId: node?.id });
      if (!result.ok) { if (node) setNodeMessage({ nodeId: node.id, text: result.error }); else setMessage(result.error); return; }
      setRun({ ...run, manifest: result.manifest });
      onManifestChange(result.manifest);
      if (action === "pause") setMessage("已请求暂停；当前节点结束后生效。");
      else if (action === "terminate") setMessage("已请求终止；当前节点结束后保留所有已完成输出。");
      else if (action === "retry" && node) setNodeMessage({ nodeId: node.id, text: `已准备单独重试“${node.label}”，请再次运行脚本。` });
      else setMessage("已切换为继续执行。请再次运行脚本。");
    } finally { setBusyAction(null); }
  }

  async function restart(node: AutomationNode) {
    if (!run || busyAction) return;
    setBusyAction(`restart-${node.id}`);
    try {
      const result = await restartAutomationFromNodeAction({ novelId, runId: run.manifest.runId, nodeId: node.id });
      if (!result.ok) { setNodeMessage({ nodeId: node.id, text: result.error }); return; }
      setRun({ ...run, manifest: result.manifest });
      onManifestChange(result.manifest);
      setNodeMessage({ nodeId: node.id, text: `已同步当前提示词并从“${node.label}”重置，请再次运行脚本。` });
    } finally { setBusyAction(null); }
  }

  async function recoverInterrupted() {
    if (!run || busyAction) return;
    setBusyAction("recover");
    try {
      const result = await recoverInterruptedAutomationRunAction({ novelId, runId: run.manifest.runId });
      if (!result.ok) { setMessage(result.error); return; }
      setRun({ ...run, manifest: result.manifest });
      onManifestChange(result.manifest);
      setMessage("已恢复手动中断状态。请在失败节点点击“单独重试”。");
    } finally { setBusyAction(null); }
  }

  async function showArtifact(node: AutomationNode, artifact: "output" | "log") {
    if (!run || busyAction) return;
    setBusyAction(`preview-${node.id}-${artifact}`);
    try {
      const result = await previewAutomationArtifactAction({ novelId, runId: run.manifest.runId, nodeId: node.id, artifact });
      if (!result.ok) { setNodeMessage({ nodeId: node.id, text: result.error }); return; }
      setPreview({ nodeId: node.id, title: `${node.label} · ${artifact === "output" ? "输出" : "日志"}`, path: result.filePath, content: result.content });
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
    try { await refresh(false, true); }
    finally { setBusyAction(null); }
  }

  async function confirmPendingAction() {
    const pending = confirmation;
    if (!pending || busyAction) return;
    setConfirmation(null);
    if (pending.kind === "restart") await restart(pending.node);
    else if (pending.kind === "recover") await recoverInterrupted();
    else await control("terminate");
  }

  const confirmationTitle = confirmation?.kind === "restart" ? `从“${confirmation.node.label}”重新生成？`
    : confirmation?.kind === "recover" ? "确认终端已经中断？"
      : "终止这次自动任务？";
  const confirmationDescription = confirmation?.kind === "restart"
    ? "该节点及所有后续节点会标记为需要重新生成；已经导入的内容不会直接删除。"
    : confirmation?.kind === "recover"
      ? "仅在 PowerShell 已返回提示符或窗口已经关闭时继续，工作台会把运行中的节点恢复为可重试状态。"
      : "任务不会再继续执行，已经完成的输出仍会保留。返回编辑不会停止任务。";

  if (loading && !run) return <section className="automation-panel"><p>正在读取自动生成任务…</p></section>;
  if (!run) return <section className="automation-panel">
    <div className="automation-heading"><div><p className="novel-kicker">Codex 本地流水线</p><h2>创建自动规划任务</h2></div></div>
    <p>将创建 14 个严格串行节点。DropMind 不调用模型 API；生成由你已登录的本地 Codex CLI 完成。</p>
    <button type="button" disabled={Boolean(busyAction)} onClick={createRun}>{busyAction === "create" ? "创建中…" : "创建 Codex 自动任务"}</button>
    {message && <div className="automation-message">{message}</div>}
  </section>;

  const manifest = run.manifest;
  const command = manifest.runner.command;
  const taskProgress = automationTaskProgress(manifest);
  const needsLaunch = manifest.status === "pending" && manifest.nodes.every((node) => node.attempts === 0);
  const focusNode = manifest.nodes.find((node) => node.id === manifest.currentNode)
    ?? manifest.nodes.find((node) => node.status === "failed" || node.status === "running")
    ?? manifest.nodes.find((node) => node.status === "pending")
    ?? (taskProgress.handoffReady ? undefined : manifest.nodes.at(-1));
  const otherNodes = focusNode ? manifest.nodes.filter((node) => node.id !== focusNode.id) : manifest.nodes;
  const operationBusy = busyAction !== null;

  function renderNode(node: AutomationNode, index: number) {
    return <li key={node.id} className={`automation-node ${node.status}`}>
      <span className="automation-node-index">{String(index + 1).padStart(2, "0")}</span>
      <div><strong>{node.label}</strong><small>{AUTOMATION_TASK_STATUS_LABELS[node.status] ?? node.status} · 尝试 {node.attempts}/{node.maxAttempts}{node.status === "running" && node.startedAt ? ` · 已运行 ${elapsedLabel(node.startedAt, now)}` : typeof node.lastDurationSeconds === "number" ? ` · 上次用时 ${durationLabel(node.lastDurationSeconds)}` : ""}{node.imported ? " · 已导入" : ""}</small>{node.failureReason && <em>{node.failureReason}</em>}{nodeMessage?.nodeId === node.id && <span className="automation-node-feedback">{nodeMessage.text}</span>}</div>
      <div className="automation-node-actions">{node.status === "completed" && <button type="button" disabled={operationBusy} onClick={() => void showArtifact(node, "output")}>{busyAction === `preview-${node.id}-output` ? "读取中…" : "输出"}</button>}{node.attempts > 0 && <button type="button" disabled={operationBusy} onClick={() => void showArtifact(node, "log")}>{busyAction === `preview-${node.id}-log` ? "读取中…" : "日志"}</button>}{node.status === "failed" && <button type="button" disabled={operationBusy} onClick={() => void control("retry", node)}>{busyAction === `retry-${node.id}` ? "请求中…" : "单独重试"}</button>}{(node.status === "stale" || node.status === "completed" || node.status === "failed") && <button type="button" disabled={operationBusy} onClick={() => setConfirmation({ kind: "restart", node })}>{busyAction === `restart-${node.id}` ? "处理中…" : "从此重生成"}</button>}</div>
    </li>;
  }

  return <section className="automation-panel">
    <div className="automation-heading"><div><p className="novel-kicker">Codex 本地流水线</p><h2>自动规划任务</h2></div></div>
    <div className="automation-progress-summary"><strong>{completed}/{manifest.nodes.length} 已完成</strong><span>{imported} 已导入 · {AUTOMATION_TASK_STATUS_LABELS[manifest.status] ?? manifest.status}{focusNode ? ` · ${focusNode.label}` : ""}</span></div>
    <progress max={14} value={completed} aria-label="自动生成总体进度" />

    {taskProgress.handoffReady && <div className="automation-handoff"><div><strong>第 2–5 步已完成并导入</strong><span>先抽查规划结果，确认无误后可以直接准备发布资料。</span></div><div><button type="button" onClick={onReviewResults}>抽查结果</button><button type="button" className="button-secondary" onClick={onPreparePublishing}>进入发布准备</button></div></div>}

    <details className={`automation-collapsible ${needsLaunch ? "automation-next-action" : ""}`} open={needsLaunch}><summary>{needsLaunch ? "下一步：启动任务" : "启动信息"}</summary><div className="automation-launch"><code>{command}</code><div className="panel-title-actions"><button type="button" onClick={() => void copy(command, "command")}>{copiedKey === "command" ? "已复制" : "复制启动命令"}</button><button type="button" className="button-quiet" onClick={() => void copy(`${run.runDir}\\run-pipeline.cmd`, "cmd")}>{copiedKey === "cmd" ? "已复制" : "复制 CMD 路径"}</button><button type="button" className="button-quiet" onClick={() => void copy(run.runDir, "directory")}>{copiedKey === "directory" ? "已复制" : "复制任务目录"}</button></div><small>复制后在 PowerShell 中运行；关闭页面不会中止任务。</small></div></details>

    <div className="automation-controls">{manifest.status !== "running" && !taskProgress.handoffReady && <button type="button" disabled={operationBusy} onClick={() => void control("run")}>{busyAction === "run-run" ? "请求中…" : "继续"}</button>}{manifest.status === "running" && <button type="button" disabled={operationBusy} onClick={() => void control("pause")}>{busyAction === "pause-run" ? "请求中…" : "节点后暂停"}</button>}<button type="button" className="button-secondary" disabled={operationBusy} onClick={() => void manualRefresh()}>{busyAction === "refresh" ? "刷新中…" : "刷新状态"}</button>{manifest.status === "running" && <button type="button" className="button-quiet" disabled={operationBusy} onClick={() => setConfirmation({ kind: "recover" })}>{busyAction === "recover" ? "处理中…" : "终端已中断"}</button>}</div>
    {message && <div className="automation-message">{message}</div>}
    <details className="automation-more-actions"><summary>更多操作</summary><div><p>返回编辑不会停止任务。终止任务只用于不再继续本次流水线的情况，已完成输出仍会保留。</p><button type="button" className="danger-button" disabled={operationBusy} onClick={() => setConfirmation({ kind: "terminate" })}>{busyAction === "terminate-run" ? "终止中…" : "终止任务"}</button></div></details>
    {manifest.failureReason && <div className="automation-error">{manifest.failureReason}</div>}
    {focusNode && <ol className="automation-nodes automation-focus-node">{renderNode(focusNode, manifest.nodes.indexOf(focusNode))}</ol>}
    {otherNodes.length > 0 && <details className="automation-collapsible"><summary>{focusNode ? "其他节点" : "全部节点"}（{otherNodes.length}）</summary><ol className="automation-nodes">{otherNodes.map((node) => renderNode(node, manifest.nodes.indexOf(node)))}</ol></details>}
    <AutomationArtifactDrawer preview={preview} onClose={() => setPreview(null)} />
    <WorkspaceConfirmDialog open={Boolean(confirmation)} title={confirmationTitle} description={confirmationDescription} confirmLabel={confirmation?.kind === "terminate" ? "终止任务" : confirmation?.kind === "recover" ? "确认已中断" : "重新生成"} danger={confirmation?.kind !== "recover"} busy={operationBusy} onConfirm={() => void confirmPendingAction()} onClose={() => setConfirmation(null)} />
  </section>;
}
