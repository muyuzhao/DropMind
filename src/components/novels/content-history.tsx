"use client";

import type { ContentVersionData } from "@/modules/novels/types";

const TYPE_LABELS: Record<ContentVersionData["contentType"], string> = { step: "步骤内容", novel_field: "确认内容", story_unit: "剧情单元", outline_batch: "分章大纲", chapter: "章节正文", template: "创作要求" };

export function ContentHistory({ versions, restoringId, onRestore }: { versions: ContentVersionData[]; restoringId: string | null; onRestore: (version: ContentVersionData) => void }) {
  if (!versions.length) return null;
  return <details className="content-history"><summary>历史版本（{versions.length}）</summary><div className="content-history-list">{versions.map((version) => <article key={version.id}><div><strong>{TYPE_LABELS[version.contentType]}</strong><time>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(version.createdAt)}</time></div><p>{version.content.slice(0, 180)}{version.content.length > 180 ? "…" : ""}</p><button type="button" disabled={restoringId !== null} onClick={() => onRestore(version)}>{restoringId === version.id ? "正在恢复…" : "恢复此版本"}</button></article>)}</div></details>;
}
