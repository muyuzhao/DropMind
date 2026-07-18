"use client";

import { useRouter } from "next/navigation";
import { deleteNovelAction, updateNovelAction } from "@/app/novels/actions";

export function NovelCardActions({ novelId, novelName }: { novelId: string; novelName: string }) {
  const router = useRouter();

  async function renameNovel() {
    const nextName = window.prompt("输入新的小说名称", novelName)?.trim();
    if (!nextName || nextName === novelName) return;
    const result = await updateNovelAction({ novelId, name: nextName });
    if (!result.ok) { window.alert(result.error); return; }
    router.refresh();
  }

  async function deleteNovel() {
    const confirmation = window.prompt(`删除后无法在工作台恢复。\n请输入小说名称确认：${novelName}`);
    if (!confirmation) return;
    const result = await deleteNovelAction({ novelId, confirmation });
    if (!result.ok) { window.alert(result.error); return; }
    router.refresh();
  }

  return <div className="novel-card-actions">
    <button type="button" onClick={renameNovel}>重命名</button>
    <button className="danger" type="button" onClick={deleteNovel}>删除</button>
  </div>;
}
