"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { controlChapterAutomationRunAction, createChapterAutomationRunAction, inspectChapterAutomationRunAction, previewChapterAutomationArtifactAction, recoverInterruptedChapterAutomationRunAction } from "@/app/novels/actions";
import type { ChapterAutomationManifest, ChapterAutomationNode } from "@/modules/novels/chapter-automation";

const STATUS_LABELS: Record<string, string> = {
  pending: "待执行", running: "生成中", completed: "已完成", failed: "失败",
  paused: "已暂停", stale: "资料已变化", terminated: "已终止",
};

type ImportedChapter = { chapterNumber: number; content: string };
type RunView = { runDir: string; manifest: ChapterAutomationManifest; importedCount?: number; importedChapters?: ImportedChapter[]; warning?: string | null };

function elapsedLabel(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return "";
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
}

export function ChapterAutomationPanel({ novelId, currentChapter, savedChapters, publishedChapters, onImported, onReturnManual }: {
  novelId: string;
  currentChapter: number;
  savedChapters: number[];
  publishedChapters: number[];
  onImported: (chapters: ImportedChapter[]) => void;
  onReturnManual: () => void;
}) {
  const router = useRouter();
  const [run, setRun] = useState<RunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingNew, setCreatingNew] = useState(false);
  const [startChapter, setStartChapter] = useState(currentChapter);
  const [chapterCount, setChapterCount] = useState(1);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ nodeId: string; title: string; path: string; content: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const result = await inspectChapterAutomationRunAction(novelId);
    setLoading(false);
    if (!result.ok) { setMessage(result.error); return; }
    setRun(result.run);
    if (result.run?.importedCount) {
      setMessage(result.run.warning ?? `已校验并导入 ${result.run.importedCount} 章正文`);
      onImported(result.run.importedChapters);
      router.refresh();
    }
  }, [novelId, onImported, router]);

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

  const endChapter = Math.min(60, startChapter + chapterCount - 1);
  const completed = useMemo(() => run?.manifest.nodes.filter((node) => node.status === "completed").length ?? 0, [run]);
  const imported = useMemo(() => run?.manifest.nodes.filter((node) => node.imported).length ?? 0, [run]);
  const canCreateNew = Boolean(run && !["pending", "running", "paused"].includes(run.manifest.status) && (run.manifest.status !== "completed" || run.manifest.nodes.every((node) => node.imported)));

  async function createRun() {
    if (startChapter + chapterCount - 1 > 60) { setMessage("生成范围不能超过第 60 章"); return; }
    const published = publishedChapters.filter((chapter) => chapter >= startChapter && chapter <= endChapter);
    if (published.length) { setMessage(`第 ${published.join("、")} 章已经发布，不能自动覆盖`); return; }
    const existing = savedChapters.filter((chapter) => chapter >= startChapter && chapter <= endChapter);
    if (existing.length && !window.confirm(`第 ${existing.join("、")} 章已有正文。继续会在导入时覆盖，并保留历史版本。确定创建任务？`)) return;
    setLoading(true);
    const result = await createChapterAutomationRunAction({ novelId, startChapter, chapterCount });
    setLoading(false);
    if (!result.ok) { setMessage(result.error); return; }
    setRun({ runDir: result.runDir, manifest: result.manifest });
    setCreatingNew(false);
    setMessage("正文任务已创建。双击 run-pipeline.cmd，或复制 PowerShell 命令运行。");
  }

  async function control(action: "run" | "pause" | "terminate" | "retry", node?: ChapterAutomationNode) {
    if (!run) return;
    const result = await controlChapterAutomationRunAction({ novelId, runId: run.manifest.runId, action, nodeId: node?.id });
    if (!result.ok) { setMessage(result.error); return; }
    setRun({ ...run, manifest: result.manifest });
    if (action === "pause") setMessage("已请求在当前章节完成后暂停。");
    else if (action === "terminate") setMessage("已请求终止；已生成正文仍会保留在任务目录。");
    else if (action === "retry") setMessage(`已准备重试${node?.label}，请再次运行脚本。`);
    else setMessage("已切换为继续执行，请再次运行脚本。");
  }

  async function recoverInterrupted() {
    if (!run || !window.confirm("确认 PowerShell 已返回提示符或窗口已经关闭？")) return;
    const result = await recoverInterruptedChapterAutomationRunAction({ novelId, runId: run.manifest.runId });
    if (!result.ok) { setMessage(result.error); return; }
    setRun({ ...run, manifest: result.manifest });
    setMessage("已恢复中断状态，请在失败章节点击单独重试。");
  }

  async function showArtifact(node: ChapterAutomationNode, artifact: "output" | "log") {
    if (!run) return;
    const result = await previewChapterAutomationArtifactAction({ novelId, runId: run.manifest.runId, nodeId: node.id, artifact });
    if (!result.ok) { setMessage(result.error); return; }
    setPreview({ nodeId: node.id, title: `${node.label} · ${artifact === "output" ? "正文" : "日志"}`, path: result.filePath, content: result.content });
  }

  async function copy(value: string, success: string) {
    try { await navigator.clipboard.writeText(value); setMessage(success); }
    catch { setMessage("复制失败，请手动选择文本复制"); }
  }

  if (loading && !run) return <section className="automation-panel"><p>正在读取正文任务…</p></section>;
  if (!run || creatingNew) return <section className="automation-panel">
    <div className="automation-heading"><div><p className="novel-kicker">CODEX 本地正文流水线</p><h2>连续自动写 1–10 章</h2></div><button type="button" className="save-secondary" onClick={onReturnManual}>返回单章模式</button></div>
    <p>选择起始章和连续章数。每章独立调用一次 Codex，后一章读取前一章输出；所有章节完成且资料未变化后才会批量导入。</p>
    <div className="chapter-automation-form">
      <label>起始章节<input type="number" min={1} max={60} value={startChapter} onChange={(event) => setStartChapter(Math.max(1, Math.min(60, Number(event.target.value) || 1)))} /></label>
      <label>连续生成<select value={chapterCount} onChange={(event) => setChapterCount(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} 章</option>)}</select></label>
      <strong>范围：第 {startChapter}–{endChapter} 章</strong>
      <button type="button" disabled={loading || startChapter + chapterCount - 1 > 60} onClick={() => void createRun()}>创建正文任务</button>
    </div>
    {startChapter + chapterCount - 1 > 60 && <div className="automation-error">生成范围不能超过第 60 章</div>}
    {message && <div className="automation-message">{message}</div>}
  </section>;

  const manifest = run.manifest;
  return <section className="automation-panel">
    <div className="automation-heading"><div><p className="novel-kicker">CODEX 本地正文流水线</p><h2>第 {manifest.startChapter}–{manifest.endChapter} 章</h2></div><button type="button" className="save-secondary" onClick={onReturnManual}>返回单章模式</button></div>
    <div className="automation-progress"><div><strong>{completed}/{manifest.nodes.length}</strong><span>生成完成</span></div><div><strong>{imported}/{manifest.nodes.length}</strong><span>已导入</span></div><div><strong>{STATUS_LABELS[manifest.status] ?? manifest.status}</strong><span>{manifest.currentNode ? manifest.nodes.find((node) => node.id === manifest.currentNode)?.label : "当前状态"}</span></div></div>
    <progress max={manifest.nodes.length} value={completed} aria-label="正文生成总体进度" />
    <div className="automation-launch"><strong>本地启动</strong><code>{manifest.runner.command}</code><div className="panel-title-actions"><button type="button" onClick={() => void copy(manifest.runner.command, "PowerShell 命令已复制")}>复制命令</button><button type="button" className="save-secondary" onClick={() => void copy(`${run.runDir}\\run-pipeline.cmd`, "CMD 路径已复制")}>复制 CMD 路径</button><button type="button" className="save-secondary" onClick={() => void copy(run.runDir, "任务目录已复制")}>复制任务目录</button></div><small>任务会在浏览器之外串行执行，关闭页面不会中止。</small></div>
    <div className="automation-controls"><button type="button" onClick={() => void control("run")}>继续</button><button type="button" className="save-secondary" onClick={() => void control("pause")}>本章后暂停</button><button type="button" className="save-secondary" onClick={() => void refresh()}>立即刷新并导入</button>{manifest.status === "running" && <button type="button" className="save-secondary" onClick={() => void recoverInterrupted()}>终端已中断</button>}<button type="button" className="danger-button" onClick={() => void control("terminate")}>终止</button>{canCreateNew && <button type="button" className="save-secondary" onClick={() => { setStartChapter(Math.min(60, manifest.endChapter + 1)); setChapterCount(1); setCreatingNew(true); setMessage(""); }}>新建另一批</button>}</div>
    {manifest.failureReason && <div className="automation-error">{manifest.failureReason}</div>}
    {message && <div className="automation-message">{message}</div>}
    <ol className="automation-nodes">{manifest.nodes.map((node, index) => <li key={node.id} className={`automation-node ${node.status}`}><span className="automation-node-index">{String(index + 1).padStart(2, "0")}</span><div><strong>{node.label}</strong><small>{STATUS_LABELS[node.status] ?? node.status} · 尝试 {node.attempts}/{node.maxAttempts}{node.status === "running" && node.startedAt ? ` · 已运行 ${elapsedLabel(node.startedAt, now)}` : ""}{node.imported ? " · 已导入" : ""}</small>{node.failureReason && <em>{node.failureReason}</em>}</div><div className="automation-node-actions">{node.status === "completed" && <button type="button" onClick={() => void showArtifact(node, "output")}>正文</button>}{node.attempts > 0 && <button type="button" onClick={() => void showArtifact(node, "log")}>日志</button>}{node.status === "failed" && <button type="button" onClick={() => void control("retry", node)}>单独重试</button>}</div>{preview?.nodeId === node.id && <div className="automation-preview"><div className="panel-title"><div><h3>{preview.title}</h3><small>{preview.path}</small></div><button type="button" onClick={() => setPreview(null)}>关闭</button></div><textarea readOnly value={preview.content} rows={18} /></div>}</li>)}</ol>
  </section>;
}
