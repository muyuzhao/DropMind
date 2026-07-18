"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StepKey } from "@/lib/novel-db/schema";
import { STEP_LABELS } from "@/modules/novels/templates";
import { AUTOMATIC_CONTEXT_LABELS } from "@/modules/novels/structured-prompts";
import { createSchemeAction, defaultSchemeAction, deleteSchemeAction, saveSchemeAction, saveSchemeTemplateAction } from "@/app/novels/actions";

type Scheme = { id: string; name: string; description: string; isSystem: boolean; isDefault: boolean; templates: Array<{ key: StepKey; template: string }> };

export function PromptSchemeManager({ initial }: { initial: Scheme[] }) {
  const router = useRouter();
  const [id, setId] = useState(initial[0]?.id);
  const [step, setStep] = useState<StepKey>("topics");
  const scheme = initial.find((item) => item.id === id) ?? initial[0];
  const [name, setName] = useState(scheme?.name ?? "");
  const [description, setDescription] = useState(scheme?.description ?? "");
  const [template, setTemplate] = useState(scheme?.templates.find((item) => item.key === step)?.template ?? "");
  if (!scheme) return null;

  function pickScheme(next: Scheme) {
    setId(next.id); setName(next.name); setDescription(next.description);
    setTemplate(next.templates.find((item) => item.key === step)?.template ?? "");
  }

  return <div className="scheme-layout"><aside className="scheme-list">
    <button type="button" onClick={async () => { await createSchemeAction({ name: `新方案 ${initial.length + 1}`, description: "", sourceSchemeId: scheme.id }); router.refresh(); }}>＋ 新建</button>
    {initial.map((item) => <button type="button" className={item.id === scheme.id ? "active" : ""} onClick={() => pickScheme(item)} key={item.id}>{item.name}{item.isDefault ? " · 默认" : ""}</button>)}
  </aside><section className="scheme-editor">
    <input value={name} onChange={(event) => setName(event.target.value)} /><input value={description} onChange={(event) => setDescription(event.target.value)} />
    <button type="button" onClick={async () => { await saveSchemeAction({ id: scheme.id, name, description }); router.refresh(); }}>保存方案资料</button>
    <div className="novel-selector">{(Object.keys(STEP_LABELS) as StepKey[]).map((key) => <button type="button" className={key === step ? "active" : ""} onClick={() => { setStep(key); setTemplate(scheme.templates.find((item) => item.key === key)?.template ?? ""); }} key={key}>{STEP_LABELS[key]}</button>)}</div>
    <section className="automatic-context"><strong>本步骤自动加入</strong><div>{AUTOMATIC_CONTEXT_LABELS[step].map((label)=><span key={label}>{label}</span>)}</div><p>这些内容由工作台自动填写，不需要在创作要求里写变量。</p></section>
    <label>创作要求</label>
    <textarea rows={24} value={template} onChange={(event) => setTemplate(event.target.value)} />
    <button type="button" onClick={async () => { await saveSchemeTemplateAction({ id: scheme.id, key: step, template }); router.refresh(); }}>保存当前模板</button>
    <button type="button" onClick={async () => { await defaultSchemeAction(scheme.id); router.refresh(); }}>设为默认</button>
    {!scheme.isSystem && !scheme.isDefault && <button type="button" onClick={async () => { if (confirm("确认删除？")) { await deleteSchemeAction(scheme.id); router.refresh(); } }}>删除方案</button>}
  </section></div>;
}
