"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importNovelBackupAction } from "@/app/novels/actions";

export function ImportNovelBackup() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function importFile(file: File) {
    setPending(true);
    setError("");
    try {
      const result = await importNovelBackupAction(await file.text());
      if (!result.ok) { setError(result.error); return; }
      if (result.warning) window.sessionStorage.setItem(`dropmind:flash:${result.id}`, result.warning);
      router.push(`/novels/${result.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取备份文件");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return <div className="novel-import">
    <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => {
      const file = event.target.files?.[0];
      if (file) void importFile(file);
    }} />
    <button className="novel-primary" type="button" disabled={pending} onClick={() => inputRef.current?.click()}>{pending ? "正在恢复…" : "导入备份"}</button>
    {error && <p className="novel-error">{error}</p>}
  </div>;
}
