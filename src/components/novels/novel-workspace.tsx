"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChapterStatus, StepKey } from "@/lib/novel-db/schema";
import { deleteNovelAction, detachNovelSchemeAction, exportNovelAction, importCodexChapterAction, inspectCodexChapterAction, prepareCodexChapterTaskAction, previewCodexChapterAction, restoreContentVersionAction, saveChapterAction, saveOutlineBatchAction, saveStepAction, saveUnitAction, saveWorkPositionAction, setNovelSchemeAction, syncCodexProjectAction, updateChapterStatusAction, updateNovelAction, updateTemplateAction } from "@/app/novels/actions";
import type { AutomationManifest } from "@/modules/novels/automation";
import type { ChapterAutomationManifest } from "@/modules/novels/chapter-automation";
import type { CodexChapterState } from "@/modules/novels/codex-project";
import type { ContentVersionData, NovelWorkspaceData } from "@/modules/novels/types";
import type { NovelDeliveryState } from "@/modules/novels/delivery";
import { buildCoverPrompt, buildPromptContext } from "@/modules/novels/prompts";
import { formatSelectedTopic, parseSelectedTopic } from "@/modules/novels/selected-topic";
import { CODEX_DRAFT_COMMAND } from "@/modules/novels/structured-prompts";
import { normalizeChapterTitle } from "@/modules/novels/chapter-title";
import { STEP_LABELS } from "@/modules/novels/templates";
import { buildWorkflowOverview, nextWorkActionLabel, nextWorkPosition, normalizeWorkPosition, type WorkPosition } from "@/modules/novels/work-state";
import { ChapterSelector, type SelectorItemState } from "./chapter-selector";
import { inspectAutomationRunQueued, inspectChapterAutomationRunQueued } from "./automation-inspection";
import { ChapterAutomationPanel } from "./chapter-automation-panel";
import { AutomationPanel } from "./automation-panel";
import { AutomationTaskCenter, type AutomationTaskView } from "./automation-task-center";
import { CodexProjectPanel } from "./codex-project-panel";
import { ContentHistory } from "./content-history";
import { FanqieDeliveryPanel } from "./fanqie-delivery-panel";
import { WorkflowSidebar } from "./workflow-sidebar";
import { WorkspaceConfirmDialog } from "./workspace-overlays";

const SIDEBAR_STORAGE_KEY = "dropmind:novel-workbench:sidebar-open";

type EditorSnapshot = { title: string; content: string; updatedAt: number | null };
type SavePhase = "idle" | "saving" | "error";
type ChapterWorkspaceMode = "write" | "publish" | "read";
type CodexChapterPreview = Extract<Awaited<ReturnType<typeof previewCodexChapterAction>>, { ok: true }>;
type WorkspaceConfirmation = { kind: "stale-draft"; draft: LocalDraft; position: WorkPosition }
  | { kind: "import-codex"; preview: CodexChapterPreview }
  | { kind: "restore-version"; version: ContentVersionData }
  | { kind: "delete-novel" };
type GuardedAction = { kind: "open-position"; position: WorkPosition }
  | { kind: "navigate"; href: string }
  | { kind: "switch-scheme"; schemeId: string }
  | { kind: "detach-scheme" }
  | { kind: "restore-version"; version: ContentVersionData };

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
  return { title: position.step === "drafts" ? String((row as { title?: unknown } | undefined)?.title ?? "") : "", content: String(row?.content ?? ""), updatedAt: row?.updatedAt ? Number(row.updatedAt) : null };
}

function draftStorageKey(novelId: string, position: WorkPosition) {
  return `dropmind:novel-draft:${novelId}:${workKey(position)}`;
}

type LocalDraft = { title?: string; content: string; updatedAt: number; baseUpdatedAt: number | null };

function readLocalDraft(novelId: string, position: WorkPosition): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(novelId, position));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<LocalDraft>;
    return typeof draft.content === "string" ? { title: typeof draft.title === "string" ? draft.title : undefined, content: draft.content, updatedAt: Number(draft.updatedAt ?? 0), baseUpdatedAt: typeof draft.baseUpdatedAt === "number" ? draft.baseUpdatedAt : null } : null;
  } catch { return null; }
}

