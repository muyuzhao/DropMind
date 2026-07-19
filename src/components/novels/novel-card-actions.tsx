"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteNovelAction, updateNovelAction } from "@/app/novels/actions";
import { WorkspaceConfirmDialog } from "./workspace-overlays";

type CardDialog = "rename" | "delete" | null;

export function NovelCardActions({ novelId, novelName }: { novelId: string; novelName: string }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<CardDialog>(null);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [busy, setBusy] = useState(false);

  function openDialog(next: Exclude<CardDialog, null>) {
    setDialog(next);
    setValue(next === "rename" ? novelName : "");
    setMessage("");
    setMessageError(false);
  }

  async function submit() {
    const nextValue = value.trim();
    if (!dialog || !nextValue || busy) return;
    setBusy(true);
    setMessage("");
    setMessageError(false);
    if (dialog === "rename") {
      const result = await updateNovelAction({ novelId, name: nextValue });
      setBusy(false);
      if (!result.ok) { setMessageError(true); setMessage(result.error); return; }
      if (result.warning) { setMessage(result.warning); router.refresh(); return; }
    } else {
      const result = await deleteNovelAction({ novelId, confirmation: nextValue });
      setBusy(false);
      if (!result.ok) { setMessageError(true); setMessage(result.error); return; }
    }
    setDialog(null);
    router.refresh();
  }

  const isDelete = dialog === "delete";
  return <div className="novel-card-actions">
    <button type="button" onClick={() => openDialog("rename")}>重命名</button>
    <button className="danger" type="button" onClick={() => openDialog("delete")}>删除</button>
    <WorkspaceConfirmDialog open={Boolean(dialog)} title={isDelete ? "删除这本小说？" : "重命名小说"} description={isDelete ? `删除后无法在工作台恢复。请输入小说名称“${novelName}”确认。` : "输入新的小说名称，已有创作资料不会改变。"} confirmLabel={isDelete ? "删除小说" : "保存名称"} danger={isDelete} busy={busy} confirmDisabled={!value.trim() || (isDelete && value.trim() !== novelName) || (!isDelete && value.trim() === novelName)} onConfirm={() => void submit()} onClose={() => { if (!busy) setDialog(null); }}>
      <label className="workspace-dialog-field">{isDelete ? "小说名称" : "新名称"}<input value={value} autoComplete="off" onChange={(event) => setValue(event.target.value)} /></label>
      {message && <p className={messageError ? "novel-error" : "workspace-dialog-message"} role={messageError ? "alert" : "status"}>{message}</p>}
    </WorkspaceConfirmDialog>
  </div>;
}
