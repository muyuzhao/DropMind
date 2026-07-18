"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StepKey } from "@/lib/novel-db/schema";
import type { PromptSchemeData } from "@/modules/novels/types";
import { STEP_LABELS } from "@/modules/novels/templates";
import { AUTOMATIC_CONTEXT_LABELS } from "@/modules/novels/structured-prompts";
import { createSchemeAction, defaultSchemeAction, deleteSchemeAction, saveSchemeAction, saveSchemeTemplateAction } from "@/app/novels/actions";

type Scheme = PromptSchemeData;

export function PromptSchemeManager({ initial }: { initial: Scheme[] }) {
  const router = useRouter();
  const [id, setId] = useState(initial[0]?.id ?? "");
  const [step, setStep] = useState<StepKey>("topics");
  const scheme = initial.find((item) => item.id === id) ?? initial[0];
  const baseTemplate = scheme?.templates.find((item) => item.key === step)?.template ?? "";
  const [name, setName] = useState(scheme?.name ?? "");
  const [description, setDescription] = useState(scheme?.description ?? "");
  const [template, setTemplate] = useState(baseTemplate);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = Boolean(scheme) && (name !== scheme.name || description !== scheme.description || template !== baseTemplate);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  if (!scheme) return null;

  function confirmDiscard() {
    return !dirty || window.confirm("当前方案还有未保存修改，确定放弃并切换吗？");
  }

  function pickScheme(next: Scheme) {
    if (!confirmDiscard()) return;
    setId(next.id);
    setName(next.name);
    setDescription(next.description);
    setTemplate(next.templates.find((item) => item.key === step)?.template ?? "");
    setMessage("");
  }

  function pickStep(next: StepKey) {
    if (!confirmDiscard()) return;
    setStep(next);
    setName(scheme.name);
    setDescription(scheme.description);
    setTemplate(scheme.templates.find((item) => item.key === next)?.template ?? "");
    setMessage("");
  }

  return <div className="scheme-layout"><aside className="scheme-list">
    <button type="button" disabled={pending} onClick={async () => {
      if (!confirmDiscard()) return;
      setPending(true); setMessage("");
      const result = await createSchemeAction({ name: `新方案 ${initial.length + 1}`, description: "", sourceSchemeId: scheme.id });
      setPending(false);
      if (!result.ok) { setMessage(result.error); return; }
      router.refresh(); setMessage("新方案已创建，请在左侧列表中选择");
    }}>＋ 新建</button>
    {initial.map((item) => <button type="button" className={item.id === scheme.id ? "active" : ""} onClick={() => pickScheme(item)} key={item.id}>{item.name}{item.isDefault ? " · 默认" : ""}</button>)}
  </aside><section className="scheme-editor">
    <input value={name} onChange={(event) => setName(event.target.value)} /><input value={description} onChange={(event) => setDescription(event.target.value)} />
    <button type="button" disabled={pending || (name === scheme.name && description === scheme.description)} onClick={async () => {
      setPending(true); setMessage(""); const result = await saveSchemeAction({ id: scheme.id, name, description }); setPending(false);
      if (!result.ok) { setMessage(result.error); return; } router.refresh(); setMessage("方案资料已保存");
    }}>保存方案资料</button>
    <div className="novel-selector">{(Object.keys(STEP_LABELS) as StepKey[]).map((key) => <button type="button" className={key === step ? "active" : ""} onClick={() => pickStep(key)} key={key}>{STEP_LABELS[key]}</button>)}</div>
    <section className="automatic-context"><strong>本步骤自动加入</strong><div>{AUTOMATIC_CONTEXT_LABELS[step].map((label)=><span key={label}>{label}</span>)}</div><p>这些内容由工作台自动填写，不需要在创作要求里写变量。</p></section>
    <label>创作要求</label>
    <textarea rows={24} value={template} onChange={(event) => setTemplate(event.target.value)} />
    <button type="button" disabled={pending || template === baseTemplate} onClick={async () => {
      setPending(true); setMessage(""); const result = await saveSchemeTemplateAction({ id: scheme.id, key: step, template }); setPending(false);
      if (!result.ok) { setMessage(result.error); return; } router.refresh(); setMessage("当前模板已保存");
    }}>保存当前模板</button>
    <button type="button" disabled={pending || Boolean(scheme.isDefault)} onClick={async () => {
      if (!confirmDiscard()) return; setPending(true); setMessage(""); const result = await defaultSchemeAction(scheme.id); setPending(false);
      if (!result.ok) { setMessage(result.error); return; } router.refresh(); setMessage("已设为默认方案");
    }}>设为默认</button>
    {!scheme.isSystem && !scheme.isDefault && <button type="button" disabled={pending} onClick={async () => {
      if (!confirmDiscard() || !window.confirm("确认删除这个提示词方案？")) return;
      setPending(true); setMessage(""); const result = await deleteSchemeAction(scheme.id); setPending(false);
      if (!result.ok) { setMessage(result.error); return; }
      const next = initial.find((item) => item.id !== scheme.id);
      if (next) { setId(next.id); setName(next.name); setDescription(next.description); setTemplate(next.templates.find((item) => item.key === step)?.template ?? ""); }
      router.refresh(); setMessage("方案已删除");
    }}>删除方案</button>}
    {message && <p className={message.includes("失败") || message.includes("不能为空") ? "novel-error" : "codex-project-message"}>{message}</p>}
  </section></div>;
}