function writeLocalDraft(novelId: string, position: WorkPosition, content: string, baseUpdatedAt: number | null, title?: string) {
  try { window.localStorage.setItem(draftStorageKey(novelId, position), JSON.stringify({ title, content, updatedAt: Date.now(), baseUpdatedAt })); } catch { /* 浏览器禁用存储时仍可手动保存 */ }
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

export function NovelWorkspace({ initial, schemes, codexProject, delivery, deliveryExtensionDir }: { initial: NovelWorkspaceData; schemes:Array<{id:string;name:string}>; codexProject:{projectDir:string;folderName:string;exists:boolean}; delivery:NovelDeliveryState; deliveryExtensionDir:string }) {
  const router = useRouter();
  const initialSelectedTopic = parseSelectedTopic(String(initial.novel.selectedTopic ?? ""));
  const initialPosition = normalizeWorkPosition({ step: String(initial.novel.currentStep) as StepKey, rangeStart: Number(initial.novel.currentRangeStart ?? 1), chapter: Number(initial.novel.currentChapter ?? 1) });
  const initialSnapshot = editorSnapshot(initial, initialPosition);
  const [step, setStep] = useState<StepKey>(initialPosition.step);
  const [rangeStart, setRangeStart] = useState(initialPosition.rangeStart);
  const [chapter, setChapter] = useState(initialPosition.chapter);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [message, setMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [confirmation, setConfirmation] = useState<WorkspaceConfirmation | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [guardedAction, setGuardedAction] = useState<GuardedAction | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyFeedbackTimer = useRef<number | null>(null);
  const [content, setContent] = useState(initialSnapshot.content);
  const [savedContent, setSavedContent] = useState(initialSnapshot.content);
  const [chapterTitle, setChapterTitle] = useState(initialSnapshot.title);
  const [savedChapterTitle, setSavedChapterTitle] = useState(initialSnapshot.title);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initialSnapshot.updatedAt);
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const savedContentCache = useRef(new Map<string, EditorSnapshot>([[workKey(initialPosition), initialSnapshot]]));
  const positionSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const workspaceTopRef = useRef<HTMLElement>(null);
  const editorTopRef = useRef<HTMLDivElement>(null);
  const [selectedTopicTitle, setSelectedTopicTitle] = useState(initialSelectedTopic.title);
  const [selectedTopicSummary, setSelectedTopicSummary] = useState(initialSelectedTopic.summary);
  const [savedSelectedTopicTitle, setSavedSelectedTopicTitle] = useState(initialSelectedTopic.title);
  const [savedSelectedTopicSummary, setSavedSelectedTopicSummary] = useState(initialSelectedTopic.summary);
  const [firstVolumeOutline, setFirstVolumeOutline] = useState(String(initial.novel.firstVolumeOutline ?? ""));
  const [savedFirstVolumeOutline, setSavedFirstVolumeOutline] = useState(String(initial.novel.firstVolumeOutline ?? ""));
  const position = useMemo(() => ({ step, rangeStart, chapter }), [step, rangeStart, chapter]);
  const positionKey = workKey(position);
  const chapterTitleDirty = step === "drafts" && chapterTitle !== savedChapterTitle;
  const isDirty = content !== savedContent || chapterTitleDirty;
  const editorStateRef = useRef({ step, chapter, rangeStart, title: chapterTitle, content, isDirty });
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
  const [codexState, setCodexState] = useState<CodexChapterState>({ phase: codexProject.exists ? "synced" : "not_initialized", projectExists: codexProject.exists, taskChapter: null, fileExists: false, fileModifiedAt: null, missing: [], generationAllowed: false, generationBlockedReason: null, nextWritableChapter: null });
  const [chapterStatusOverrides, setChapterStatusOverrides] = useState(new Map<number, ChapterStatus>());
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [automationMode, setAutomationMode] = useState(false);
  const [chapterAutomationMode, setChapterAutomationMode] = useState(false);
  const [planningTask, setPlanningTask] = useState<AutomationManifest | null>(null);
  const [chapterTask, setChapterTask] = useState<ChapterAutomationManifest | null>(null);
  const [chapterNewBatchStart, setChapterNewBatchStart] = useState<number | null>(null);
  const [chapterWorkspaceMode, setChapterWorkspaceMode] = useState<ChapterWorkspaceMode>("write");
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

  const chapterGenerationRange = useMemo(() => {
    const written = new Set(initial.chapters.filter((row) => String(row.content ?? "").trim()).map((row) => Number(row.chapterNumber)));
    for (const [chapterNumber, status] of chapterStatusOverrides) if (status === "saved" || status === "published") written.add(chapterNumber);
    let nextChapter: number | null = null;
    for (let chapterNumber = 1; chapterNumber <= 60; chapterNumber += 1) {
      if (!written.has(chapterNumber)) { nextChapter = chapterNumber; break; }
    }
    if (nextChapter === null) return { nextChapter, maxCount: 0 };
    let maxCount = 0;
    for (let chapterNumber = nextChapter; chapterNumber <= 60 && maxCount < 10 && !written.has(chapterNumber); chapterNumber += 1) maxCount += 1;
    return { nextChapter, maxCount };
  }, [chapterStatusOverrides, initial.chapters]);

  const currentChapterStatus = chapterStatusOverrides.get(chapter) ?? String(initial.chapters.find((row) => Number(row.chapterNumber) === chapter)?.status ?? "not_started") as ChapterStatus;
  useEffect(() => {
    editorStateRef.current = { step, chapter, rangeStart, title: chapterTitle, content, isDirty };
  }, [chapter, chapterTitle, content, isDirty, rangeStart, step]);

  const acceptAutomatedChapters = useCallback((chapters: Array<{ chapterNumber: number; title: string; content: string }>) => {
    const timestamp = currentTimestamp();
    for (const imported of chapters) savedContentCache.current.set(`drafts-${imported.chapterNumber}`, { title: imported.title, content: imported.content, updatedAt: timestamp });
    setChapterStatusOverrides((current) => {
      const next = new Map(current);
      for (const imported of chapters) next.set(imported.chapterNumber, "saved");
      return next;
    });
    const editor = editorStateRef.current;
    const current = editor.step === "drafts" ? chapters.find((imported) => imported.chapterNumber === editor.chapter) : null;
    if (current) {
      setSavedChapterTitle(current.title);
      setSavedContent(current.content);
      setLastSavedAt(timestamp);
      if (editor.isDirty) {
        writeLocalDraft(String(initial.novel.id), { step: "drafts", rangeStart: editor.rangeStart, chapter: editor.chapter }, editor.content, timestamp, editor.title);
        setMessage("自动正文已导入；当前正在编辑的本地草稿已保留，请核对后保存");
      } else {
        setChapterTitle(current.title);
        setContent(current.content);
        clearLocalDraft(String(initial.novel.id), { step: "drafts", rangeStart: editor.rangeStart, chapter: editor.chapter });
      }
    }
  }, [initial.novel.id, setChapterStatusOverrides, setChapterTitle, setContent, setLastSavedAt, setMessage, setSavedChapterTitle, setSavedContent]);

  useEffect(() => {
    if (automationMode) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const result = await inspectAutomationRunQueued(String(initial.novel.id));
      refreshing = false;
      if (disposed || !result.ok) return;
      setPlanningTask(result.run?.manifest ?? null);
      if (result.run?.importedCount) router.refresh();
    };
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    const interval = window.setInterval(() => { void refresh(); }, 3000);
    return () => { disposed = true; window.clearTimeout(timeout); window.clearInterval(interval); };
  }, [automationMode, initial.novel.id, router]);

  useEffect(() => {
    if (chapterAutomationMode) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const result = await inspectChapterAutomationRunQueued(String(initial.novel.id));
      refreshing = false;
      if (disposed || !result.ok) return;
      setChapterTask(result.run?.manifest ?? null);
      if (result.run?.importedCount) {
        acceptAutomatedChapters(result.run.importedChapters);
        router.refresh();
      }
    };
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    const interval = window.setInterval(() => { void refresh(); }, 3000);
    return () => { disposed = true; window.clearTimeout(timeout); window.clearInterval(interval); };
  }, [acceptAutomatedChapters, chapterAutomationMode, initial.novel.id, router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const snapshot = editorSnapshot(initial, position);
      savedContentCache.current.set(positionKey, snapshot);
      if (isDirty) {
        if (snapshot.title === savedChapterTitle && snapshot.content === savedContent && snapshot.updatedAt === lastSavedAt) return;
        setSavedChapterTitle(snapshot.title);
        setSavedContent(snapshot.content);
        setLastSavedAt(snapshot.updatedAt);
        writeLocalDraft(String(initial.novel.id), position, content, snapshot.updatedAt, step === "drafts" ? chapterTitle : undefined);
        setMessage("后台内容已更新；当前本地草稿已保留，请核对后保存");
        return;
      }
      setChapterTitle(snapshot.title);
      setSavedChapterTitle(snapshot.title);
      setContent(snapshot.content);
      setSavedContent(snapshot.content);
      setLastSavedAt(snapshot.updatedAt);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [chapterTitle, content, initial, isDirty, lastSavedAt, position, positionKey, savedChapterTitle, savedContent, step]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = String(initial.novel.firstVolumeOutline ?? "");
      if (firstVolumeOutline !== savedFirstVolumeOutline) {
        if (next !== savedFirstVolumeOutline) {
          setSavedFirstVolumeOutline(next);
          setMessage("自动规划已更新本卷大纲；当前手动修改仍保留在编辑框中");
        }
        return;
      }
      setFirstVolumeOutline(next);
      setSavedFirstVolumeOutline(next);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [firstVolumeOutline, initial.novel.firstVolumeOutline, savedFirstVolumeOutline]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const saved = readSidebarState();
      if (saved !== null) setSidebarOpen(saved);
      else if (window.matchMedia("(max-width: 760px)").matches) setSidebarOpen(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => () => {
    if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
  }, []);

  useEffect(() => {
    if (!message) return;
    const show = window.setTimeout(() => setToastMessage(message), 0);
    const hide = window.setTimeout(() => setToastMessage(""), 3600);
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, [message]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const draft = readLocalDraft(String(initial.novel.id), position);
      const draftTitle = step === "drafts" ? String(draft?.title ?? savedChapterTitle) : "";
      if (draft !== null && (draft.content !== savedContent || draftTitle !== savedChapterTitle)) {
        const sameBase = draft.baseUpdatedAt === lastSavedAt;
        if (sameBase) { if (step === "drafts") setChapterTitle(draftTitle); setContent(draft.content); setMessage("已恢复本地草稿"); }
        else setConfirmation({ kind: "stale-draft", draft, position });
      } else if (draft?.content === savedContent && draftTitle === savedChapterTitle) clearLocalDraft(String(initial.novel.id), position);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initial.novel.id, lastSavedAt, position, positionKey, savedChapterTitle, savedContent, step]);

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

  function guard(action: GuardedAction) {
    if (!hasUnsavedChanges) return false;
    if (isDirty) writeLocalDraft(String(initial.novel.id), position, content, lastSavedAt, step === "drafts" ? chapterTitle : undefined);
    setGuardedAction(action);
    return true;
  }

  function requestLeave(href: string) {
    return !guard({ kind: "navigate", href });
  }

  async function switchScheme(schemeId: string) {
    const result = await setNovelSchemeAction({ novelId: String(initial.novel.id), schemeId });
    if (result.ok) { router.refresh(); setMessage(result.warning ?? "已切换方案"); }
    else setMessage(result.error);
  }

  async function detachScheme() {
    const result = await detachNovelSchemeAction(String(initial.novel.id));
    if (result.ok) { router.refresh(); setMessage(result.warning ?? "已转为本书专用"); }
    else setMessage(result.error);
  }

  async function confirmGuardedAction() {
    const pending = guardedAction;
    if (!pending) return;
    setGuardedAction(null);
    if (pending.kind === "open-position") openPosition(pending.position, true);
    else if (pending.kind === "navigate") router.push(pending.href);
    else if (pending.kind === "switch-scheme") await switchScheme(pending.schemeId);
    else if (pending.kind === "detach-scheme") await detachScheme();
    else setConfirmation({ kind: "restore-version", version: pending.version });
  }

  function persistPosition(next: WorkPosition) {
    positionSaveQueue.current = positionSaveQueue.current.then(async () => {
      const result = await saveWorkPositionAction({ novelId: String(initial.novel.id), currentStep: next.step, currentRangeStart: next.rangeStart, currentChapter: next.chapter });
      if (!result.ok) setMessage(`工作位置记录失败：${result.error}`);
    });
  }

  function scrollToWorkspaceTop() {
    window.requestAnimationFrame(() => workspaceTopRef.current?.scrollIntoView({ block: "start" }));
  }

  function returnToEditor() {
    setAutomationMode(false);
    setChapterAutomationMode(false);
    setChapterNewBatchStart(null);
    window.requestAnimationFrame(() => editorTopRef.current?.scrollIntoView({ block: "start" }));
  }

  function openPlanningTask() {
    setChapterAutomationMode(false);
    setChapterNewBatchStart(null);
    setAutomationMode(true);
  }

  function openChapterTask(newBatchStart: number | null = null) {
    setAutomationMode(false);
    setChapterWorkspaceMode("write");
    setChapterNewBatchStart(newBatchStart);
    setChapterAutomationMode(true);
  }

  function openPosition(next: WorkPosition, skipGuard = false) {
    const normalized = normalizeWorkPosition(next);
    const samePosition = workKey(normalized) === positionKey;
    if (!samePosition && !skipGuard && guard({ kind: "open-position", position: normalized })) return;
    setAutomationMode(false);
    setChapterAutomationMode(false);
    setChapterNewBatchStart(null);
    if (samePosition) { scrollToWorkspaceTop(); return; }
    const snapshot = savedContentCache.current.get(workKey(normalized)) ?? editorSnapshot(initial, normalized);
    setChapterTitle(snapshot.title);
    setSavedChapterTitle(snapshot.title);
    setContent(snapshot.content);
    setSavedContent(snapshot.content);
    setLastSavedAt(snapshot.updatedAt);
    setSavePhase("idle");
    setMessage("");
    setStep(normalized.step);
    setRangeStart(normalized.rangeStart);
    setChapter(normalized.chapter);
    persistPosition(normalized);
    scrollToWorkspaceTop();
  }

  function changeContent(value: string) {
    if (value === savedContent && chapterTitle === savedChapterTitle) clearLocalDraft(String(initial.novel.id), position);
    else writeLocalDraft(String(initial.novel.id), position, value, lastSavedAt, step === "drafts" ? chapterTitle : undefined);
    setContent(value);
    setSavePhase("idle");
  }

  function changeChapterTitle(value: string) {
    setChapterTitle(value);
    if (value === savedChapterTitle && content === savedContent) clearLocalDraft(String(initial.novel.id), position);
    else writeLocalDraft(String(initial.novel.id), position, content, lastSavedAt, value);
    setSavePhase("idle");
  }

  async function saveCurrent() {
    if (!isDirty) return Boolean(savedContent.trim());
    setSavePhase("saving");
    let result;
    if (step === "units") result = await saveUnitAction({ novelId: initial.novel.id, startChapter: rangeStart, content, draft: false });
    else if (step === "outlines") result = await saveOutlineBatchAction({ novelId: initial.novel.id, startChapter: rangeStart, content, draft: false });
    else if (step === "drafts") result = await saveChapterAction({ novelId: initial.novel.id, chapterNumber: chapter, title: chapterTitle, content, status: "saved" as ChapterStatus, draft: false });
    else result = await saveStepAction({ novelId: initial.novel.id, key: step, content, draft: false });
    if (!result.ok) { setSavePhase("error"); setMessage(result.error); return false; }
    const timestamp = currentTimestamp();
    const snapshot = { title: step === "drafts" ? normalizeChapterTitle(chapterTitle) : "", content, updatedAt: timestamp };
    savedContentCache.current.set(positionKey, snapshot);
    clearLocalDraft(String(initial.novel.id), position);
    if (step === "drafts") {
      setChapterTitle(snapshot.title);
      setSavedChapterTitle(snapshot.title);
    }
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
    if (step === "volumes" || step === "units") {
      if (!firstVolumeOutline.trim()) { setMessage("请先确认本卷大纲"); return; }
      if (firstVolumeOutline !== savedFirstVolumeOutline && !await saveNovelField("firstVolumeOutline", firstVolumeOutline, "已保存本卷大纲")) return;
    }
    if (instructionDirty) { setMessage("请先保存本书专用创作要求"); return; }
    openPosition(followingPosition, true);
  }
  async function copyText(value: string, feedbackKey: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(feedbackKey);
      if (copyFeedbackTimer.current !== null) window.clearTimeout(copyFeedbackTimer.current);
      copyFeedbackTimer.current = window.setTimeout(() => setCopyFeedback(null), 1600);
    } catch { setMessage("复制失败，请在提示词框按 Ctrl+C"); }
  }
  async function copyPrompt() { await copyText(promptText, "tags-prompt"); }
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
    const databaseDiffers=(preview.databaseTitle.trim()!==""||preview.databaseContent.trim()!=="")&&(preview.databaseTitle!==preview.title||preview.databaseContent!==preview.content);
    if(isDirty||databaseDiffers){setConfirmation({ kind: "import-codex", preview });return;}
    await applyCodexImport(preview);
  }

  async function applyCodexImport(preview: CodexChapterPreview) {
    const result=await importCodexChapterAction({novelId:String(initial.novel.id),chapterNumber:chapter,expectedUpdatedAt:preview.databaseUpdatedAt,expectedDatabaseTitle:preview.databaseTitle,expectedDatabaseContent:preview.databaseContent,expectedFileTitle:preview.title,expectedFileContent:preview.content,expectedContinuitySummary:preview.continuitySummary,expectedContinuityState:preview.continuityState,expectedContinuityRunId:preview.continuityRunId});
    if(result.ok){const timestamp=currentTimestamp();const snapshot={title:result.title,content:result.content,updatedAt:timestamp};savedContentCache.current.set(positionKey,snapshot);clearLocalDraft(String(initial.novel.id),position);setChapterTitle(result.title);setSavedChapterTitle(result.title);setContent(result.content);setSavedContent(result.content);setLastSavedAt(timestamp);setSavePhase("idle");setChapterStatusOverrides((current)=>new Map(current).set(chapter,"saved"));setMessage(result.warning??`已读取并保存第${chapter}章《${result.title||"未命名"}》，连续性状态已同步`);router.refresh();await refreshCodexState();}else setMessage(result.error);
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

  function requestRestoreVersion(version: ContentVersionData) {
    if (guard({ kind: "restore-version", version })) return;
    setConfirmation({ kind: "restore-version", version });
  }

  async function restoreVersion(version: ContentVersionData) {
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
      const snapshot = { title: step === "drafts" ? savedChapterTitle : "", content: version.content, updatedAt: timestamp };
      savedContentCache.current.set(positionKey, snapshot);
      clearLocalDraft(String(initial.novel.id), position);
      setContent(version.content); setSavedContent(version.content); setLastSavedAt(timestamp); setSavePhase("idle");
    }
    setMessage(result.warning ?? "已恢复历史版本；恢复前的内容也已保留");
    router.refresh();
  }

  async function confirmWorkspaceAction() {
    const pending = confirmation;
    if (!pending || confirmationBusy) return;
    if (pending.kind === "stale-draft") {
      if (pending.position.step === "drafts") setChapterTitle(String(pending.draft.title ?? savedChapterTitle));
      setContent(pending.draft.content);
      setMessage("已恢复旧版草稿，请核对后保存");
      setConfirmation(null);
      return;
    }
    setConfirmationBusy(true);
    if (pending.kind === "import-codex") await applyCodexImport(pending.preview);
    else if (pending.kind === "restore-version") await restoreVersion(pending.version);
    else {
      const result = await deleteNovelAction({ novelId: String(initial.novel.id), confirmation: deleteConfirmation.trim() });
      if (result.ok) { router.push("/novels"); return; }
      setMessage(result.error);
    }
    setConfirmationBusy(false);
    setConfirmation(null);
  }

  function closeWorkspaceConfirmation() {
    if (confirmationBusy) return;
    if (confirmation?.kind === "stale-draft") setMessage("旧版草稿仍保留在本机，未覆盖当前内容");
    setConfirmation(null);
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
  const activeTaskView: AutomationTaskView | null = automationMode ? "planning" : chapterAutomationMode ? "chapters" : null;
  const reviewPlanning = () => openPosition({ ...position, step: "volumes", rangeStart: 1 });
  const preparePublishing = () => {
    if (step === "drafts") {
      setChapterAutomationMode(false);
      setChapterWorkspaceMode("publish");
      scrollToWorkspaceTop();
      return;
    }
    openPosition({ ...position, step: "tags" });
  };
  const viewAutomatedChapter = (chapterNumber: number) => {
    setChapterAutomationMode(false);
    setChapterWorkspaceMode("write");
    openPosition({ ...position, step: "drafts", chapter: chapterNumber });
  };
  const advanceNeedsSave = isDirty || !savedContent.trim() || (step === "topics" && selectedTopicDirty) || ((step === "volumes" || step === "units") && firstVolumeOutline !== savedFirstVolumeOutline);
  const advanceLabel = nextActionLabel ? (advanceNeedsSave ? nextActionLabel : nextActionLabel.replace(/^保存并/, "")) : null;
  const advanceDisabled = savePhase === "saving" || !content.trim() || (step === "topics" && !selectedTopicComplete) || ((step === "volumes" || step === "units") && !firstVolumeOutline.trim()) || Boolean(instructionDirty);
  const promptSourceBar = <section className="prompt-source-bar"><strong>当前提示词：{initial.promptSource.schemeName}{initial.promptSource.mode === "scheme" ? "（跟随方案）" : ""}</strong><select value={schemeChoice} onChange={(event) => setSchemeChoice(event.target.value)}>{schemes.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}</select><button type="button" className="button-secondary" onClick={() => { if (!guard({ kind: "switch-scheme", schemeId: schemeChoice })) void switchScheme(schemeChoice); }}>{initial.promptSource.mode === "scheme" ? "切换方案" : "恢复跟随方案"}</button>{initial.promptSource.mode === "scheme" && <button type="button" className="button-quiet" onClick={() => { if (!guard({ kind: "detach-scheme" })) void detachScheme(); }}>转为本书专用</button>}</section>;
  const customInstructionField = initial.promptSource.mode === "custom" ? <label className="novel-inline-field">本书专用 · {STEP_LABELS[step]}{step === "tags" ? "提示词" : "创作要求"}<textarea value={customInstruction} onChange={(event) => setInstructionOverride({ key: instructionKey, value: event.target.value })} rows={8} /><button type="button" disabled={customInstruction === baseInstruction} onClick={async () => { const result = await updateTemplateAction({ novelId: String(initial.novel.id), key: step, template: customInstruction }); if (result.ok) { setInstructionOverride(null); router.refresh(); setMessage(result.warning ?? "已保存本书专用要求"); } else setMessage(result.error); }}>保存本书专用要求</button></label> : null;

  const confirmationTitle = confirmation?.kind === "stale-draft" ? "恢复旧版本地草稿？"
    : confirmation?.kind === "import-codex" ? "用 Codex 正文覆盖当前内容？"
      : confirmation?.kind === "restore-version" ? "恢复这个历史版本？"
        : "删除整个小说项目？";
  const confirmationDescription = confirmation?.kind === "stale-draft"
    ? "这份草稿基于较旧的正式版本。恢复后请核对差异再保存；取消不会删除本机草稿。"
    : confirmation?.kind === "import-codex"
      ? `Codex 章节《${confirmation.preview.title || "未命名"}》正文 ${confirmation.preview.content.length} 字符，工作台当前内容 ${content.length} 字符。覆盖前的正式正文会保留在历史版本中。`
      : confirmation?.kind === "restore-version"
        ? "恢复后，当前正式内容会先自动进入历史版本，随时可以再次找回。"
        : `删除后无法在工作台恢复。请输入小说名称“${initial.novel.name}”确认。`;

  const promptEditor = <section className="editor-panel prompt-editor-panel">{step === "tags" ? <div className="publish-preparation-prompts"><div><div className="panel-title"><h3>作品标签提示词</h3><div className="panel-title-actions"><button type="button" disabled={promptMissing.length > 0 || !promptText.trim()} onClick={copyPrompt}>{copyFeedback === "tags-prompt" ? "已复制" : "复制标签提示词"}</button></div></div>{promptMissing.length > 0 && <div className="missing-links"><strong>还缺少：</strong>{promptMissing.map((label) => <button type="button" key={label} onClick={() => openMissing(label)}>{label} →</button>)}</div>}<textarea value={promptText} readOnly rows={18} /></div><div><div className="panel-title"><h3>番茄爽文小说封面创作</h3><div className="panel-title-actions"><button type="button" disabled={coverMissing} onClick={() => copyText(coverPrompt, "cover-prompt")}>{copyFeedback === "cover-prompt" ? "已复制" : "复制封面提示词"}</button></div></div>{coverMissing && <div className="missing-links"><strong>还缺少：</strong>{!selectedTopicSummary.trim() && <button type="button" onClick={() => openPosition({ ...position, step: "topics" })}>简介 →</button>}{!coverInstruction.trim() && <span>封面创作要求</span>}</div>}<textarea value={coverPrompt} readOnly rows={14} /></div></div> : <><div className="panel-title"><h3>{step === "drafts" ? "Codex 短指令" : "最终提示词（可临时修改）"}</h3><div className="panel-title-actions"><button type="button" className="button-quiet" onClick={() => setPromptOverride(null)}>恢复默认提示词</button><button type="button" disabled={promptMissing.length > 0 || !promptText.trim()} onClick={() => copyText(promptText, "main-prompt")}>{copyFeedback === "main-prompt" ? "已复制" : "复制提示词"}</button></div></div>{promptMissing.length > 0 && <div className="missing-links"><strong>还缺少：</strong>{promptMissing.map((label) => <button type="button" key={label} onClick={() => openMissing(label)}>{label} →</button>)}</div>}<textarea value={promptText} onChange={(event) => setPromptOverride({ key: promptKey, value: event.target.value })} rows={step === "drafts" ? 6 : 22} /></>}</section>;

  const resultEditor = <section className="editor-panel result-editor-panel">
    <div className="panel-title"><h3>{step === "drafts" ? `第 ${chapter} 章正文` : step === "tags" ? "粘贴 Gemini 推荐的作品标签" : "粘贴 Gemini 返回内容"}</h3><div className="editor-meta"><span className={`save-status ${saveStatus.kind}`}>{saveStatus.label}</span><span>{content.length} 字符</span></div></div>
    {step === "drafts" && <label className="chapter-title-field"><span>章节标题</span><input value={chapterTitle} maxLength={60} onChange={(event) => changeChapterTitle(event.target.value)} placeholder="输入本章标题" /></label>}
    <textarea key={positionKey} value={content} onChange={(event) => changeContent(event.target.value)} rows={step === "tags" ? 34 : 22} placeholder={step === "drafts" ? "在这里写作或修改正文…" : step === "tags" ? "将 Gemini 推荐的主分类、主题、角色、情节和主角名原样粘贴到这里…" : "在这里粘贴生成结果…"} />
    <div className="editor-toolbar"><div>{step === "drafts" ? <><button type="button" disabled={savePhase === "saving" || !isDirty} onClick={saveCurrent}>{savePhase === "saving" ? "保存中…" : "保存正文"}</button><button type="button" className="button-secondary" onClick={() => openChapterTask()}>{chapterTask ? "查看自动写作任务" : "AI 自动续写"}</button></> : <>{followingPosition && isDirty && <button className="button-quiet" type="button" disabled={savePhase === "saving"} onClick={saveCurrent}>仅保存</button>}{followingPosition && advanceLabel && <button type="button" disabled={advanceDisabled} onClick={saveAndAdvance}>{advanceLabel}</button>}{!followingPosition && isDirty && <button type="button" disabled={savePhase === "saving"} onClick={saveCurrent}>保存</button>}</>}</div></div>
  </section>;

  const switchChapterWorkspaceMode = (mode: ChapterWorkspaceMode) => {
    setChapterWorkspaceMode(mode);
    if (mode !== "write") setChapterAutomationMode(false);
  };
  const chapterNavigation = <div className="chapter-navigation chapter-context-navigation"><button type="button" className="button-secondary" disabled={chapter === 1} onClick={() => openPosition({ ...position, chapter: chapter - 1 })}>← 上一章</button><strong>第 {chapter} 章{chapterTitle.trim() ? `《${chapterTitle.trim()}》` : ""}</strong><button type="button" className="button-secondary" disabled={chapter === 60} onClick={() => openPosition({ ...position, chapter: chapter + 1 })}>下一章 →</button><button type="button" className="button-quiet" onClick={() => { const first = [...chapterStates].find(([, state]) => state === "ready"); if (first) openPosition({ ...position, chapter: first[0] }); else setMessage("当前没有可直接开始的未完成章节"); }}>首个可写章节</button></div>;
  const chapterWriteView = <div className="chapter-mode-panel chapter-write-mode">
    <div className="chapter-writing-layout">{resultEditor}</div>
    <details className="chapter-writing-advanced"><summary>AI 与创作设置</summary><div><CodexProjectPanel chapter={chapter} project={codexProject} state={codexState} message={message} onSync={syncCodexProject} onPrepare={prepareCodexTask} onImport={importCodexChapter} onRefresh={refreshCodexState} onCopyPath={async () => { try { await navigator.clipboard.writeText(codexProject.projectDir); setMessage("项目路径已复制"); } catch { setMessage("复制失败，请手动复制路径"); } }} />{promptEditor}{promptSourceBar}{customInstructionField}<section className="automatic-context"><strong>本步骤自动加入</strong><div>{promptInfo.automaticLabels.map((label) => <span key={label}>{label}</span>)}</div></section></div></details>
    <ContentHistory versions={relevantVersions} restoringId={restoringVersionId} onRestore={requestRestoreVersion} />
  </div>;
  const chapterPublishView = <div className="chapter-mode-panel chapter-publish-mode">
    <section className="chapter-publish-summary"><div><p className="novel-kicker">当前正式版本</p><h2>第 {chapter} 章《{savedChapterTitle || "未命名"}》</h2><p>{savedContent.length} 字符 · {currentChapterStatus === "published" ? "已标记发布" : "尚未标记发布"}</p></div><button type="button" className="button-secondary publish-toggle" disabled={savePhase === "saving" || isDirty || !savedContent.trim()} onClick={() => setPublished(currentChapterStatus !== "published")}>{currentChapterStatus === "published" ? "撤回发布标记" : "标记为已发布"}</button></section>
    <FanqieDeliveryPanel key={`delivery-${chapter}-${delivery.jobs.map((job) => `${job.id}:${job.updatedAt}`).join("|")}`} mode="chapter" novelId={String(initial.novel.id)} novelName={String(initial.novel.name)} chapterNumber={chapter} chapterTitle={savedChapterTitle} chapterContent={savedContent} chapterDirty={isDirty} initialState={delivery} extensionDirectory={deliveryExtensionDir} />
  </div>;
  const readerParagraphs = content.trim() ? content.trim().split(/\n{2,}/) : [];
  const chapterReadView = <div className="chapter-mode-panel chapter-read-mode"><section className="chapter-reader-shell"><header><p>第 {chapter} 章</p><h2>{chapterTitle.trim() || "未命名"}</h2><span>{isDirty ? "预览包含未保存修改" : `${content.length} 字符`}</span></header>{readerParagraphs.length ? <article>{readerParagraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 16)}`}>{paragraph}</p>)}</article> : <div className="chapter-reader-empty">本章还没有正文，返回“写作”开始创作。</div>}</section></div>;
  const chapterWorkspace = <section className="chapter-workbench">
    <nav className="chapter-mode-tabs" aria-label="章节正文模式">{(["write", "publish", "read"] as const).map((mode) => <button type="button" key={mode} className={chapterWorkspaceMode === mode ? "active" : ""} aria-pressed={chapterWorkspaceMode === mode} onClick={() => switchChapterWorkspaceMode(mode)}>{mode === "write" ? "写作" : mode === "publish" ? "发布" : "阅读"}</button>)}</nav>
    <details className="chapter-selector-details chapter-selector-top"><summary>章节目录 · 当前第 {chapter} 章</summary><ChapterSelector mode="chapter" value={chapter} onChange={(value) => openPosition({ ...position, chapter: value })} states={chapterStates} /></details>
    {chapterNavigation}
    {chapterWorkspaceMode === "write" ? chapterWriteView : chapterWorkspaceMode === "publish" ? chapterPublishView : chapterReadView}
  </section>;

  return <main className={`workspace-shell ${sidebarOpen?"sidebar-open":"sidebar-closed"}`}>
    <WorkflowSidebar open={sidebarOpen} novelName={initial.novel.name} activeStep={step} position={position} overview={workflowOverview} onLeave={requestLeave} onOpen={openPosition} onToggle={() => setSidebarOpen((open) => { const next = !open; writeSidebarState(next); return next; })} onBackup={async () => { const result = await exportNovelAction(String(initial.novel.id), "json"); if (result.ok) download(result.content, `${initial.novel.name}-备份.json`, "application/json"); else setMessage(result.error); }} onExportText={async () => { const result = await exportNovelAction(String(initial.novel.id), "txt"); if (result.ok) download(result.content, `${initial.novel.name}-第一卷.txt`, "text/plain;charset=utf-8"); else setMessage(result.error); }} />
    <section className="workspace-main"><header ref={workspaceTopRef} className="workspace-page-header"><div><p className="novel-kicker">{String(initial.novel.name)}</p><h1>{STEP_LABELS[step]}</h1></div><div className="workspace-header-actions">{!automationMode && !chapterAutomationMode && !planningTask && ["topics", "volumes", "settings", "units", "outlines"].includes(step) && selectedTopicConfirmed && <button type="button" className="button-secondary compact-button" onClick={openPlanningTask}>创建 Codex 自动任务</button>}<AutomationTaskCenter planningTask={planningTask} chapterTask={chapterTask} activeView={activeTaskView} onOpenPlanning={openPlanningTask} onOpenChapters={() => openChapterTask()} onReturnEditor={returnToEditor} onReviewPlanning={reviewPlanning} onPreparePublishing={preparePublishing} onViewChapter={viewAutomatedChapter} onContinueChapterBatch={(startChapter) => openChapterTask(startChapter)} /></div></header>
      {automationMode && <div className="automation-task-details"><AutomationPanel novelId={String(initial.novel.id)} onManifestChange={setPlanningTask} onReviewResults={reviewPlanning} onPreparePublishing={preparePublishing} /></div>}
      {chapterAutomationMode && chapterWorkspaceMode === "write" && <div className="automation-task-details"><ChapterAutomationPanel novelId={String(initial.novel.id)} nextWritableChapter={chapterGenerationRange.nextChapter} maxWritableChapterCount={chapterGenerationRange.maxCount} newBatchStart={chapterNewBatchStart} onImported={acceptAutomatedChapters} onManifestChange={setChapterTask} onOpenChapter={viewAutomatedChapter} /></div>}
      <div ref={editorTopRef} className="workspace-editor">
      {step === "drafts" ? chapterWorkspace : <>{promptSourceBar}{(step === "units" || step === "outlines") && <ChapterSelector mode="range" value={rangeStart} onChange={(value) => openPosition({ ...position, rangeStart: value })} states={rangeStates} />}{(step === "topics" || step === "volumes") && <section className="step-checklist"><strong>本步骤完成条件</strong><span className={savedContent.trim()&&!isDirty?"done":"pending"}>{savedContent.trim()&&!isDirty?"✓":"1"} 模型生成结果已保存</span><span className={(step==="topics"?selectedTopicConfirmed&&!selectedTopicDirty:firstVolumeOutline===savedFirstVolumeOutline&&Boolean(savedFirstVolumeOutline.trim()))?"done":"pending"}>{(step==="topics"?selectedTopicConfirmed&&!selectedTopicDirty:firstVolumeOutline===savedFirstVolumeOutline&&Boolean(savedFirstVolumeOutline.trim()))?"✓":"2"} {step==="topics"?"书名和简介已确认":"本卷大纲已确认"}</span></section>}{step === "topics" && <section className="novel-inline-field selected-topic-fields"><strong>最终选题</strong><label>书名<input value={selectedTopicTitle} onChange={(event) => setSelectedTopicTitle(event.target.value)} placeholder="输入最终书名" /></label><label>简介<textarea value={selectedTopicSummary} onChange={(event) => setSelectedTopicSummary(event.target.value)} rows={8} placeholder="输入最终简介" /></label><button type="button" disabled={!selectedTopicDirty||!selectedTopicComplete} onClick={()=>saveNovelField("selectedTopic",selectedTopic,"已保存书名和简介")}>保存书名和简介</button></section>}{step === "volumes" && <label className="novel-inline-field">第一卷大纲<textarea value={firstVolumeOutline} onChange={(event) => setFirstVolumeOutline(event.target.value)} rows={6} /><button type="button" disabled={firstVolumeOutline===savedFirstVolumeOutline} onClick={()=>saveNovelField("firstVolumeOutline",firstVolumeOutline,"已保存第一卷大纲")}>保存第一卷大纲</button></label>}{step === "units" && <label className="novel-inline-field">本卷大纲<textarea value={firstVolumeOutline} onChange={(event) => setFirstVolumeOutline(event.target.value)} rows={6} placeholder="粘贴当前卷的大纲，保存后六个批次会自动复用" /><button type="button" disabled={firstVolumeOutline===savedFirstVolumeOutline} onClick={()=>saveNovelField("firstVolumeOutline",firstVolumeOutline,"已保存本卷大纲")}>保存本卷大纲</button></label>}{customInstructionField}<section className="automatic-context"><strong>本步骤自动加入</strong><div>{promptInfo.automaticLabels.map((label) => <span key={label}>{label}</span>)}</div></section>{step === "tags" && <FanqieDeliveryPanel mode="setup" novelId={String(initial.novel.id)} novelName={String(initial.novel.name)} chapterNumber={chapter} chapterTitle={chapterTitle} chapterContent={content} chapterDirty={isDirty} initialState={delivery} extensionDirectory={deliveryExtensionDir} />}<div className="editor-grid">{promptEditor}{resultEditor}</div><ContentHistory versions={relevantVersions} restoringId={restoringVersionId} onRestore={requestRestoreVersion} /></>}
      <details className="danger-zone"><summary>删除小说</summary><button type="button" onClick={() => { setDeleteConfirmation(""); setConfirmation({ kind: "delete-novel" }); }}>删除整个项目</button></details>
      </div>
      {toastMessage && <div className="workspace-toast" role="status" aria-live="polite">{toastMessage}</div>}
      <WorkspaceConfirmDialog open={Boolean(confirmation)} title={confirmationTitle} description={confirmationDescription} confirmLabel={confirmation?.kind === "delete-novel" ? "删除小说" : confirmation?.kind === "import-codex" ? "覆盖并导入" : "确认恢复"} danger={confirmation?.kind === "delete-novel" || confirmation?.kind === "import-codex"} busy={confirmationBusy} confirmDisabled={confirmation?.kind === "delete-novel" && deleteConfirmation.trim() !== String(initial.novel.name)} onConfirm={() => void confirmWorkspaceAction()} onClose={closeWorkspaceConfirmation}>
        {confirmation?.kind === "delete-novel" && <label className="workspace-dialog-field">小说名称<input value={deleteConfirmation} autoComplete="off" onChange={(event) => setDeleteConfirmation(event.target.value)} /></label>}
      </WorkspaceConfirmDialog>
      <WorkspaceConfirmDialog open={Boolean(guardedAction)} title="放弃未保存的修改？" description={auxiliaryDirty ? "当前页面还有未保存的书名、简介、大纲或创作要求。继续后这些修改会放弃；正文编辑草稿会保留在本机。" : "当前内容还没有正式保存。继续后工作台会离开当前位置，本地草稿仍会保留。"} confirmLabel="放弃并继续" danger onConfirm={() => void confirmGuardedAction()} onClose={() => setGuardedAction(null)} />
    </section>
  </main>;
}
