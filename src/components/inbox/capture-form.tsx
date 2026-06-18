"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function CaptureForm() {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawContent: content }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "保存失败");
      setContent("");
      router.push("/inbox?saved=1");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="capture-card" onSubmit={submit}>
      <label htmlFor="content">此刻想记下什么？</label>
      <textarea
        autoFocus
        id="content"
        maxLength={50_000}
        onChange={(event) => setContent(event.target.value)}
        placeholder="一段想法、一条链接、会议里不能忘的事……"
        rows={10}
        value={content}
      />
      <div className="form-footer">
        <span className={error ? "error" : "hint"}>{error || `${content.length.toLocaleString()} / 50,000`}</span>
        <button disabled={saving || !content.trim()} type="submit">
          {saving ? "正在保存…" : "放进收件箱"}
        </button>
      </div>
    </form>
  );
}
