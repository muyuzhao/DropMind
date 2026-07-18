"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChapterStatus, StepKey } from "@/lib/novel-db/schema";
import { deleteNovelAction, detachNovelSchemeAction, exportNovelAction, importCodexChapterAction, prepareCodexChapterTaskAction, saveChapterAction, saveOutlineAction, saveStepAction, saveUnitAction, saveWorkPositionAction, setNovelSchemeAction, syncCodexProjectAction, updateNovelAction, updateTemplateAction } from "@/app/novels/actions";
import { buildPromptContext } from "@/modules/novels/prompts";
import { CODEX_DRAFT_COMMAND } from "@/modules/novels/structured-prompts";
import { STEP_LABELS } from "@/modules/novels/templates";
import { buildWorkflowProgress, nextWorkPosition, normalizeWorkPosition, type WorkPosition } from "@/modules/novels/work-state";
import { ChapterSelector } from "./chapter-selector";

type RecordRow = Record<string, string | number | boolean>;
export type WorkspaceData = { novel: RecordRow; promptSource: {mode:"scheme"|"custom";schemeId:string|null;schemeName:string}; templates: RecordRow[]; steps: RecordRow[]; storyUnits: RecordRow[]; chapterOutlines: RecordRow[]; chapters: RecordRow[] };
const STEPS = Object.keys(STEP_LABELS) as StepKey[];
const SIDEBAR_STORAGE_KEY = "dropmind:novel-workbench:sidebar-open";

type EditorSnapshot = { content: string; updatedAt: number | null };
type SavePhase = "idle" | "saving" | "error";

function workKey(position: WorkPosition) {
  if (position.step === "units" || position.step === "outlines") return `${position.step}-${position.rangeStart}`;
  if (position.step === "drafts") return `${position.step}-${position.chapter}`;
  return position.step;
}

function editorSnapshot(data: WorkspaceData, position: WorkPosition): EditorSnapshot {
  const row = position.step === "units" ? data.storyUnits.find((item) => Number(item.startChapter) === position.rangeStart)
    : position.step === "outlines" ? data.chapterOutlines.find((item) => Number(item.chapterNumber) === position.rangeStart)
    : position.step === "drafts" ? data.chapters.find((item) => Number(item.chapterNumber) === position.chapter)
    : data.steps.find((item) => item.key === position.step);
  return { content: String(row?.content ?? ""), updatedAt: row?.updatedAt ? Number(row.updatedAt) : null };
}

function draftStorageKey(novelId: string, position: WorkPosition) {
  return `dropmind:novel-draft:${novelId}:${workKey(position)}`;
}

function readLocalDraft(novelId: string, position: WorkPosition) {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(novelId, position));
    if (!raw) return null;
    const draft = JSON.parse(raw) as { content?: unknown };
    return typeof draft.content === "string" ? draft.content : null;
  } catch { return null; }
}

function writeLocalDraft(novelId: string, position: WorkPosition, content: string) {
  try { window.localStorage.setItem(draftStorageKey(novelId, position), JSON.stringify({ content, updatedAt: Date.now() })); } catch { /* 浏览器禁用存储时仍可手动保存 */ }
}

function clearLocalDraft(novelId: string, position: WorkPosition) {
  try { window.localStorage.removeItem(draftStorageKey(novelId, position)); } catch { /* 浏览器禁用存储时忽略 */ }
}

function readSidebarState() {
  try {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return saved === "true" || saved === "false" ? saved === "true" : null;
  } catch { return null; }
}

function writeSidebarState(open: boolean) {
  try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open)); } catch { /* 浏览器禁用存储时忽略 */ }
}

function savedTime(timestamp: number | null) {
  return timestamp ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp) : "";
}

