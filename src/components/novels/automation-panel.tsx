"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { controlAutomationRunAction, createAutomationRunAction, inspectAutomationRunAction, previewAutomationArtifactAction, recoverInterruptedAutomationRunAction, restartAutomationFromNodeAction } from "@/app/novels/actions";
import type { AutomationManifest, AutomationNode } from "@/modules/novels/automation";

const STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
  paused: "已暂停",
  stale: "上游已变化",
  terminated: "已终止",
};

type RunView = { runDir: string; manifest: AutomationManifest; importedCount?: number };

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

export function AutomationPanel({ novelId, onReturnManual }: { novelId: string; onReturnManual: () => void }) {
  const router = useRouter();
  const [run, setRun] = useState<RunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ nodeId: string; title: string; path: string; content: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async (quiet = false, importPaused = false) => {
    const result = await inspectAutomationRunAction(novelId, { importPaused });
    setLoading(false);
    if (!result.ok) { if (!quiet) setMessage(result.error); return; }
    setRun(result.run);
    if (result.run?.importedCount) {
      setMessage(`已校验并导入 ${result.run.importedCount} 个新节点`);
      router.refresh();
    }
  }, [novelId, router]);

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
  useEffect(() => {
    const manifest = run?.manifest;
    if (!manifest || manifest.status !== "failed" || !manifest.failureReason) return;
    const failedNode = manifest.nodes.find((node) => node.id === manifest.currentNode && node.status === "failed")
      ?? manifest.nodes.find((node) => node.status === "failed");
    const signature = `${failedNode?.id ?? "run"}:${failedNode?.attempts ?? 0}:${manifest.failureReason}`;
    const storageKey = `dropmind:automation-failure-alert:${manifest.runId}`;
    if (window.sessionStorage.getItem(storageKey) === signature) return;
    window.sessionStorage.setItem(storageKey, signature);
    window.alert(`自动生成已停止，不会继续执行后续节点。\n\n${manifest.failureReason}\n\n请检查当前节点输出或日志，修正后再单独重试。`);
  }, [run]);

  const completed = useMemo(() => run?.manifest.nodes.filter((node) => node.status === "completed").length ?? 0, [run]);
  const imported = useMemo(() => run?.manifest.nodes.filter((node) => node.imported).length ?? 0, [run]);

  async function createRun() {
    setLoading(true);
    const result = await createAutomationRunAction(novelId);
    setLoading(false);
    if (!result.ok) { setMessage(result.error); return; }
    setRun({ runDir: result.runDir, manifest: result.manifest });
    setMessage("任务已创建。双击 run-pipeline.cmd，或复制 PowerShell 命令运行。浏览器可以关闭。");
  }

  async function control(action: "run" | "pause" | "terminate" | "retry", node?: AutomationNode) {
    if (!run) return;
    const result = await controlAutomationRunAction({ novelId, runId: run.manifest.runId, action, nodeId: node?.id });
    if (!result.ok) { setMessage(result.error); return; }
    setRun({ ...run, manifest: result.manifest });
    if (action === "pause") setMessage("已请求暂停；当前节点结束后生效。");
    else if (action === "terminate") setMessage("已请求终止；当前节点结束后保留所有已完成输出。");
    else if (action === "retry") setMessage(`已准备单独重试“${node?.label}”。请再次运行脚本。`);
    else setMessage("已切换为继续执行。请再次运行脚本。");
  }

  async function restart(node: AutomationNode) {
    if (!run || !window.confirm(`从“${node.label}”重新生成，并将所有后续节点标记为 stale？`)) return;
    const result = await restartAutomationFromNodeAction({ novelId, runId: run.manifest.runId, nodeId: node.id });
    if (!result.ok) { setMessage(result.error); return; }
    setRun({ ...run, manifest: result.manifest });
    setMessage(`已同步当前提示词并从“${node.label}”重置。请再次运行脚本。`);
  }

  async function recoverInterrupted() {
    if (!run || !window.confirm("仅在 PowerShell 已返回提示符或窗口已经关闭时使用。确认本地 Codex 进程已经结束？")) return;
    const result = await recoverInterruptedAutomationRunAction({ novelId, runId: run.manifest.runId });
    if (!result.ok) { setMessage(result.error); return; }
    setRun({ ...run, manifest: result.manifest });
    setMessage("已恢复手动中断状态。请在失败节点点击“单独重试”。");
  }

  async function showArtifact(node: AutomationNode, artifact: "output" | "log") {
    if (!run) return;
    const result = await previewAutomationArtifactAction({ novelId, runId: run.manifest.runId, nodeId: node.id, artifact });
    if (!result.ok) { setMessage(result.error); return; }
    setPreview({ nodeId: node.id, title: `${node.label} · ${artifact === "output" ? "输出" : "日志"}`, path: result.filePath, content: result.content });
  }

  async function copy(value: string, success: string) {
    try { await navigator.clipboard.writeText(value); setMessage(success); }
    catch { setMessage("复制失败，请手动选择文本复制"); }
  }

  if (loading && !run) return <section className="automation-panel"><p>正在读取自动生成任务…</p></section>;
  if (!run) return <section className="automation-panel">
    <div className="automation-heading"><div><p className="novel-kicker">Codex 本地流水线</p><h2>自动生成第 2–5 步</h2></div><button type="button" className="save-secondary" onClick={onReturnManual}>返回手动模式</button></div>
    <p>将创建 14 个严格串行节点。DropMind 不调用模型 API；生成由你已登录的本地 Codex CLI 完成。</p>
    <button type="button" disabled={loading} onClick={createRun}>创建自动生成任务</button>
    {message && <div className="automation-message">{message}</div>}
  </section>;

  const manifest = run.manifest;
  const command = manifest.runner.command;
  return <section className="automation-panel">
    <div className="automation-heading"><div><p className="novel-kicker">Codex 本地流水线</p><h2>自动生成第 2–5 步</h2></div><button type="button" className="save-secondary" onClick={onReturnManual}>返回手动模式</button></div>
    <div className="automation-progress"><div><strong>{completed}/14</strong><span>生成完成</span></div><div><strong>{imported}/14</strong><span>已导入</span></div><div><strong>{STATUS_LABELS[manifest.status] ?? manifest.status}</strong><span>{manifest.currentNode ? manifest.nodes.find((node) => node.id === manifest.currentNode)?.label : "当前状态"}</span></div></div>
    <progress max={14} value={completed} aria-label="自动生成总体进度" />

    <div className="automation-launch">
      <strong>本地启动</strong>
      <code>{command}</code>
      <div className="panel-title-actions"><button type="button" onClick={() => void copy(command, "PowerShell 命令已复制")}>复制命令</button><button type="button" className="save-secondary" onClick={() => void copy(`${run.runDir}\\run-pipeline.cmd`, "CMD 脚本路径已复制")}>复制 CMD 路径</button><button type="button" className="save-secondary" onClick={() => void copy(run.runDir, "任务目录已复制")}>复制任务目录</button></div>
      <small>双击任务目录中的 run-pipeline.cmd，或在 PowerShell 中运行以上命令。关闭浏览器不会中止脚本。</small>
    </div>

    <div className="automation-controls"><button type="button" onClick={() => void control("run")}>继续</button><button type="button" className="save-secondary" onClick={() => void control("pause")}>节点后暂停</button><button type="button" className="save-secondary" onClick={() => void refresh(false, true)}>立即刷新并导入</button>{manifest.status === "running" && <button type="button" className="save-secondary" onClick={() => void recoverInterrupted()}>终端已中断</button>}<button type="button" className="danger-button" onClick={() => void control("terminate")}>终止</button></div>
    {manifest.failureReason && <div className="automation-error">{manifest.failureReason}</div>}
    {message && <div className="automation-message">{message}</div>}

    <ol className="automation-nodes">{manifest.nodes.map((node) => <li key={node.id} className={`automation-node ${node.status}`}>
      <span className="automation-node-index">{String(manifest.nodes.indexOf(node) + 1).padStart(2, "0")}</span>
      <div><strong>{node.label}</strong><small>{STATUS_LABELS[node.status] ?? node.status} · 尝试 {node.attempts}/{node.maxAttempts}{node.status === "running" && node.startedAt ? ` · 已运行 ${elapsedLabel(node.startedAt, now)}` : typeof node.lastDurationSeconds === "number" ? ` · 上次用时 ${durationLabel(node.lastDurationSeconds)}` : ""}{node.imported ? " · 已导入" : ""}</small>{node.failureReason && <em>{node.failureReason}</em>}</div>
      <div className="automation-node-actions">{node.status === "completed" && <button type="button" onClick={() => void showArtifact(node, "output")}>输出</button>}{node.attempts > 0 && <button type="button" onClick={() => void showArtifact(node, "log")}>日志</button>}{node.status === "failed" && <button type="button" onClick={() => void control("retry", node)}>单独重试</button>}{(node.status === "stale" || node.status === "completed" || node.status === "failed") && <button type="button" onClick={() => void restart(node)}>从此重生成</button>}</div>
      {preview?.nodeId === node.id && <div className="automation-preview"><div className="panel-title"><div><h3>{preview.title}</h3><small>{preview.path}</small></div><button type="button" onClick={() => setPreview(null)}>关闭</button></div><textarea readOnly value={preview.content} rows={18} /></div>}
    </li>)}</ol>
  </section>;
}
