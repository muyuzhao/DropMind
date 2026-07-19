"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StepKey } from "@/lib/novel-db/schema";
import type { PromptSchemeData } from "@/modules/novels/types";
import { STEP_LABELS } from "@/modules/novels/templates";
import { AUTOMATIC_CONTEXT_LABELS } from "@/modules/novels/structured-prompts";
import { createSchemeAction, defaultSchemeAction, deleteSchemeAction, saveSchemeAction, saveSchemeTemplateAction } from "@/app/novels/actions";
import { WorkspaceConfirmDialog } from "./workspace-overlays";

type Scheme = PromptSchemeData;
type SchemeAction = { kind: "pick-scheme"; scheme: Scheme } | { kind: "pick-step"; step: StepKey } | { kind: "create" } | { kind: "make-default" };
type SchemeConfirmation = { kind: "discard"; action: SchemeAction } | { kind: "delete" };

export function PromptSchemeManager({ initial }: { initial: Scheme[] }) {
  const router = useRouter();
  const [id, setId] = useState(initial[0]?.id ?? "");
  const [step, setStep] = useState<StepKey>("topics");
  const scheme = initial.find((item) => item.id === id) ?? initial[0];
  const baseTemplate = scheme?.templates.find((item) => item.key === step)?.template ?? "";
  const baseCoverTemplate = scheme?.templates.find((item) => item.key === "cover")?.template ?? "";
  const [name, setName] = useState(scheme?.name ?? "");
  const [description, setDescription] = useState(scheme?.description ?? "");
  const [template, setTemplate] = useState(baseTemplate);
  const [coverTemplate, setCoverTemplate] = useState(baseCoverTemplate);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<SchemeConfirmation | null>(null);
  const dirty = Boolean(scheme) && (name !== scheme.name || description !== scheme.description || template !== baseTemplate || (step === "tags" && coverTemplate !== baseCoverTemplate));

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  if (!scheme) return null;

  function applyScheme(next: Scheme) {
    setId(next.id);
    setName(next.name);
    setDescription(next.description);
    setTemplate(next.templates.find((item) => item.key === step)?.template ?? "");
    setCoverTemplate(next.templates.find((item) => item.key === "cover")?.template ?? "");
    setMessage("");
  }

  function applyStep(next: StepKey) {
    setStep(next);
    setName(scheme.name);
    setDescription(scheme.description);
    setTemplate(scheme.templates.find((item) => item.key === next)?.template ?? "");
    setCoverTemplate(scheme.templates.find((item) => item.key === "cover")?.template ?? "");
    setMessage("");
  }

  async function executeAction(action: SchemeAction) {
    if (action.kind === "pick-scheme") { applyScheme(action.scheme); return; }
    if (action.kind === "pick-step") { applyStep(action.step); return; }
    setPending(true);
    setMessage("");
    if (action.kind === "create") {
      const result = await createSchemeAction({ name: `新方案 ${initial.length + 1}`, description: "", sourceSchemeId: scheme.id });
      setPending(false);
      if (!result.ok) { setMessage(result.error); return; }
      router.refresh();
      setMessage("新方案已创建，请在左侧列表中选择");
      return;
    }
    const result = await defaultSchemeAction(scheme.id);
    setPending(false);
    if (!result.ok) { setMessage(result.error); return; }
    router.refresh();
    setMessage("已设为默认方案");
  }

  function requestAction(action: SchemeAction) {
    if (dirty) setConfirmation({ kind: "discard", action });
    else void executeAction(action);
  }

  async function deleteScheme() {
    setPending(true);
    setMessage("");
    const result = await deleteSchemeAction(scheme.id);
    setPending(false);
    if (!result.ok) { setMessage(result.error); return; }
    const next = initial.find((item) => item.id !== scheme.id);
    if (next) applyScheme(next);
    router.refresh();
    setMessage("方案已删除");
  }

  async function confirmAction() {
    const action = confirmation;
    if (!action || pending) return;
    setConfirmation(null);
    if (action.kind === "delete") await deleteScheme();
    else await executeAction(action.action);
  }

  return <div className="scheme-layout"><aside className="scheme-list">
    <button type="button" disabled={pending} onClick={() => requestAction({ kind: "create" })}>＋ 新建</button>
    {initial.map((item) => <button type="button" className={item.id === scheme.id ? "active" : ""} onClick={() => requestAction({ kind: "pick-scheme", scheme: item })} key={item.id}>{item.name}{item.isDefault ? " · 默认" : ""}</button>)}
  </aside><section className="scheme-editor">
    <input value={name} onChange={(event) => setName(event.target.value)} /><input value={description} onChange={(event) => setDescription(event.target.value)} />
    <button type="button" disabled={pending || (name === scheme.name && description === scheme.description)} onClick={async () => {
      setPending(true); setMessage(""); const result = await saveSchemeAction({ id: scheme.id, name, description }); setPending(false);
      if (!result.ok) { setMessage(result.error); return; } router.refresh(); setMessage("方案资料已保存");
    }}>保存方案资料</button>
    <div className="novel-selector">{(Object.keys(STEP_LABELS) as StepKey[]).map((key) => <button type="button" className={key === step ? "active" : ""} onClick={() => requestAction({ kind: "pick-step", step: key })} key={key}>{STEP_LABELS[key]}</button>)}</div>
    <section className="automatic-context"><strong>本步骤自动加入</strong><div>{AUTOMATIC_CONTEXT_LABELS[step].map((label)=><span key={label}>{label}</span>)}</div><p>这些内容由工作台自动填写，不需要在创作要求里写变量。</p></section>
    <label>{step === "tags" ? "作品标签提示词" : "创作要求"}</label>
    <textarea rows={24} value={template} onChange={(event) => setTemplate(event.target.value)} />
    <button type="button" disabled={pending || template === baseTemplate} onClick={async () => {
      setPending(true); setMessage(""); const result = await saveSchemeTemplateAction({ id: scheme.id, key: step, template }); setPending(false);
      if (!result.ok) { setMessage(result.error); return; } router.refresh(); setMessage("当前模板已保存");
    }}>保存当前模板</button>
    {step === "tags" && <><label>封面创作提示词</label>
      <textarea rows={14} value={coverTemplate} onChange={(event) => setCoverTemplate(event.target.value)} />
      <button type="button" disabled={pending || coverTemplate === baseCoverTemplate} onClick={async () => {
        setPending(true); setMessage(""); const result = await saveSchemeTemplateAction({ id: scheme.id, key: "cover", template: coverTemplate }); setPending(false);
        if (!result.ok) { setMessage(result.error); return; } router.refresh(); setMessage("封面提示词已保存");
      }}>保存封面提示词</button></>}
    <button type="button" disabled={pending || Boolean(scheme.isDefault)} onClick={() => requestAction({ kind: "make-default" })}>设为默认</button>
    {!scheme.isSystem && !scheme.isDefault && <button type="button" disabled={pending} onClick={() => setConfirmation({ kind: "delete" })}>删除方案</button>}
    {message && <p className={message.includes("失败") || message.includes("不能为空") ? "novel-error" : "codex-project-message"}>{message}</p>}
  </section>
    <WorkspaceConfirmDialog open={Boolean(confirmation)} title={confirmation?.kind === "delete" ? "删除这个提示词方案？" : "放弃未保存的方案修改？"} description={confirmation?.kind === "delete" ? `${dirty ? "当前未保存修改也会一并放弃。" : ""}删除方案不会修改已经保存的小说内容。` : "继续后，当前方案中尚未保存的名称、说明或模板修改会丢失。"} confirmLabel={confirmation?.kind === "delete" ? "删除方案" : "放弃并继续"} danger busy={pending} onConfirm={() => void confirmAction()} onClose={() => setConfirmation(null)} />
  </div>;
}
