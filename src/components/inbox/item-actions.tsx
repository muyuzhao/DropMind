"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ItemActions({ id, isFavorite, isArchived }: { id: string; isFavorite: boolean; isArchived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(body: object, returnToInbox = false) {
    setBusy(true);
    const response = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!response.ok) return;
    if (returnToInbox) router.push("/inbox");
    router.refresh();
  }

  return (
    <div className="detail-actions">
      <button disabled={busy} onClick={() => patch({ isFavorite: !isFavorite })} type="button">
        {isFavorite ? "取消收藏" : "☆ 收藏"}
      </button>
      <button disabled={busy} onClick={() => patch({ status: isArchived ? "ready" : "archived" }, true)} type="button">
        {isArchived ? "移回收件箱" : "归档"}
      </button>
    </div>
  );
}
