"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChapterStatus, StepKey } from "@/lib/novel-db/schema";
import { deleteNovelAction, detachNovelSchemeAction, exportNovelAction, importCodexChapterAction, inspectCodexChapterAction, prepareCodexChapterTaskAction, previewCodexChapterAction, restoreContentVersionAction, saveChapterAction, saveOutlineBatchAction, saveStepAction, saveUnitAction, saveWorkPositionAction, setNovelSchemeAction, syncCodexProjectAction, updateChapterStatusAction, updateNovelAction, updateTemplateAction } from "@/app/novels/actions";
import type { CodexChapterState } from "@/modules/novels/codex-project";
import type { ContentVersionData, NovelWorkspaceData } from "@/modules/novels/types";
import { buildCoverPrompt, buildPromptContext } from "@/modules/novels/prompts";
import { formatSelectedTopic, parseSelectedTopic } from "@/modules/novels/selected-topic";
import { CODEX_DRAFT_COMMAND } from "@/modules/novels/structured-prompts";
import { STEP_LABELS } from "@/modules/novels/templates";
import { buildWorkflowOverview, nextWorkActionLabel, nextWorkPosition, normalizeWorkPosition, type WorkPosition } from "@/modules/novels/work-state";
import { ChapterSelector, type SelectorItemState } from "./chapter-selector";
import { ChapterAutomationPanel } from "./chapter-automation-panel";
import { AutomationPanel } from "./automation-panel";
import { CodexProjectPanel } from "./codex-project-panel";
import { ContentHistory } from "./content-history";
import { WorkflowSidebar } from "./workflow-sidebar";

const SIDEBAR_STORAGE_KEY = "dropmind:novel-workbench:sidebar-open";

type EditorSnapshot = { content: string; updatedAt: number | null };
type SavePhase = "idle" | "saving" | "error";

function workKey(position: WorkPosition) {
  if (position.step === "units" || position.step === "outlines") return `${position.step}-${position.rangeStart}`;
  if (position.step === "drafts") return `${position.step}-${position.chapter}`;
  return position.step;
}

function editorSnapshot(data: NovelWorkspaceData, position: WorkPosition): EditorSnapshot {
  const row = position.step === "units" ? data.storyUnits.find((item) => Number(item.startChapter) === position.rangeStart)
    : position.step === "outlines" ? data.chapterOutlines.find((item) => Number(item.chapterNumber) === position.rangeStart)
    : position.step === "drafts" ? data.chapters.find((item) => Number(item.chapterNumber) === position.chapter)
    : data.steps.find((item) => item.key === position.step);
  return { content: String(row?.content ?? ""), updatedAt: row?.updatedAt ? Number(row.updatedAt) : null };
}

function draftStorageKey(novelId: string, position: WorkPosition) {
  return `dropmind:novel-draft:${novelId}:${workKey(position)}`;
}

type LocalDraft = { content: string; updatedAt: number; baseUpdatedAt: number | null };

function readLocalDraft(novelId: string, position: WorkPosition): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(novelId, position));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<LocalDraft>;
    return typeof draft.content === "string" ? { content: draft.content, updatedAt: Number(draft.updatedAt ?? 0), baseUpdatedAt: typeof draft.baseUpdatedAt === "number" ? draft.baseUpdatedAt : null } : null;
  } catch { return null; }
}