function currentTimestamp() { return Date.now(); }

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export function NovelWorkspace({ initial, schemes, codexProject }: { initial: WorkspaceData; schemes:Array<{id:string;name:string}>; codexProject:{projectDir:string;folderName:string;exists:boolean} }) {
  const router = useRouter();
  const initialPosition = normalizeWorkPosition({ step: String(initial.novel.currentStep) as StepKey, rangeStart: Number(initial.novel.currentRangeStart ?? 1), chapter: Number(initial.novel.currentChapter ?? 1) });
  const initialSnapshot = editorSnapshot(initial, initialPosition);
  const [step, setStep] = useState<StepKey>(initialPosition.step);
  const [rangeStart, setRangeStart] = useState(initialPosition.rangeStart);
  const [chapter, setChapter] = useState(initialPosition.chapter);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [message, setMessage] = useState("");
  const [content, setContent] = useState(initialSnapshot.content);
  const [savedContent, setSavedContent] = useState(initialSnapshot.content);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initialSnapshot.updatedAt);
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const savedContentCache = useRef(new Map<string, EditorSnapshot>([[workKey(initialPosition), initialSnapshot]]));
  const positionSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const [selectedTopic, setSelectedTopic] = useState(String(initial.novel.selectedTopic ?? ""));
  const [firstVolumeOutline, setFirstVolumeOutline] = useState(String(initial.novel.firstVolumeOutline ?? ""));
  const position = useMemo(() => ({ step, rangeStart, chapter }), [step, rangeStart, chapter]);
  const positionKey = workKey(position);
  const isDirty = content !== savedContent;
  const followingPosition = nextWorkPosition(position);
  const progress = useMemo(() => buildWorkflowProgress(initial), [initial]);
  const promptInfo = useMemo(() => buildPromptContext(initial, { step, rangeStart, chapter }), [initial, step, rangeStart, chapter]);
  const [schemeChoice,setSchemeChoice]=useState(initial.promptSource.schemeId??schemes[0]?.id??"");
  const automaticPrompt=step==="drafts"?CODEX_DRAFT_COMMAND:promptInfo.prompt;
  const promptMissing=step==="drafts"?[]:promptInfo.missing;
  const promptKey = `${step}-${rangeStart}-${chapter}-${automaticPrompt}`;
  const [promptOverride,setPromptOverride]=useState<{key:string;value:string}|null>(null);
  const promptText=promptOverride?.key===promptKey?promptOverride.value:automaticPrompt;
  const baseInstruction=String(initial.templates.find((row)=>row.key===step)?.template??"");
  const instructionKey=`${String(initial.novel.id)}-${step}-${baseInstruction}`;
  const [instructionOverride,setInstructionOverride]=useState<{key:string;value:string}|null>(null);
  const customInstruction=instructionOverride?.key===instructionKey?instructionOverride.value:baseInstruction;
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const saved = readSidebarState();
      if (saved !== null) setSidebarOpen(saved);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const draft = readLocalDraft(String(initial.novel.id), position);
      if (draft !== null && draft !== savedContent) {
        setContent(draft);
        setMessage("已恢复本地草稿");
      } else if (draft === savedContent) clearLocalDraft(String(initial.novel.id), position);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initial.novel.id, position, positionKey, savedContent]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  function confirmLeave() {
    if (!isDirty) return true;
    writeLocalDraft(String(initial.novel.id), position, content);
    return window.confirm("当前内容还没有保存，确定离开吗？本地草稿会继续保留。");
  }

  function persistPosition(next: WorkPosition) {
    positionSaveQueue.current = positionSaveQueue.current.then(async () => {
      const result = await saveWorkPositionAction({ novelId: String(initial.novel.id), currentStep: next.step, currentRangeStart: next.rangeStart, currentChapter: next.chapter });
      if (!result.ok) setMessage(`工作位置记录失败：${result.error}`);
    });
  }

  function openPosition(next: WorkPosition, skipGuard = false) {
    const normalized = normalizeWorkPosition(next);
    if (workKey(normalized) === positionKey) return;
    if (!skipGuard && !confirmLeave()) return;
    const snapshot = savedContentCache.current.get(workKey(normalized)) ?? editorSnapshot(initial, normalized);
    setContent(snapshot.content);
    setSavedContent(snapshot.content);
    setLastSavedAt(snapshot.updatedAt);
    setSavePhase("idle");
    setMessage("");
    setStep(normalized.step);
    setRangeStart(normalized.rangeStart);
    setChapter(normalized.chapter);
    persistPosition(normalized);
  }

  function changeContent(value: string) {
    if (value === savedContent) clearLocalDraft(String(initial.novel.id), position);
    else writeLocalDraft(String(initial.novel.id), position, value);
    setContent(value);
    setSavePhase("idle");
  }

  async function saveCurrent() {
    if (!isDirty) return Boolean(savedContent.trim());
    setSavePhase("saving");
    let result;
    if (step === "units") result = await saveUnitAction({ novelId: initial.novel.id, startChapter: rangeStart, content, draft: false });
    else if (step === "outlines") {
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => saveOutlineAction({ novelId: initial.novel.id, chapterNumber: rangeStart + i, content, draft: false })));
      result = results.find((item) => !item.ok) ?? { ok: true as const };
    } else if (step === "drafts") result = await saveChapterAction({ novelId: initial.novel.id, chapterNumber: chapter, content, status: "saved" as ChapterStatus, draft: false });
    else result = await saveStepAction({ novelId: initial.novel.id, key: step, content, draft: false });
    if (!result.ok) { setSavePhase("error"); setMessage(result.error); return false; }
    const timestamp = currentTimestamp();
    const snapshot = { content, updatedAt: timestamp };
    savedContentCache.current.set(positionKey, snapshot);
    clearLocalDraft(String(initial.novel.id), position);
    setSavedContent(content);
    setLastSavedAt(timestamp);
    setSavePhase("idle");
    setMessage("");
    router.refresh();
    return true;
  }

  async function saveAndAdvance() {
    if (!followingPosition) return;
    const saved = await saveCurrent();
    if (saved) openPosition(followingPosition, true);
  }
  async function copyPrompt() { try { await navigator.clipboard.writeText(promptText); setMessage("提示词已复制"); } catch { setMessage("复制失败，请在提示词框按 Ctrl+C"); } }
  async function prepareCodexTask() {
    setMessage("正在同步资料并准备任务…");
    const result=await prepareCodexChapterTaskAction({novelId:String(initial.novel.id),chapterNumber:chapter});
    if(result.ok)setMessage(`第${chapter}章任务已准备，请到Codex执行当前任务`);else setMessage(result.error);
  }
  async function importCodexChapter() {
    const result=await importCodexChapterAction({novelId:String(initial.novel.id),chapterNumber:chapter});
    if(result.ok){const timestamp=currentTimestamp();const snapshot={content:result.content,updatedAt:timestamp};savedContentCache.current.set(positionKey,snapshot);clearLocalDraft(String(initial.novel.id),position);setContent(result.content);setSavedContent(result.content);setLastSavedAt(timestamp);setSavePhase("idle");setMessage(`已读取并保存第${chapter}章正文`);router.refresh();}else setMessage(result.error);
  }

  const saveStatus = savePhase === "saving" ? { kind: "saving", label: "正在保存" }
    : savePhase === "error" ? { kind: "error", label: "保存失败" }
    : isDirty ? { kind: "dirty", label: "未保存" }
    : lastSavedAt ? { kind: "saved", label: `已保存，${savedTime(lastSavedAt)}` }
    : { kind: "idle", label: "尚未保存" };

  return <main className={`workspace-shell ${sidebarOpen?"sidebar-open":"sidebar-closed"}`}>
    <aside className="workspace-sidebar"><div className="workspace-sidebar-top">{sidebarOpen&&<Link className="workspace-brand" href="/" aria-label="DropMind 首页" onClick={(event)=>{if(!confirmLeave())event.preventDefault()}}><span className="brand-mark">D</span><span>DropMind</span></Link>}<button className="workspace-sidebar-toggle" type="button" aria-expanded={sidebarOpen} title={sidebarOpen?"收起侧栏":"展开侧栏"} onClick={()=>setSidebarOpen((open)=>{const next=!open;writeSidebarState(next);return next})}>{sidebarOpen?"‹":"☰"}</button></div>
      <div className="workspace-sidebar-content"><Link className="workspace-back-link" href="/novels" onClick={(event)=>{if(!confirmLeave())event.preventDefault()}}>← 小说列表</Link><h2>{String(initial.novel.name)}</h2>
        <nav>{STEPS.map((key) => {const item=progress[key];const progressLabel=item.total===1?(item.completed?"✓":""):`${item.completed}/${item.total}`;return <button type="button" className={step === key ? "active" : ""} key={key} onClick={() => openPosition({ ...position, step: key })}><span>{STEP_LABELS[key]}</span><span className="workspace-step-progress">{progressLabel}</span></button>})}</nav>
        <div className="workspace-tools"><button type="button" onClick={async () => { const result = await exportNovelAction(String(initial.novel.id), "json"); if (result.ok) download(result.content, `${initial.novel.name}-备份.json`, "application/json"); }}>备份 JSON</button>
        <button type="button" onClick={async () => { const result = await exportNovelAction(String(initial.novel.id), "txt"); if (result.ok) download(result.content, `${initial.novel.name}-第一卷.txt`, "text/plain;charset=utf-8"); }}>导出正文 TXT</button></div>
      </div>
    </aside>
    <section className="workspace-main"><header><p className="novel-kicker">{STEP_LABELS[step]}</p><h1>{String(initial.novel.name)}</h1></header>
      <section className="prompt-source-bar"><strong>当前提示词：{initial.promptSource.schemeName}{initial.promptSource.mode==="scheme"?"（跟随方案）":""}</strong><select value={schemeChoice} onChange={(event)=>setSchemeChoice(event.target.value)}>{schemes.map((scheme)=><option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}</select><button type="button" onClick={async()=>{const result=await setNovelSchemeAction({novelId:String(initial.novel.id),schemeId:schemeChoice});if(result.ok){router.refresh();setMessage("已切换方案")}else setMessage(result.error)}}>{initial.promptSource.mode==="scheme"?"切换方案":"恢复跟随方案"}</button>{initial.promptSource.mode==="scheme"&&<button type="button" onClick={async()=>{const result=await detachNovelSchemeAction(String(initial.novel.id));if(result.ok){router.refresh();setMessage("已转为本书专用")}else setMessage(result.error)}}>转为本书专用</button>}</section>
      {(step === "units" || step === "outlines") && <ChapterSelector mode="range" value={rangeStart} onChange={(value) => openPosition({ ...position, rangeStart: value })} saved={new Set((step === "units" ? initial.storyUnits : initial.chapterOutlines).filter((row)=>String(row.content??"").trim()).map((row) => Number(step === "units" ? row.startChapter : row.chapterNumber)))} />}
      {step === "drafts" && <ChapterSelector mode="chapter" value={chapter} onChange={(value) => openPosition({ ...position, chapter: value })} saved={new Set(initial.chapters.filter((row) => String(row.content??"").trim()).map((row) => Number(row.chapterNumber)))} />}
      {step === "topics" && <label className="novel-inline-field">最终选题<textarea value={selectedTopic} onChange={(event) => setSelectedTopic(event.target.value)} rows={4} /><button type="button" onClick={async () => { await updateNovelAction({ novelId: initial.novel.id, selectedTopic }); router.refresh(); setMessage("已保存最终选题"); }}>保存最终选题</button></label>}
      {step === "volumes" && <label className="novel-inline-field">第一卷大纲<textarea value={firstVolumeOutline} onChange={(event) => setFirstVolumeOutline(event.target.value)} rows={6} /><button type="button" onClick={async () => { await updateNovelAction({ novelId: initial.novel.id, firstVolumeOutline }); router.refresh(); setMessage("已保存第一卷大纲"); }}>保存第一卷大纲</button></label>}
      {step === "units" && <label className="novel-inline-field">本卷大纲<textarea value={firstVolumeOutline} onChange={(event) => setFirstVolumeOutline(event.target.value)} rows={6} placeholder="粘贴当前卷的大纲，保存后六个批次会自动复用" /><button type="button" onClick={async () => { await updateNovelAction({ novelId: initial.novel.id, firstVolumeOutline }); router.refresh(); setMessage("已保存本卷大纲"); }}>保存本卷大纲</button></label>}
      {initial.promptSource.mode==="custom"&&<label className="novel-inline-field">本书专用 · {STEP_LABELS[step]}创作要求<textarea value={customInstruction} onChange={(event)=>setInstructionOverride({key:instructionKey,value:event.target.value})} rows={8}/><button type="button" onClick={async()=>{const result=await updateTemplateAction({novelId:String(initial.novel.id),key:step,template:customInstruction});if(result.ok){setInstructionOverride(null);router.refresh();setMessage("已保存本书专用要求")}else setMessage(result.error)}}>保存本书专用要求</button></label>}
      {step==="drafts"&&<section className="codex-project-panel"><div><p className="novel-kicker">CODEX 本地写作目录</p><h3>{codexProject.folderName}</h3><code>{codexProject.projectDir}</code><p>首次使用先同步全部资料，再以这个路径作为工作目录新建该小说的固定Codex任务。以后准备当前章并发送“执行当前任务”，写完后回到这里读取正文。</p>{message&&<p className="codex-project-message">{message}</p>}</div><div className="codex-project-actions"><button type="button" onClick={async()=>{const result=await syncCodexProjectAction(String(initial.novel.id));if(result.ok)setMessage("Codex资料已同步");else setMessage(result.error)}}>同步全部资料</button><button type="button" onClick={prepareCodexTask}>准备第{chapter}章任务</button><button type="button" onClick={importCodexChapter}>读取第{chapter}章正文</button></div></section>}
      <section className="automatic-context"><strong>本步骤自动加入</strong><div>{promptInfo.automaticLabels.map((label)=><span key={label}>{label}</span>)}</div></section>
      <div className="editor-grid"><section className="editor-panel"><div className="panel-title"><h3>{step==="drafts"?"Codex短指令":"最终提示词（可临时修改）"}</h3><div className="panel-title-actions"><button type="button" onClick={()=>setPromptOverride(null)}>{step==="drafts"?"恢复短指令":"恢复自动生成"}</button><button type="button" disabled={promptMissing.length > 0||!promptText.trim()} onClick={copyPrompt}>复制提示词</button></div></div>
        {promptMissing.length > 0 && <p className="novel-error">还缺少：{promptMissing.join("、")}</p>}<textarea value={promptText} onChange={(event)=>setPromptOverride({key:promptKey,value:event.target.value})} rows={step==="drafts"?6:22} /></section>
        <section className="editor-panel"><div className="panel-title"><h3>{step==="drafts"?`第${chapter}章正文（可手动编辑）`:"粘贴 Gemini 返回内容"}</h3><div className="panel-title-actions"><span className={`save-status ${saveStatus.kind}`}>{saveStatus.label}</span><span>{content.length} 字符</span><button className="save-secondary" type="button" disabled={savePhase==="saving"||!isDirty} onClick={saveCurrent}>保存</button>{followingPosition&&<button type="button" disabled={savePhase==="saving"||!content.trim()} onClick={saveAndAdvance}>{step==="drafts"?"保存并进入下一章":"保存并进入下一批"}</button>}</div></div><textarea key={positionKey} value={content} onChange={(event) => changeContent(event.target.value)} rows={22} placeholder={step==="drafts"?"Codex正文读取后会显示在这里，也可以手动粘贴…":"在这里粘贴生成结果…"} />{message&&<div className="editor-actions"><span>{message}</span></div>}</section></div>
      <details className="danger-zone"><summary>删除小说</summary><button type="button" onClick={async () => { const confirmation = window.prompt(`请输入小说名称：${initial.novel.name}`); if (!confirmation) return; const result = await deleteNovelAction({ novelId: String(initial.novel.id), confirmation }); if (result.ok) router.push("/novels"); else setMessage(result.error); }}>删除整个项目</button></details>
    </section>
  </main>;
}
