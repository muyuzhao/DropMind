"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createNovelAction } from "@/app/novels/actions";

export function NewNovelForm({schemes}:{schemes:Array<{id:string;name:string;isDefault:boolean}>}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return <form className="novel-form" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setError("");
    const form = new FormData(event.currentTarget);
    const result = await createNovelAction({ name: form.get("name"), referenceTitle: form.get("referenceTitle"), referenceSummary: form.get("referenceSummary"), schemeId: form.get("schemeId") });
    if (result.ok) { if (result.warning) window.sessionStorage.setItem(`dropmind:flash:${result.id}`, result.warning); router.push(`/novels/${result.id}`); } else setError(result.error);
    setPending(false);
  }}>
    <label>小说项目名称<input name="name" required placeholder="例如：豪门真假千金" /></label>
    <label>参考书名<input name="referenceTitle" required /></label>
    <label>参考简介<textarea name="referenceSummary" required rows={10} /></label>
    <label>提示词方案<select name="schemeId" defaultValue={schemes.find(s=>s.isDefault)?.id}>{schemes.map(s=><option value={s.id} key={s.id}>{s.name}{s.isDefault?"（默认）":""}</option>)}</select></label>
    {error && <p className="novel-error">{error}</p>}<button disabled={pending}>{pending ? "创建中…" : "创建并开始"}</button>
  </form>;
}