function writeLocalDraft(novelId: string, position: WorkPosition, content: string, baseUpdatedAt: number | null) {
  try { window.localStorage.setItem(draftStorageKey(novelId, position), JSON.stringify({ content, updatedAt: Date.now(), baseUpdatedAt })); } catch { /* 浏览器禁用存储时仍可手动保存 */ }
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

export function NovelWorkspace({ initial, schemes, codexProject }: { initial: NovelWorkspaceData; schemes:Array<{id:string;name:string}>; codexProject:{projectDir:string;folderName:string;exists:boolean} }) {
  const router = useRouter();
  const initialSelectedTopic = parseSelectedTopic(String(initial.novel.selectedTopic ?? ""));
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
  const [selectedTopicTitle, setSelectedTopicTitle] = useState(initialSelectedTopic.title);
  const [selectedTopicSummary, setSelectedTopicSummary] = useState(initialSelectedTopic.summary);
  const [savedSelectedTopicTitle, setSavedSelectedTopicTitle] = useState(initialSelectedTopic.title);
  const [savedSelectedTopicSummary, setSavedSelectedTopicSummary] = useState(initialSelectedTopic.summary);
  const [firstVolumeOutline, setFirstVolumeOutline] = useState(String(initial.novel.firstVolumeOutline ?? ""));
  const [savedFirstVolumeOutline, setSavedFirstVolumeOutline] = useState(String(initial.novel.firstVolumeOutline ?? ""));
  const position = useMemo(() => ({ step, rangeStart, chapter }), [step, rangeStart, chapter]);
  const positionKey = workKey(position);
  const isDirty = content !== savedContent;
  const followingPosition = nextWorkPosition(position);
  const nextActionLabel = nextWorkActionLabel(position);
  const workflowOverview = useMemo(() => buildWorkflowOverview(initial), [initial]);
  const promptInfo = useMemo(() => buildPromptContext(initial, { step, rangeStart, chapter }), [initial, step, rangeStart, chapter]);
  const [schemeChoice,setSchemeChoice]=useState(initial.promptSource.schemeId??schemes[0]?.id??"");
  const automaticPrompt=step==="drafts"?CODEX_DRAFT_COMMAND:promptInfo.prompt;
  const promptMissing=step==="drafts"?[]:promptInfo.missing;
  const promptKey = `${step}-${rangeStart}-${chapter}-${automaticPrompt}`;
  const [promptOverride,setPromptOverride]=useState<{key:string;value:string}|null>(null);
  const promptText=promptOverride?.key===promptKey?promptOverride.value:automaticPrompt;
  const coverInstruction=String(initial.templates.find((row)=>row.key==="cover")?.template??"");
  const coverPrompt=buildCoverPrompt(selectedTopicTitle.trim() || String(initial.novel.name),selectedTopicSummary,coverInstruction);
  const coverMissing=!selectedTopicSummary.trim()||!coverInstruction.trim();
  const baseInstruction=String(initial.templates.find((row)=>row.key===step)?.template??"");
  const instructionKey=`${String(initial.novel.id)}-${step}-${baseInstruction}`;
  const [instructionOverride,setInstructionOverride]=useState<{key:string;value:string}|null>(null);
  const customInstruction=instructionOverride?.key===instructionKey?instructionOverride.value:baseInstruction;
  const [codexState, setCodexState] = useState<CodexChapterState>({ phase: codexProject.exists ? "synced" : "not_initialized", projectExists: codexProject.exists, taskChapter: null, fileExists: false, fileModifiedAt: null, missing: [] });
  const [chapterStatusOverrides, setChapterStatusOverrides] = useState(new Map<number, ChapterStatus>());
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [automationMode, setAutomationMode] = useState(false);
  const [chapterAutomationMode, setChapterAutomationMode] = useState(false);
  const selectedTopic = formatSelectedTopic({ title: selectedTopicTitle, summary: selectedTopicSummary });
  const selectedTopicDirty = selectedTopicTitle !== savedSelectedTopicTitle || selectedTopicSummary !== savedSelectedTopicSummary;
  const selectedTopicConfirmed = Boolean(savedSelectedTopicTitle.trim() && savedSelectedTopicSummary.trim());
  const selectedTopicComplete = Boolean(selectedTopicTitle.trim() && selectedTopicSummary.trim());
  const instructionDirty = instructionOverride?.key === instructionKey && instructionOverride.value !== baseInstruction;
  const auxiliaryDirty = selectedTopicDirty || firstVolumeOutline !== savedFirstVolumeOutline || instructionDirty;
  const hasUnsavedChanges = isDirty || auxiliaryDirty;
  const relevantVersions = useMemo(() => initial.contentVersions.filter((version) => {
    if (version.contentType === "template") return initial.promptSource.mode === "custom" && version.contentKey === step;
    if (version.contentType === "novel_field") return (step === "topics" && version.contentKey === "selectedTopic") || ((step === "volumes" || step === "units") && version.contentKey === "firstVolumeOutline");
    if (step === "units") return version.contentType === "story_unit" && version.contentKey === String(rangeStart);
    if (step === "outlines") return version.contentType === "outline_batch" && version.contentKey === String(rangeStart);
    if (step === "drafts") return version.contentType === "chapter" && version.contentKey === String(chapter);
    return version.contentType === "step" && version.contentKey === step;
  }), [chapter, initial.contentVersions, initial.promptSource.mode, rangeStart, step]);

  const rangeStates = useMemo(() => {
    const states = new Map<number, SelectorItemState>();
    const settingsSaved = initial.steps.some((row) => row.key === "settings" && String(row.content ?? "").trim());
    for (const start of [1, 11, 21, 31, 41, 51]) {
      if (step === "units") {
        const saved = initial.storyUnits.some((row) => Number(row.startChapter) === start && String(row.content ?? "").trim());
        states.set(start, saved ? "saved" : settingsSaved && Boolean(firstVolumeOutline.trim()) ? "ready" : "blocked");
      } else {
        const saved = initial.chapterOutlines.some((row) => Number(row.chapterNumber) === start && String(row.content ?? "").trim());
        const unitReady = initial.storyUnits.some((row) => Number(row.startChapter) === start && String(row.content ?? "").trim());
        states.set(start, saved ? "saved" : unitReady ? "ready" : "blocked");
      }
    }
    return states;
  }, [firstVolumeOutline, initial.chapterOutlines, initial.steps, initial.storyUnits, step]);

  const chapterStates = useMemo(() => {
    const states = new Map<number, SelectorItemState>();
    const settingsSaved = initial.steps.some((row) => row.key === "settings" && String(row.content ?? "").trim());
    for (let number = 1; number <= 60; number += 1) {
      const row = initial.chapters.find((item) => Number(item.chapterNumber) === number);
      const status = chapterStatusOverrides.get(number) ?? String(row?.status ?? "not_started") as ChapterStatus;
      if (status === "published") { states.set(number, "published"); continue; }
      if (String(row?.content ?? "").trim()) { states.set(number, "saved"); continue; }
      const rangeStartForChapter = Math.floor((number - 1) / 10) * 10 + 1;
      const hasUnit = initial.storyUnits.some((item) => Number(item.startChapter) === rangeStartForChapter && String(item.content ?? "").trim());
      const hasOutline = initial.chapterOutlines.some((item) => Number(item.chapterNumber) === number && String(item.content ?? "").trim());
      const hasPrevious = number === 1 || initial.chapters.some((item) => Number(item.chapterNumber) === number - 1 && String(item.content ?? "").trim());
      states.set(number, settingsSaved && Boolean(firstVolumeOutline.trim()) && hasUnit && hasOutline && hasPrevious ? "ready" : "blocked");
    }
    return states;
  }, [chapterStatusOverrides, firstVolumeOutline, initial.chapterOutlines, initial.chapters, initial.steps, initial.storyUnits]);

  const currentChapterStatus = chapterStatusOverrides.get(chapter) ?? String(initial.chapters.find((row) => Number(row.chapterNumber) === chapter)?.status ?? "not_started") as ChapterStatus;
  function acceptAutomatedChapters(chapters: Array<{ chapterNumber: number; content: string }>) {
    const timestamp = currentTimestamp();
    for (const imported of chapters) savedContentCache.current.set(`drafts-${imported.chapterNumber}`, { content: imported.content, updatedAt: timestamp });
    setChapterStatusOverrides((current) => {
      const next = new Map(current);
      for (const imported of chapters) next.set(imported.chapterNumber, "saved");
      return next;
    });
    const current = chapters.find((imported) => imported.chapterNumber === chapter);
    if (current) {
      setContent(current.content);
      setSavedContent(current.content);
      setLastSavedAt(timestamp);
      clearLocalDraft(String(initial.novel.id), { step: "drafts", rangeStart, chapter });
    }
  }
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
      if (draft !== null && draft.content !== savedContent) {
        const sameBase = draft.baseUpdatedAt === lastSavedAt;
        const restore = sameBase || window.confirm("发现一份基于较旧版本的本地草稿。是否仍要恢复？\n\n选择“取消”会丢弃这份旧草稿。");
        if (restore) { setContent(draft.content); setMessage(sameBase ? "已恢复本地草稿" : "已恢复旧版草稿，请核对后保存"); }
        else clearLocalDraft(String(initial.novel.id), position);
      } else if (draft?.content === savedContent) clearLocalDraft(String(initial.novel.id), position);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initial.novel.id, position, positionKey, savedContent, lastSavedAt]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const key = `dropmind:flash:${String(initial.novel.id)}`;
      const flash = window.sessionStorage.getItem(key);
      if (flash) { setMessage(flash); window.sessionStorage.removeItem(key); }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initial.novel.id]);

  useEffect(() => {
    const timeout = window.setTimeout(async () => {
      const result = await inspectCodexChapterAction({ novelId: String(initial.novel.id), chapterNumber: chapter });
      if (result.ok) setCodexState(result.state); else setMessage(result.error);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [chapter, initial.novel.id]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  function confirmLeave() {
    if (!hasUnsavedChanges) return true;
    if (isDirty) writeLocalDraft(String(initial.novel.id), position, content, lastSavedAt);
    return window.confirm(auxiliaryDirty ? "当前页面还有未保存的字段，确定离开并放弃这些修改吗？" : "当前内容还没有正式保存，确定离开吗？本地草稿会继续保留。");
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
    else writeLocalDraft(String(initial.novel.id), position, value, lastSavedAt);
    setContent(value);
    setSavePhase("idle");
  }

  async function saveCurrent() {
    if (!isDirty) return Boolean(savedContent.trim());
    setSavePhase("saving");
    let result;
    if (step === "units") result = await saveUnitAction({ novelId: initial.novel.id, startChapter: rangeStart, content, draft: false });
    else if (step === "outlines") result = await saveOutlineBatchAction({ novelId: initial.novel.id, startChapter: rangeStart, content, draft: false });
    else if (step === "drafts") result = await saveChapterAction({ novelId: initial.novel.id, chapterNumber: chapter, content, status: "saved" as ChapterStatus, draft: false });
    else result = await saveStepAction({ novelId: initial.novel.id, key: step, content, draft: false });
    if (!result.ok) { setSavePhase("error"); setMessage(result.error); return false; }
    const timestamp = currentTimestamp();
    const snapshot = { content, updatedAt: timestamp };
    savedContentCache.current.set(positionKey, snapshot);
    clearLocalDraft(String(initial.novel.id), position);
    setSavedContent(content);
    setLastSavedAt(timestamp);
    setSavePhase("idle");
    setMessage(result.warning ?? "");
    if (step === "drafts") {
      setChapterStatusOverrides((current) => new Map(current).set(chapter, "saved"));
      void refreshCodexState();
    }
    router.refresh();
    return true;
  }

  async function saveAndAdvance() {
    if (!followingPosition) return;
    const saved = await saveCurrent();
    if (!saved) return;
    if (step === "topics") {
      if (!selectedTopicTitle.trim()) { setMessage("请先填写书名"); return; }
      if (!selectedTopicSummary.trim()) { setMessage("请先填写简介"); return; }
      if (selectedTopicDirty && !await saveNovelField("selectedTopic", selectedTopic, "已保存书名和简介")) return;
    }
    if (step === "volumes") {
      if (!firstVolumeOutline.trim()) { setMessage("请先确认本卷大纲"); return; }
      if (firstVolumeOutline !== savedFirstVolumeOutline && !await saveNovelField("firstVolumeOutline", firstVolumeOutline, "已保存本卷大纲")) return;
    }
    if (instructionDirty) { setMessage("请先保存本书专用创作要求"); return; }
    openPosition(followingPosition, true);
  }
  async function copyText(value: string, success: string) { try { await navigator.clipboard.writeText(value); setMessage(success); } catch { setMessage("复制失败，请在提示词框按 Ctrl+C"); } }
  async function copyPrompt() { await copyText(promptText, "作品标签提示词已复制"); }
  async function prepareCodexTask() {
    setMessage("正在同步资料并准备任务…");
    const result=await prepareCodexChapterTaskAction({novelId:String(initial.novel.id),chapterNumber:chapter});
    if(result.ok){
      try { await navigator.clipboard.writeText(result.command); setMessage(`第${chapter}章任务已准备，指令已复制`); } catch { setMessage(`第${chapter}章任务已准备，请发送“${result.command}”`); }
      await refreshCodexState();
    }else setMessage(result.error);
  }

  async function refreshCodexState() {
    const result = await inspectCodexChapterAction({ novelId: String(initial.novel.id), chapterNumber: chapter });
    if (result.ok) setCodexState(result.state);
    else setMessage(result.error);
  }

  async function syncCodexProject() {
    setMessage("正在同步 Codex 资料…");
    const result = await syncCodexProjectAction(String(initial.novel.id));
    if (!result.ok) { setMessage(result.error); return; }
    setMessage("Codex 资料已同步");
    await refreshCodexState();
  }
  async function importCodexChapter() {
    setMessage("正在读取 Codex 正文…");
    const preview=await previewCodexChapterAction({novelId:String(initial.novel.id),chapterNumber:chapter});
    if(!preview.ok){setMessage(preview.error);return;}
    const databaseDiffers=preview.databaseContent.trim()!==""&&preview.databaseContent!==preview.content;
    if((isDirty||databaseDiffers)&&!window.confirm(`Codex 正文与当前工作台内容不同。\n\nCodex：${preview.content.length} 字符\n工作台：${content.length} 字符\n\n确认用 Codex 正文覆盖工作台版本吗？`)){setMessage("已取消导入");return;}
    const result=await importCodexChapterAction({novelId:String(initial.novel.id),chapterNumber:chapter,expectedUpdatedAt:preview.databaseUpdatedAt,expectedDatabaseContent:preview.databaseContent,expectedFileContent:preview.content});
    if(result.ok){const timestamp=currentTimestamp();const snapshot={content:result.content,updatedAt:timestamp};savedContentCache.current.set(positionKey,snapshot);clearLocalDraft(String(initial.novel.id),position);setContent(result.content);setSavedContent(result.content);setLastSavedAt(timestamp);setSavePhase("idle");setChapterStatusOverrides((current)=>new Map(current).set(chapter,"saved"));setMessage(`已读取并保存第${chapter}章正文`);router.refresh();await refreshCodexState();}else setMessage(result.error);
  }

  async function saveNovelField(field: "selectedTopic" | "firstVolumeOutline", value: string, success: string) {
    const result = await updateNovelAction({ novelId: initial.novel.id, [field]: value });
    if (!result.ok) { setMessage(result.error); return false; }
    if (field === "selectedTopic") {
      const fields = parseSelectedTopic(value);
      setSavedSelectedTopicTitle(fields.title);
      setSavedSelectedTopicSummary(fields.summary);
    } else setSavedFirstVolumeOutline(value);
    router.refresh();
    setMessage(result.warning ?? success);
    return true;
  }

  async function setPublished(published: boolean) {
    if (isDirty) { setMessage("请先保存正文，再修改发布状态"); return; }
    if (!content.trim()) { setMessage("正文为空，不能标记为已发布"); return; }
    const status: ChapterStatus = published ? "published" : "saved";
    const result = await updateChapterStatusAction({ novelId: initial.novel.id, chapterNumber: chapter, status });
    if (!result.ok) { setMessage(result.error); return; }
    setChapterStatusOverrides((current) => new Map(current).set(chapter, status));
    setMessage(published ? `第${chapter}章已标记为发布` : `第${chapter}章已撤回发布标记`);
    router.refresh();
  }

  async function restoreVersion(version: ContentVersionData) {
    if (!confirmLeave() || !window.confirm("恢复后，当前内容会自动进入历史版本，确认继续吗？")) return;
    setRestoringVersionId(version.id);
    const result = await restoreContentVersionAction({ novelId: String(initial.novel.id), versionId: version.id });
    setRestoringVersionId(null);
    if (!result.ok) { setMessage(result.error); return; }
    if (version.contentType === "novel_field") {
      if (version.contentKey === "selectedTopic") {
        const fields = parseSelectedTopic(version.content);
        setSelectedTopicTitle(fields.title);
        setSelectedTopicSummary(fields.summary);
        setSavedSelectedTopicTitle(fields.title);
        setSavedSelectedTopicSummary(fields.summary);
      }
      else { setFirstVolumeOutline(version.content); setSavedFirstVolumeOutline(version.content); }
    } else if (version.contentType === "template") setInstructionOverride(null);
    else {
      const timestamp = currentTimestamp();
      const snapshot = { content: version.content, updatedAt: timestamp };
      savedContentCache.current.set(positionKey, snapshot);
      clearLocalDraft(String(initial.novel.id), position);
      setContent(version.content); setSavedContent(version.content); setLastSavedAt(timestamp); setSavePhase("idle");
    }
    setMessage(result.warning ?? "已恢复历史版本；恢复前的内容也已保留");
    router.refresh();
  }

  function openMissing(label: string) {
    if (label.includes("选题")) openPosition({ ...position, step: "topics" });
    else if (label.includes("分卷") || label.includes("本卷")) openPosition({ ...position, step: "volumes" });
    else if (label.includes("核心设定")) openPosition({ ...position, step: "settings" });
    else if (label.includes("剧情单元")) openPosition({ ...position, step: "units" });
    else if (label.includes("大纲")) openPosition({ ...position, step: "outlines" });
    else if (label.includes("上一章") && chapter > 1) openPosition({ ...position, step: "drafts", chapter: chapter - 1 });
  }

  const saveStatus = savePhase === "saving" ? { kind: "saving", label: "正在保存" }
    : savePhase === "error" ? { kind: "error", label: "保存失败" }
    : isDirty ? { kind: "dirty", label: "未保存" }
    : lastSavedAt ? { kind: "saved", label: `已保存，${savedTime(lastSavedAt)}` }
    : { kind: "idle", label: "尚未保存" };

  return <main className={`workspace-shell ${sidebarOpen?"sidebar-open":"sidebar-closed"}`}>
    <WorkflowSidebar open={sidebarOpen} novelName={initial.novel.name} activeStep={step} position={position} overview={workflowOverview} onLeave={confirmLeave} onOpen={openPosition} onToggle={() => setSidebarOpen((open) => { const next = !open; writeSidebarState(next); return next; })} onBackup={async () => { const result = await exportNovelAction(String(initial.novel.id), "json"); if (result.ok) download(result.content, `${initial.novel.name}-备份.json`, "application/json"); else setMessage(result.error); }} onExportText={async () => { const result = await exportNovelAction(String(initial.novel.id), "txt"); if (result.ok) download(result.content, `${initial.novel.name}-第一卷.txt`, "text/plain;charset=utf-8"); else setMessage(result.error); }} />
    <section className="workspace-main"><header><p className="novel-kicker">{STEP_LABELS[step]}</p><h1>{String(initial.novel.name)}</h1></header>
      {!automationMode && !chapterAutomationMode && ["topics", "volumes", "settings", "units", "outlines"].includes(step) && selectedTopicConfirmed && <section className="automation-entry"><div><strong>第一步已确认，可以交给本地 Codex 串行生成后续规划</strong><span>手动模式仍是默认模式，自动结果通过校验后才会导入。</span></div><button type="button" onClick={() => { if (confirmLeave()) setAutomationMode(true); }}>自动生成第 2–5 步</button></section>}
      {!automationMode && !chapterAutomationMode && step === "drafts" && <section className="automation-entry"><div><strong>让本地 Codex 连续创作正文</strong><span>自选起始章，单次生成 1–10 章；每章读取本地资料和上一章正文。</span></div><button type="button" onClick={() => { if (confirmLeave()) setChapterAutomationMode(true); }}>自动生成正文</button></section>}
      {automationMode && <AutomationPanel novelId={String(initial.novel.id)} onReturnManual={() => setAutomationMode(false)} />}
      {chapterAutomationMode && <ChapterAutomationPanel novelId={String(initial.novel.id)} currentChapter={chapter} savedChapters={initial.chapters.filter((row) => String(row.content ?? "").trim()).map((row) => Number(row.chapterNumber))} publishedChapters={initial.chapters.filter((row) => String(row.status) === "published").map((row) => Number(row.chapterNumber))} onImported={acceptAutomatedChapters} onReturnManual={() => setChapterAutomationMode(false)} />}
      <div hidden={automationMode || chapterAutomationMode}>
      <section className="prompt-source-bar"><strong>当前提示词：{initial.promptSource.schemeName}{initial.promptSource.mode==="scheme"?"（跟随方案）":""}</strong><select value={schemeChoice} onChange={(event)=>setSchemeChoice(event.target.value)}>{schemes.map((scheme)=><option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}</select><button type="button" onClick={async()=>{if(!confirmLeave())return;const result=await setNovelSchemeAction({novelId:String(initial.novel.id),schemeId:schemeChoice});if(result.ok){router.refresh();setMessage(result.warning??"已切换方案")}else setMessage(result.error)}}>{initial.promptSource.mode==="scheme"?"切换方案":"恢复跟随方案"}</button>{initial.promptSource.mode==="scheme"&&<button type="button" onClick={async()=>{if(!confirmLeave())return;const result=await detachNovelSchemeAction(String(initial.novel.id));if(result.ok){router.refresh();setMessage(result.warning??"已转为本书专用")}else setMessage(result.error)}}>转为本书专用</button>}</section>
      {(step === "units" || step === "outlines") && <ChapterSelector mode="range" value={rangeStart} onChange={(value) => openPosition({ ...position, rangeStart: value })} states={rangeStates} />}
      {step === "drafts" && <><div className="chapter-navigation"><button type="button" disabled={chapter===1} onClick={()=>openPosition({...position,chapter:chapter-1})}>← 上一章</button><strong>第 {chapter} 章</strong><button type="button" disabled={chapter===60} onClick={()=>openPosition({...position,chapter:chapter+1})}>下一章 →</button><button type="button" onClick={()=>{const first=[...chapterStates].find(([,state])=>state==="ready");if(first)openPosition({...position,chapter:first[0]});else setMessage("当前没有可直接开始的未完成章节")}}>首个可写章节</button></div><ChapterSelector mode="chapter" value={chapter} onChange={(value) => openPosition({ ...position, chapter: value })} states={chapterStates} /></>}
      {(step === "topics" || step === "volumes") && <section className="step-checklist"><strong>本步骤完成条件</strong><span className={savedContent.trim()&&!isDirty?"done":"pending"}>{savedContent.trim()&&!isDirty?"✓":"1"} 模型生成结果已保存</span><span className={(step==="topics"?selectedTopicConfirmed&&!selectedTopicDirty:firstVolumeOutline===savedFirstVolumeOutline&&Boolean(savedFirstVolumeOutline.trim()))?"done":"pending"}>{(step==="topics"?selectedTopicConfirmed&&!selectedTopicDirty:firstVolumeOutline===savedFirstVolumeOutline&&Boolean(savedFirstVolumeOutline.trim()))?"✓":"2"} {step==="topics"?"书名和简介已确认":"本卷大纲已确认"}</span></section>}
      {step === "topics" && <section className="novel-inline-field selected-topic-fields"><strong>最终选题</strong><label>书名<input value={selectedTopicTitle} onChange={(event) => setSelectedTopicTitle(event.target.value)} placeholder="输入最终书名" /></label><label>简介<textarea value={selectedTopicSummary} onChange={(event) => setSelectedTopicSummary(event.target.value)} rows={8} placeholder="输入最终简介" /></label><button type="button" disabled={!selectedTopicDirty||!selectedTopicComplete} onClick={()=>saveNovelField("selectedTopic",selectedTopic,"已保存书名和简介")}>保存书名和简介</button></section>}
      {step === "volumes" && <label className="novel-inline-field">第一卷大纲<textarea value={firstVolumeOutline} onChange={(event) => setFirstVolumeOutline(event.target.value)} rows={6} /><button type="button" disabled={firstVolumeOutline===savedFirstVolumeOutline} onClick={()=>saveNovelField("firstVolumeOutline",firstVolumeOutline,"已保存第一卷大纲")}>保存第一卷大纲</button></label>}
      {step === "units" && <label className="novel-inline-field">本卷大纲<textarea value={firstVolumeOutline} onChange={(event) => setFirstVolumeOutline(event.target.value)} rows={6} placeholder="粘贴当前卷的大纲，保存后六个批次会自动复用" /><button type="button" disabled={firstVolumeOutline===savedFirstVolumeOutline} onClick={()=>saveNovelField("firstVolumeOutline",firstVolumeOutline,"已保存本卷大纲")}>保存本卷大纲</button></label>}
      {initial.promptSource.mode==="custom"&&<label className="novel-inline-field">本书专用 · {STEP_LABELS[step]}{step==="tags"?"提示词":"创作要求"}<textarea value={customInstruction} onChange={(event)=>setInstructionOverride({key:instructionKey,value:event.target.value})} rows={8}/><button type="button" disabled={customInstruction===baseInstruction} onClick={async()=>{const result=await updateTemplateAction({novelId:String(initial.novel.id),key:step,template:customInstruction});if(result.ok){setInstructionOverride(null);router.refresh();setMessage(result.warning??"已保存本书专用要求")}else setMessage(result.error)}}>保存本书专用要求</button></label>}
      {step === "drafts" && <CodexProjectPanel chapter={chapter} project={codexProject} state={codexState} message={message} onSync={syncCodexProject} onPrepare={prepareCodexTask} onImport={importCodexChapter} onRefresh={refreshCodexState} onCopyPath={async () => { try { await navigator.clipboard.writeText(codexProject.projectDir); setMessage("项目路径已复制"); } catch { setMessage("复制失败，请手动复制路径"); } }} />}
      <section className="automatic-context"><strong>本步骤自动加入</strong><div>{promptInfo.automaticLabels.map((label)=><span key={label}>{label}</span>)}</div></section>
      <div className="editor-grid"><section className="editor-panel">{step==="tags"?<div className="publish-preparation-prompts"><div><div className="panel-title"><h3>作品标签提示词</h3><div className="panel-title-actions"><button type="button" disabled={promptMissing.length > 0||!promptText.trim()} onClick={copyPrompt}>复制标签提示词</button></div></div>{promptMissing.length > 0 && <div className="missing-links"><strong>还缺少：</strong>{promptMissing.map((label)=><button type="button" key={label} onClick={()=>openMissing(label)}>{label} →</button>)}</div>}<textarea value={promptText} readOnly rows={18} /></div><div><div className="panel-title"><h3>番茄爽文小说封面创作</h3><div className="panel-title-actions"><button type="button" disabled={coverMissing} onClick={()=>copyText(coverPrompt,"封面提示词已复制")}>复制封面提示词</button></div></div>{coverMissing&&<div className="missing-links"><strong>还缺少：</strong>{!selectedTopicSummary.trim()&&<button type="button" onClick={()=>openPosition({...position,step:"topics"})}>简介 →</button>}{!coverInstruction.trim()&&<span>封面创作要求</span>}</div>}<textarea value={coverPrompt} readOnly rows={14} /></div></div>:<><div className="panel-title"><h3>{step==="drafts"?"Codex短指令":"最终提示词（可临时修改）"}</h3><div className="panel-title-actions"><button type="button" onClick={()=>setPromptOverride(null)}>{step==="drafts"?"恢复短指令":"恢复自动生成"}</button><button type="button" disabled={promptMissing.length > 0||!promptText.trim()} onClick={()=>copyText(promptText,"提示词已复制")}>复制提示词</button></div></div>{promptMissing.length > 0 && <div className="missing-links"><strong>还缺少：</strong>{promptMissing.map((label)=><button type="button" key={label} onClick={()=>openMissing(label)}>{label} →</button>)}</div>}<textarea value={promptText} onChange={(event)=>setPromptOverride({key:promptKey,value:event.target.value})} rows={step==="drafts"?6:22} /></>}</section>
        <section className="editor-panel"><div className="panel-title"><h3>{step==="drafts"?`第${chapter}章正文（可手动编辑）`:step==="tags"?"粘贴 Gemini 推荐的作品标签":"粘贴 Gemini 返回内容"}</h3><div className="panel-title-actions"><span className={`save-status ${saveStatus.kind}`}>{saveStatus.label}</span><span>{content.length} 字符</span><button className="save-secondary" type="button" disabled={savePhase==="saving"||!isDirty} onClick={saveCurrent}>保存</button>{followingPosition&&<button type="button" disabled={savePhase==="saving"||!content.trim()||(step==="topics"&&!selectedTopicComplete)||(step==="volumes"&&!firstVolumeOutline.trim())||Boolean(instructionDirty)} onClick={saveAndAdvance}>{nextActionLabel}</button>}{step==="drafts"&&content.trim()&&<button className="publish-toggle" type="button" disabled={savePhase==="saving"||isDirty} onClick={()=>setPublished(currentChapterStatus!=="published")}>{currentChapterStatus==="published"?"撤回发布标记":"标记为已发布"}</button>}</div></div><textarea key={positionKey} value={content} onChange={(event) => changeContent(event.target.value)} rows={step==="tags"?34:22} placeholder={step==="drafts"?"Codex正文读取后会显示在这里，也可以手动粘贴…":step==="tags"?"将 Gemini 推荐的主分类、主题、角色、情节和主角名原样粘贴到这里…":"在这里粘贴生成结果…"} />{message&&<div className="editor-actions"><span>{message}</span></div>}</section></div>
      <ContentHistory versions={relevantVersions} restoringId={restoringVersionId} onRestore={restoreVersion} />
      <details className="danger-zone"><summary>删除小说</summary><button type="button" onClick={async () => { const confirmation = window.prompt(`请输入小说名称：${initial.novel.name}`); if (!confirmation) return; const result = await deleteNovelAction({ novelId: String(initial.novel.id), confirmation }); if (result.ok) router.push("/novels"); else setMessage(result.error); }}>删除整个项目</button></details>
      </div>
    </section>
  </main>;
}
