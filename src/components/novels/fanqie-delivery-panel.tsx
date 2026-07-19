"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelChapterDeliveryAction, getNovelDeliveryStateAction, queueChapterDeliveryAction, saveDeliveryTargetAction } from "@/app/novels/actions";
import type { DeliveryJobData, NovelDeliveryState } from "@/modules/novels/delivery";

const statusLabels: Record<DeliveryJobData["status"], string> = {
  ready: "待扩展领取",
  claimed: "扩展已领取",
  filled: "已填入番茄",
  submitted: "已提交审核",
  failed: "投递失败",
  stale: "正文已变化",
  cancelled: "已取消",
};

function replaceJob(state: NovelDeliveryState, job: DeliveryJobData) {
  const jobs = state.jobs.filter((item) => item.id !== job.id && item.chapterNumber !== job.chapterNumber);
  return { ...state, jobs: [...jobs, job].sort((left, right) => left.chapterNumber - right.chapterNumber) };
}

export function FanqieDeliveryPanel({ mode, novelId, novelName, chapterNumber, chapterTitle, chapterContent, chapterDirty, initialState, extensionDirectory }: {
  mode: "setup" | "chapter";
  novelId: string;
  novelName: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterContent: string;
  chapterDirty: boolean;
  initialState: NovelDeliveryState;
  extensionDirectory: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [bookName, setBookName] = useState(initialState.target?.bookName ?? novelName);
  const [manageUrl, setManageUrl] = useState(initialState.target?.manageUrl ?? "https://fanqienovel.com/main/writer/book-manage");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const currentJob = useMemo(() => state.jobs.find((job) => job.chapterNumber === chapterNumber) ?? null, [chapterNumber, state.jobs]);

  async function copy(value: string, success: string) {
    try { await navigator.clipboard.writeText(value); setMessage(success); }
    catch { setMessage("复制失败，请手动复制"); }
  }

  async function saveTarget() {
    setBusy("target"); setMessage("");
    const result = await saveDeliveryTargetAction({ novelId, bookName, manageUrl, defaultVolume: "" });
    setBusy("");
    if (!result.ok) { setMessage(result.error); return; }
    setState((current) => ({ ...current, target: result.target }));
    setMessage("番茄作品已绑定");
    router.refresh();
  }

  async function refresh() {
    setBusy("refresh"); setMessage("");
    const result = await getNovelDeliveryStateAction(novelId);
    setBusy("");
    if (!result.ok) { setMessage(result.error); return; }
    setState(result.state);
    setMessage("投递状态已刷新");
  }

  async function queue() {
    if (chapterDirty) { setMessage("请先保存当前标题和正文，再加入投递队列"); return; }
    setBusy("queue"); setMessage("");
    const result = await queueChapterDeliveryAction({ novelId, chapterNumber });
    setBusy("");
    if (!result.ok) { setMessage(result.error); return; }
    setState((current) => replaceJob(current, result.job));
    setMessage(`第${chapterNumber}章已加入番茄投递队列`);
    router.refresh();
  }

  async function cancel() {
    if (!currentJob) return;
    setBusy("cancel"); setMessage("");
    const result = await cancelChapterDeliveryAction({ novelId, jobId: currentJob.id });
    setBusy("");
    if (!result.ok) { setMessage(result.error); return; }
    setState((current) => replaceJob(current, result.job));
    setMessage("投递任务已取消");
    router.refresh();
  }

  if (mode === "setup") return <section className="fanqie-delivery-panel delivery-setup-panel">
    <div className="panel-title"><div><p className="novel-kicker">第一版 · 人工确认发布</p><h3>番茄作品投递</h3></div><span className={`delivery-status ${state.target ? "ready" : "cancelled"}`}>{state.target ? "已绑定" : "未绑定"}</span></div>
    <p className="delivery-explanation">DropMind 生成单章投递队列，Chrome 扩展负责把标题和正文填入番茄后台，最终提交按钮仍由你确认。</p>
    <div className="delivery-target-form">
      <label>番茄作品名<input value={bookName} maxLength={100} onChange={(event) => setBookName(event.target.value)} placeholder="必须与番茄后台作品名一致" /></label>
      <label>作品管理页<input value={manageUrl} onChange={(event) => setManageUrl(event.target.value)} placeholder="https://fanqienovel.com/main/writer/book-manage" /></label>
      <div className="delivery-actions"><button type="button" disabled={busy === "target" || !bookName.trim() || !manageUrl.trim()} onClick={() => void saveTarget()}>{busy === "target" ? "保存中…" : "保存番茄绑定"}</button>{state.target && <a className="button-link" href={state.target.manageUrl} target="_blank" rel="noreferrer">打开番茄后台</a>}</div>
    </div>
    <details className="delivery-extension-setup"><summary>首次使用：安装并连接 Chrome 扩展</summary><ol><li>在 Chrome 扩展管理页开启“开发者模式”。</li><li>选择“加载已解压的扩展程序”，加载下面的目录。</li><li>打开扩展设置，填入本机地址和连接令牌，然后测试连接。</li></ol><label>扩展目录<div className="delivery-copy-row"><code>{extensionDirectory}</code><button type="button" className="button-quiet" onClick={() => void copy(extensionDirectory, "扩展目录已复制")}>复制</button></div></label><label>连接令牌<div className="delivery-copy-row"><code>{state.connectionToken}</code><button type="button" className="button-quiet" onClick={() => void copy(state.connectionToken, "连接令牌已复制")}>复制</button></div></label></details>
    {message && <div className="automation-message">{message}</div>}
  </section>;

  const canQueue = Boolean(state.target && chapterTitle.trim() && chapterContent.trim() && !chapterDirty && currentJob?.status !== "submitted");
  return <section className="fanqie-delivery-panel chapter-delivery-panel">
    <div className="panel-title"><div><p className="novel-kicker">番茄单章投递</p><h3>第 {chapterNumber} 章《{chapterTitle || "未命名"}》</h3></div>{currentJob && <span className={`delivery-status ${currentJob.status}`}>{statusLabels[currentJob.status]}</span>}</div>
    {!state.target ? <p className="delivery-warning">尚未绑定番茄作品，请先到第6步“发布准备”完成绑定和扩展连接。</p> : <p className="delivery-explanation">目标作品：{state.target.bookName}。队列保存的是当前正式版本；本地未保存修改不会被投递。</p>}
    {currentJob?.lastError && <p className="delivery-warning">{currentJob.lastError}</p>}
    <div className="delivery-actions"><button type="button" disabled={!canQueue || busy === "queue"} onClick={() => void queue()}>{busy === "queue" ? "加入中…" : currentJob && ["failed", "stale", "cancelled"].includes(currentJob.status) ? "重新加入队列" : currentJob ? "更新投递任务" : "投递到番茄"}</button>{state.target && <a className="button-link" href={state.target.manageUrl} target="_blank" rel="noreferrer">打开番茄后台</a>}<button type="button" className="button-secondary" disabled={busy === "refresh"} onClick={() => void refresh()}>{busy === "refresh" ? "刷新中…" : "刷新投递状态"}</button>{currentJob && !["submitted", "cancelled"].includes(currentJob.status) && <button type="button" className="button-quiet" disabled={busy === "cancel"} onClick={() => void cancel()}>取消任务</button>}</div>
    {chapterDirty && <p className="delivery-warning">当前标题或正文尚未保存，保存后才能投递。</p>}
    {message && <div className="automation-message">{message}</div>}
  </section>;
}
